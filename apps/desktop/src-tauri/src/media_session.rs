//! Windows system media controls (SMTC): the media keys, the volume flyout's media overlay and the
//! lock screen. libmpv plays under the page, so no media element plays and Chromium registers no
//! media session: the page describes what plays through the `media_session_*` commands and gets the
//! buttons back as `media://action`.
//!
//! What the page sends is validated here (pure, tested); the WinRT calls (`platform`) run on the
//! main (UI) thread only, through `on_main_thread`. Elsewhere than Windows they do nothing.
//!
//! The artwork is downloaded by the app (`fetch_artwork`, off the main thread) and handed to the
//! controls as an in-memory stream: given its URL, Windows never showed it.

use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use url::Url;

use crate::origin::is_same_origin;

/// The event the buttons are sent to the page as.
pub const ACTION_EVENT: &str = "media://action";
/// The longest title or subtitle taken, in characters.
const MAX_TEXT_CHARS: usize = 512;
/// The longest artwork URL taken, in bytes.
const MAX_ARTWORK_URL_BYTES: usize = 4096;
/// How long a command waits for the main thread (it is the main thread itself in practice: Tauri
/// runs synchronous commands there, and `run_on_main_thread` then runs the task at once).
const MAIN_THREAD_WAIT: Duration = Duration::from_secs(2);
/// The artwork download: its whole time, its largest body, the redirects followed (on the saved
/// server only).
const ARTWORK_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ARTWORK_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ARTWORK_REDIRECTS: usize = 3;
/// The widest thumbnail handed to the controls (the overlay draws it far smaller).
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_THUMBNAIL_WIDTH: u32 = 500;
/// A WinRT `TimeSpan` counts 100 ns ticks.
const TICKS_PER_MS: i64 = 10_000;

#[derive(Debug, PartialEq, Eq)]
pub enum MediaError {
    /// The page sent something unusable.
    Invalid(String),
    /// The system media controls cannot be reached (no window handle, a WinRT failure).
    Unavailable(String),
}

impl MediaError {
    pub fn code(&self) -> &'static str {
        match self {
            MediaError::Invalid(_) => "media/invalid",
            MediaError::Unavailable(_) => "media/unavailable",
        }
    }

    pub fn message(&self) -> String {
        match self {
            MediaError::Invalid(message) | MediaError::Unavailable(message) => message.clone(),
        }
    }
}

fn invalid(message: impl Into<String>) -> MediaError {
    MediaError::Invalid(message.into())
}

fn unavailable(message: impl Into<String>) -> MediaError {
    MediaError::Unavailable(message.into())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaAction {
    Play,
    Pause,
    SeekBackward,
    SeekForward,
    SeekTo,
    NextTrack,
}

impl MediaAction {
    const ALL: [MediaAction; 6] = [
        MediaAction::Play,
        MediaAction::Pause,
        MediaAction::SeekBackward,
        MediaAction::SeekForward,
        MediaAction::SeekTo,
        MediaAction::NextTrack,
    ];

    /// The name the page uses (the Media Session API's).
    pub fn name(self) -> &'static str {
        match self {
            MediaAction::Play => "play",
            MediaAction::Pause => "pause",
            MediaAction::SeekBackward => "seekbackward",
            MediaAction::SeekForward => "seekforward",
            MediaAction::SeekTo => "seekto",
            MediaAction::NextTrack => "nexttrack",
        }
    }

    pub fn parse(name: &str) -> Option<MediaAction> {
        MediaAction::ALL
            .into_iter()
            .find(|action| action.name() == name)
    }

    fn bit(self) -> u8 {
        1 << (self as u8)
    }
}

/// The actions the page handles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ActionSet(u8);

impl ActionSet {
    pub fn contains(self, action: MediaAction) -> bool {
        self.0 & action.bit() != 0
    }

    fn with(self, action: MediaAction) -> ActionSet {
        ActionSet(self.0 | action.bit())
    }

    /// Whether a press of `action` reaches the page: play and pause always (their buttons are
    /// always on), the others when the page listed them.
    pub fn permits(self, action: MediaAction) -> bool {
        matches!(action, MediaAction::Play | MediaAction::Pause) || self.contains(action)
    }
}

/// What plays, validated.
#[derive(Debug, PartialEq)]
pub struct Metadata {
    pub title: String,
    pub subtitle: Option<String>,
    pub artwork: Option<Url>,
    pub actions: ActionSet,
}

/// Where it plays, validated: milliseconds, the position within the duration, a positive rate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlaybackState {
    pub playing: bool,
    pub position_ms: f64,
    pub duration_ms: f64,
    pub rate: f64,
}

/// The payload of `media://action`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvent {
    pub action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seek_time_ms: Option<u64>,
}

/// Control characters (a newline, a tab…) become spaces; then trimmed.
fn clean_text(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

fn checked_text(value: &str, what: &str) -> Result<String, MediaError> {
    let cleaned = clean_text(value);
    if cleaned.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(format!(
            "the {what} is longer than {MAX_TEXT_CHARS} characters"
        )));
    }
    Ok(cleaned)
}

/// An artwork URL on the saved server (`server_origin`), else refused: the system fetches it
/// itself, so it never points anywhere else.
fn checked_artwork(url: &str, server_origin: Option<&str>) -> Result<Option<Url>, MediaError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > MAX_ARTWORK_URL_BYTES {
        return Err(invalid(format!(
            "the artwork URL is longer than {MAX_ARTWORK_URL_BYTES} bytes"
        )));
    }
    let parsed = Url::parse(trimmed).map_err(|_| invalid("the artwork URL is not a URL"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(invalid("the artwork URL must be http:// or https://"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(invalid(
            "the artwork URL must not contain a user name or password",
        ));
    }
    let origin = server_origin.ok_or_else(|| invalid("no server saved for the artwork"))?;
    if !is_same_origin(&parsed, origin) {
        return Err(invalid("the artwork URL is not on the saved server"));
    }
    Ok(Some(parsed))
}

/// The payload of `media_session_set`, validated.
pub fn validate_metadata(
    title: &str,
    subtitle: Option<&str>,
    artwork_url: Option<&str>,
    actions: &[String],
    server_origin: Option<&str>,
) -> Result<Metadata, MediaError> {
    let title = checked_text(title, "title")?;
    if title.is_empty() {
        return Err(invalid("the title is empty"));
    }
    let subtitle = match subtitle {
        Some(subtitle) => Some(checked_text(subtitle, "subtitle")?).filter(|s| !s.is_empty()),
        None => None,
    };
    let artwork = match artwork_url {
        Some(url) => checked_artwork(url, server_origin)?,
        None => None,
    };
    let actions = actions.iter().try_fold(ActionSet::default(), |set, name| {
        MediaAction::parse(name)
            .map(|action| set.with(action))
            .ok_or_else(|| invalid(format!("unknown action {name:?}")))
    })?;
    Ok(Metadata {
        title,
        subtitle,
        artwork,
        actions,
    })
}

/// The payload of `media_session_state`, validated: finite, non-negative times (the position
/// clamped to the duration); a rate that is not positive and finite is taken as 1.
pub fn validate_state(
    playing: bool,
    position_ms: f64,
    duration_ms: f64,
    rate: f64,
) -> Result<PlaybackState, MediaError> {
    if !position_ms.is_finite() || !duration_ms.is_finite() {
        return Err(invalid("the position and the duration must be finite"));
    }
    if position_ms < 0.0 || duration_ms < 0.0 {
        return Err(invalid(
            "the position and the duration must not be negative",
        ));
    }
    Ok(PlaybackState {
        playing,
        position_ms: position_ms.min(duration_ms),
        duration_ms,
        rate: if rate.is_finite() && rate > 0.0 {
            rate
        } else {
            1.0
        },
    })
}

/// A URL without its query and fragment, for logs (the artwork's query carries the media key).
pub fn redacted(url: &Url) -> String {
    let mut shown = url.clone();
    shown.set_query(None);
    shown.set_fragment(None);
    shown.to_string()
}

/// Where a redirect of `from` to `location` leads, when it stays on `origin` (the saved server's);
/// none otherwise.
pub fn redirect_target(from: &Url, location: &str, origin: &str) -> Option<Url> {
    let to = from.join(location).ok()?;
    let credentials = !to.username().is_empty() || to.password().is_some();
    (is_same_origin(&to, origin) && !credentials).then_some(to)
}

/// Whether a `Content-Type` is an image's (`image/webp`, `image/jpeg; charset=…`).
pub fn is_image_content_type(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|value| value.split(';').next())
        .map(|essence| essence.trim().to_ascii_lowercase().starts_with("image/"))
        .unwrap_or(false)
}

/// Downloads the artwork (blocking: never on the main thread): an image of at most
/// `MAX_ARTWORK_BYTES`, within `ARTWORK_TIMEOUT`, redirects followed on its own origin only.
/// The error never contains the URL's query.
pub fn fetch_artwork(url: &Url) -> Result<Vec<u8>, String> {
    let origin = url.origin().ascii_serialization();
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(ARTWORK_TIMEOUT))
        .max_redirects(0)
        .http_status_as_error(false)
        // The system's TLS stack and trust store, like the webview.
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .new_agent();
    let mut current = url.clone();
    for _ in 0..=MAX_ARTWORK_REDIRECTS {
        let mut response = agent
            .get(current.as_str())
            .header("accept", "image/*")
            .call()
            .map_err(|error| format!("{}: {error}", redacted(&current)))?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            current = redirect_target(&current, location, &origin)
                .ok_or_else(|| format!("{}: redirected off the server", redacted(&current)))?;
            continue;
        }
        if status != 200 {
            return Err(format!("{}: HTTP {}", redacted(&current), status.as_u16()));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok());
        if !is_image_content_type(content_type) {
            return Err(format!(
                "{}: not an image ({})",
                redacted(&current),
                content_type.unwrap_or("no content type")
            ));
        }
        // One byte past the limit tells a body that is too large.
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(MAX_ARTWORK_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("{}: {error}", redacted(&current)))?;
        if bytes.len() as u64 > MAX_ARTWORK_BYTES {
            return Err(format!(
                "{}: larger than {MAX_ARTWORK_BYTES} bytes",
                redacted(&current)
            ));
        }
        if bytes.is_empty() {
            return Err(format!("{}: empty image", redacted(&current)));
        }
        return Ok(bytes);
    }
    Err(format!("{}: too many redirects", redacted(url)))
}

/// The size to scale a `width` × `height` image to so that it is at most `max_width` wide (the
/// ratio kept, at least 1 px high); none when it already fits.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn scaled_size(width: u32, height: u32, max_width: u32) -> Option<(u32, u32)> {
    if width <= max_width || width == 0 {
        return None;
    }
    let scaled_height =
        (u64::from(height) * u64::from(max_width) + u64::from(width) / 2) / u64::from(width);
    Some((
        max_width,
        u32::try_from(scaled_height).unwrap_or(u32::MAX).max(1),
    ))
}

/// Downloads the artwork of the session `generation` off the main thread, then shows it if that
/// session is still the current one. A failure only logs: the session stays without artwork.
pub fn load_artwork<R: Runtime>(app: &AppHandle<R>, generation: u64, url: Url) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("media-artwork".into())
        .spawn(move || {
            let thumbnail = fetch_artwork(&url).and_then(|bytes| platform::thumbnail(&bytes));
            let thumbnail = match thumbnail {
                Ok(thumbnail) => thumbnail,
                Err(error) => {
                    log::warn!("media session artwork not loaded: {error}");
                    return;
                }
            };
            let shown = on_main_thread(&app, move |session| {
                session.set_thumbnail(generation, &thumbnail)
            });
            if let Err(error) = shown {
                log::warn!("media session artwork not shown: {}", error.message());
            }
        });
    if let Err(error) = spawned {
        log::warn!("media session artwork not loaded: {error}");
    }
}

/// `Windows.Media.SystemMediaTransportControlsButton` values (checked against the binding on
/// Windows by a test).
pub mod button {
    pub const PLAY: i32 = 0;
    pub const PAUSE: i32 = 1;
    pub const STOP: i32 = 2;
    pub const FAST_FORWARD: i32 = 4;
    pub const REWIND: i32 = 5;
    pub const NEXT: i32 = 6;
    pub const PREVIOUS: i32 = 7;
}

/// The action a pressed button asks for; the buttons the app never turns on give none.
pub fn action_for_button(pressed: i32) -> Option<MediaAction> {
    match pressed {
        button::PLAY => Some(MediaAction::Play),
        button::PAUSE => Some(MediaAction::Pause),
        button::NEXT => Some(MediaAction::NextTrack),
        button::REWIND => Some(MediaAction::SeekBackward),
        button::FAST_FORWARD => Some(MediaAction::SeekForward),
        // Never turned on (the player has no stop nor previous item), like the others.
        button::STOP | button::PREVIOUS => None,
        _ => None,
    }
}

/// A `TimeSpan` (100 ns ticks) in whole milliseconds, never negative.
pub fn ms_from_ticks(ticks: i64) -> u64 {
    u64::try_from(ticks / TICKS_PER_MS).unwrap_or(0)
}

/// Milliseconds as a `TimeSpan` (100 ns ticks), rounded, never negative, saturating.
pub fn ticks_from_ms(ms: f64) -> i64 {
    // `as` saturates (and NaN gives 0).
    (ms * TICKS_PER_MS as f64).round().max(0.0) as i64
}

/// The seek the system asked for (dragging the overlay's timeline), as the page gets it.
pub fn seek_request(ticks: i64) -> ActionEvent {
    ActionEvent {
        action: MediaAction::SeekTo.name(),
        seek_time_ms: Some(ms_from_ticks(ticks)),
    }
}

pub type Emit = Arc<dyn Fn(&ActionEvent) + Send + Sync>;

/// What the WinRT handlers (called on a system thread) read: atomics only, never the lock.
pub struct Shared {
    active: AtomicBool,
    allowed: AtomicU8,
    emit: Emit,
}

impl Shared {
    /// Sends `event` to the page while a session is shown and the page handles that action.
    fn deliver(&self, action: MediaAction, event: ActionEvent) {
        let allowed = ActionSet(self.allowed.load(Ordering::SeqCst));
        if self.active.load(Ordering::SeqCst) && allowed.permits(action) {
            (self.emit)(&event);
        }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn button_pressed(&self, pressed: i32) {
        if let Some(action) = action_for_button(pressed) {
            self.deliver(
                action,
                ActionEvent {
                    action: action.name(),
                    seek_time_ms: None,
                },
            );
        }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn position_requested(&self, ticks: i64) {
        self.deliver(MediaAction::SeekTo, seek_request(ticks));
    }
}

/// The app's one media session, managed state. Its methods make WinRT calls: main thread only
/// (`on_main_thread`).
pub struct MediaSession {
    hwnd: AtomicIsize,
    /// Bumped by every `set` and `clear`: an artwork arriving for an older one is dropped.
    generation: AtomicU64,
    shared: Arc<Shared>,
    controls: Mutex<Option<platform::Controls>>,
}

impl MediaSession {
    pub fn new(emit: Emit) -> MediaSession {
        MediaSession {
            hwnd: AtomicIsize::new(0),
            generation: AtomicU64::new(0),
            shared: Arc::new(Shared {
                active: AtomicBool::new(false),
                allowed: AtomicU8::new(0),
                emit,
            }),
            controls: Mutex::new(None),
        }
    }

    /// The main window's HWND, which the controls belong to.
    pub fn set_hwnd(&self, hwnd: isize) {
        self.hwnd.store(hwnd, Ordering::SeqCst);
    }

    /// Shows `metadata` in the system's controls, created on first use, without its artwork
    /// (`load_artwork`, then `set_thumbnail` with the generation returned).
    pub fn set(&self, metadata: &Metadata) -> Result<u64, MediaError> {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut guard = self
            .controls
            .lock()
            .map_err(|_| unavailable("media session state poisoned"))?;
        if guard.is_none() {
            let hwnd = self.hwnd.load(Ordering::SeqCst);
            if hwnd == 0 {
                return Err(unavailable("no window handle for the media controls"));
            }
            let created =
                platform::Controls::create(hwnd, Arc::clone(&self.shared)).map_err(unavailable)?;
            *guard = Some(created);
        }
        let Some(controls) = guard.as_ref() else {
            return Err(unavailable("media controls missing"));
        };
        self.shared
            .allowed
            .store(metadata.actions.0, Ordering::SeqCst);
        controls.show(metadata).map_err(unavailable)?;
        self.shared.active.store(true, Ordering::SeqCst);
        Ok(generation)
    }

    /// Adds the artwork to the session `generation` if it is still the one shown (a later `set`
    /// or `clear` wins); otherwise does nothing.
    pub fn set_thumbnail(
        &self,
        generation: u64,
        thumbnail: &platform::Thumbnail,
    ) -> Result<(), MediaError> {
        if !self.is_current(generation) {
            log::debug!("media session artwork dropped: a newer session replaced it");
            return Ok(());
        }
        let guard = self
            .controls
            .lock()
            .map_err(|_| unavailable("media session state poisoned"))?;
        match guard.as_ref() {
            Some(controls) => controls.set_thumbnail(thumbnail).map_err(unavailable),
            None => Ok(()),
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.shared.active.load(Ordering::SeqCst)
            && self.generation.load(Ordering::SeqCst) == generation
    }

    /// Updates the status and timeline; ignored while no session is shown (a late update after
    /// `clear` never brings the overlay back).
    pub fn state(&self, state: &PlaybackState) -> Result<(), MediaError> {
        if !self.shared.active.load(Ordering::SeqCst) {
            return Ok(());
        }
        let guard = self
            .controls
            .lock()
            .map_err(|_| unavailable("media session state poisoned"))?;
        match guard.as_ref() {
            Some(controls) => controls.update(state).map_err(unavailable),
            None => Ok(()),
        }
    }

    /// Hides the session: the overlay disappears and the buttons stop reaching the page.
    pub fn clear(&self) -> Result<(), MediaError> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.shared.active.store(false, Ordering::SeqCst);
        self.shared.allowed.store(0, Ordering::SeqCst);
        let guard = self
            .controls
            .lock()
            .map_err(|_| unavailable("media session state poisoned"))?;
        match guard.as_ref() {
            Some(controls) => controls.hide().map_err(unavailable),
            None => Ok(()),
        }
    }

    /// The app exits: hides the session and lets the controls go (their handlers removed).
    pub fn shutdown(&self) {
        if let Err(error) = self.clear() {
            log::debug!("media session not cleared on exit: {}", error.message());
        }
        if let Ok(mut guard) = self.controls.lock() {
            guard.take();
        }
    }
}

/// Runs `run` on the main thread with the app's media session and waits for its result: at once
/// when called on the main thread (Tauri's synchronous commands, window and page-load handlers),
/// else posted to the event loop and waited for at most `MAIN_THREAD_WAIT`.
pub fn on_main_thread<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    run: impl FnOnce(&MediaSession) -> Result<T, MediaError> + Send + 'static,
) -> Result<T, MediaError> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = match handle.try_state::<MediaSession>() {
            Some(session) => run(&session),
            None => Err(unavailable("the media session is not ready")),
        };
        // The caller may have stopped waiting.
        let _ = sender.send(result);
    })
    .map_err(|error| unavailable(format!("main thread unreachable: {error}")))?;
    receiver
        .recv_timeout(MAIN_THREAD_WAIT)
        .map_err(|_| unavailable("the main thread did not answer"))?
}

/// Clears the session (page load, `mpv_destroy`, change of server, window closing), logging a
/// failure: never an error for the caller.
pub fn clear<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = on_main_thread(app, |session| session.clear()) {
        log::debug!("media session not cleared: {}", error.message());
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::Arc;

    use windows::core::{factory, Ref, HSTRING};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapEncoder, BitmapInterpolationMode, BitmapPixelFormat,
        BitmapTransform, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::Streams::{
        DataReader, DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    use super::{
        scaled_size, ticks_from_ms, MediaAction, Metadata, PlaybackState, Shared,
        MAX_THUMBNAIL_WIDTH,
    };

    type ButtonHandler = TypedEventHandler<
        SystemMediaTransportControls,
        SystemMediaTransportControlsButtonPressedEventArgs,
    >;
    type PositionHandler =
        TypedEventHandler<SystemMediaTransportControls, PlaybackPositionChangeRequestedEventArgs>;

    fn message(error: windows::core::Error) -> String {
        format!("system media controls: {error}")
    }

    pub type Thumbnail = RandomAccessStreamReference;

    /// The image as a stream the controls read. Called off the main thread (the download's): the
    /// async calls are awaited there, and the agile reference is then handed to the main thread.
    /// The server's WebP, which the controls silently ignore, is re-encoded as a JPEG at most
    /// `MAX_THUMBNAIL_WIDTH` wide; when it cannot be decoded (no WebP codec), the original goes.
    pub fn thumbnail(bytes: &[u8]) -> Result<Thumbnail, String> {
        let image = match to_jpeg(bytes) {
            Ok(jpeg) => jpeg,
            Err(error) => {
                log::debug!("media session artwork kept as downloaded: {error}");
                bytes.to_vec()
            }
        };
        let stream = stream_of(&image)?;
        RandomAccessStreamReference::CreateFromStream(&stream).map_err(message)
    }

    /// An in-memory stream holding `bytes`, positioned at its start.
    fn stream_of(bytes: &[u8]) -> Result<InMemoryRandomAccessStream, String> {
        let stream = InMemoryRandomAccessStream::new().map_err(message)?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(message)?;
        writer.WriteBytes(bytes).map_err(message)?;
        writer
            .StoreAsync()
            .and_then(|store| store.join())
            .map_err(message)?;
        writer
            .FlushAsync()
            .and_then(|flush| flush.join())
            .map_err(message)?;
        // The stream outlives the writer.
        writer.DetachStream().map_err(message)?;
        stream.Seek(0).map_err(message)?;
        Ok(stream)
    }

    /// The whole content of `stream`.
    fn bytes_of(stream: &InMemoryRandomAccessStream) -> Result<Vec<u8>, String> {
        let size = u32::try_from(stream.Size().map_err(message)?)
            .map_err(|_| "image too large".to_string())?;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(message)?)
            .map_err(message)?;
        let loaded = reader
            .LoadAsync(size)
            .and_then(|load| load.join())
            .map_err(message)?;
        let mut bytes = vec![0; loaded as usize];
        reader.ReadBytes(&mut bytes).map_err(message)?;
        Ok(bytes)
    }

    /// Decodes any image WIC reads (WebP included where its codec is installed) and encodes it
    /// as a JPEG, scaled down to `MAX_THUMBNAIL_WIDTH` when wider.
    pub fn to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
        let source = stream_of(bytes)?;
        let decoder = BitmapDecoder::CreateAsync(&source)
            .and_then(|decode| decode.join())
            .map_err(message)?;
        let transform = BitmapTransform::new().map_err(message)?;
        let width = decoder.PixelWidth().map_err(message)?;
        let height = decoder.PixelHeight().map_err(message)?;
        if let Some((scaled_width, scaled_height)) = scaled_size(width, height, MAX_THUMBNAIL_WIDTH)
        {
            transform.SetScaledWidth(scaled_width).map_err(message)?;
            transform.SetScaledHeight(scaled_height).map_err(message)?;
            transform
                .SetInterpolationMode(BitmapInterpolationMode::Fant)
                .map_err(message)?;
        }
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::IgnoreExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )
            .and_then(|decode| decode.join())
            .map_err(message)?;
        let encoded = InMemoryRandomAccessStream::new().map_err(message)?;
        let encoder = BitmapEncoder::JpegEncoderId()
            .and_then(|jpeg| BitmapEncoder::CreateAsync(jpeg, &encoded))
            .and_then(|create| create.join())
            .map_err(message)?;
        encoder.SetSoftwareBitmap(&bitmap).map_err(message)?;
        encoder
            .FlushAsync()
            .and_then(|flush| flush.join())
            .map_err(message)?;
        bytes_of(&encoded)
    }

    /// A `width` × `height` PNG, for tests.
    #[cfg(test)]
    pub fn png(width: u32, height: u32) -> Result<Vec<u8>, String> {
        let pixels = vec![0x80; (width * height * 4) as usize];
        let encoded = InMemoryRandomAccessStream::new().map_err(message)?;
        let encoder = BitmapEncoder::PngEncoderId()
            .and_then(|png| BitmapEncoder::CreateAsync(png, &encoded))
            .and_then(|create| create.join())
            .map_err(message)?;
        encoder
            .SetPixelData(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                width,
                height,
                96.0,
                96.0,
                &pixels,
            )
            .map_err(message)?;
        encoder
            .FlushAsync()
            .and_then(|flush| flush.join())
            .map_err(message)?;
        bytes_of(&encoded)
    }

    /// The pixel size of an encoded image, for tests.
    #[cfg(test)]
    pub fn size_of(bytes: &[u8]) -> Result<(u32, u32), String> {
        let decoder = BitmapDecoder::CreateAsync(&stream_of(bytes)?)
            .and_then(|decode| decode.join())
            .map_err(message)?;
        Ok((
            decoder.PixelWidth().map_err(message)?,
            decoder.PixelHeight().map_err(message)?,
        ))
    }

    fn span(ms: f64) -> TimeSpan {
        TimeSpan {
            Duration: ticks_from_ms(ms),
        }
    }

    /// Runs a handler's body without letting a panic cross into WinRT.
    fn guarded(body: impl FnOnce()) {
        if catch_unwind(AssertUnwindSafe(body)).is_err() {
            log::error!("media session handler panicked");
        }
    }

    pub struct Controls {
        smtc: SystemMediaTransportControls,
        button_token: i64,
        position_token: i64,
    }

    impl Controls {
        /// The controls of the window `hwnd`, its two handlers registered once.
        pub fn create(hwnd: isize, shared: Arc<Shared>) -> Result<Controls, String> {
            let interop =
                factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()
                    .map_err(message)?;
            // SAFETY: `hwnd` is the main window's handle, read from its raw window handle; it lives
            // as long as the app (the controls are cleared before the window closes).
            let smtc: SystemMediaTransportControls =
                unsafe { interop.GetForWindow(HWND(hwnd as *mut c_void)) }.map_err(message)?;

            let on_button = Arc::clone(&shared);
            let button_token = smtc
                .ButtonPressed(&ButtonHandler::new(
                    move |_sender, args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
                        if let Some(args) = args.as_ref() {
                            let pressed = args.Button()?;
                            guarded(|| on_button.button_pressed(pressed.0));
                        }
                        Ok(())
                    },
                ))
                .map_err(message)?;
            let on_position = shared;
            let position_token = smtc.PlaybackPositionChangeRequested(&PositionHandler::new(
                move |_sender, args: Ref<PlaybackPositionChangeRequestedEventArgs>| {
                    if let Some(args) = args.as_ref() {
                        let requested = args.RequestedPlaybackPosition()?;
                        guarded(|| on_position.position_requested(requested.Duration));
                    }
                    Ok(())
                },
            ));
            let position_token = match position_token {
                Ok(token) => token,
                Err(error) => {
                    let _ = smtc.RemoveButtonPressed(button_token);
                    return Err(message(error));
                }
            };
            Ok(Controls {
                smtc,
                button_token,
                position_token,
            })
        }

        pub fn show(&self, metadata: &Metadata) -> Result<(), String> {
            let smtc = &self.smtc;
            let actions = metadata.actions;
            smtc.SetIsEnabled(true).map_err(message)?;
            smtc.SetIsPlayEnabled(true).map_err(message)?;
            smtc.SetIsPauseEnabled(true).map_err(message)?;
            smtc.SetIsStopEnabled(false).map_err(message)?;
            smtc.SetIsPreviousEnabled(false).map_err(message)?;
            smtc.SetIsNextEnabled(actions.contains(MediaAction::NextTrack))
                .map_err(message)?;
            smtc.SetIsRewindEnabled(actions.contains(MediaAction::SeekBackward))
                .map_err(message)?;
            smtc.SetIsFastForwardEnabled(actions.contains(MediaAction::SeekForward))
                .map_err(message)?;

            let updater = smtc.DisplayUpdater().map_err(message)?;
            // From a clean slate: the previous title's subtitle and thumbnail go.
            updater.ClearAll().map_err(message)?;
            updater.SetType(MediaPlaybackType::Video).map_err(message)?;
            let video = updater.VideoProperties().map_err(message)?;
            video
                .SetTitle(&HSTRING::from(metadata.title.as_str()))
                .map_err(message)?;
            if let Some(subtitle) = &metadata.subtitle {
                video
                    .SetSubtitle(&HSTRING::from(subtitle.as_str()))
                    .map_err(message)?;
            }
            updater.Update().map_err(message)
        }

        pub fn set_thumbnail(&self, thumbnail: &Thumbnail) -> Result<(), String> {
            let updater = self.smtc.DisplayUpdater().map_err(message)?;
            updater.SetThumbnail(thumbnail).map_err(message)?;
            updater.Update().map_err(message)
        }

        pub fn update(&self, state: &PlaybackState) -> Result<(), String> {
            let smtc = &self.smtc;
            let status = if state.playing {
                MediaPlaybackStatus::Playing
            } else {
                MediaPlaybackStatus::Paused
            };
            smtc.SetPlaybackStatus(status).map_err(message)?;
            smtc.SetPlaybackRate(state.rate).map_err(message)?;
            let timeline =
                SystemMediaTransportControlsTimelineProperties::new().map_err(message)?;
            timeline.SetStartTime(span(0.0)).map_err(message)?;
            timeline
                .SetEndTime(span(state.duration_ms))
                .map_err(message)?;
            timeline.SetMinSeekTime(span(0.0)).map_err(message)?;
            timeline
                .SetMaxSeekTime(span(state.duration_ms))
                .map_err(message)?;
            timeline
                .SetPosition(span(state.position_ms))
                .map_err(message)?;
            smtc.UpdateTimelineProperties(&timeline).map_err(message)
        }

        pub fn hide(&self) -> Result<(), String> {
            let smtc = &self.smtc;
            let updater = smtc.DisplayUpdater().map_err(message)?;
            updater.ClearAll().map_err(message)?;
            updater.Update().map_err(message)?;
            smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed)
                .map_err(message)?;
            smtc.SetIsEnabled(false).map_err(message)
        }
    }

    impl Drop for Controls {
        fn drop(&mut self) {
            let _ = self.smtc.RemoveButtonPressed(self.button_token);
            let _ = self
                .smtc
                .RemovePlaybackPositionChangeRequested(self.position_token);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::sync::Arc;

    use super::{Metadata, PlaybackState, Shared};

    /// No system media controls outside Windows: everything succeeds and does nothing.
    pub struct Controls;

    pub type Thumbnail = ();

    pub fn thumbnail(_bytes: &[u8]) -> Result<Thumbnail, String> {
        Ok(())
    }

    impl Controls {
        pub fn create(_hwnd: isize, _shared: Arc<Shared>) -> Result<Controls, String> {
            Ok(Controls)
        }

        pub fn show(&self, _metadata: &Metadata) -> Result<(), String> {
            Ok(())
        }

        pub fn update(&self, _state: &PlaybackState) -> Result<(), String> {
            Ok(())
        }

        pub fn hide(&self) -> Result<(), String> {
            Ok(())
        }

        pub fn set_thumbnail(&self, _thumbnail: &Thumbnail) -> Result<(), String> {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: &str = "http://nas.local:8080";

    fn actions(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    fn metadata(
        title: &str,
        subtitle: Option<&str>,
        artwork: Option<&str>,
    ) -> Result<Metadata, MediaError> {
        validate_metadata(title, subtitle, artwork, &actions(&["play"]), Some(SERVER))
    }

    fn is_invalid<T>(result: Result<T, MediaError>) -> bool {
        matches!(result, Err(MediaError::Invalid(_)))
    }

    #[test]
    fn takes_a_title_trimmed_and_without_control_characters() {
        let taken = metadata("  The Wire\n", Some("S1\tE2 · The Detail"), None).expect("valid");
        assert_eq!(taken.title, "The Wire");
        assert_eq!(taken.subtitle.as_deref(), Some("S1 E2 · The Detail"));
        assert_eq!(taken.artwork, None);
        assert_eq!(
            metadata("Line\u{0}One\u{7f}", None, None)
                .expect("valid")
                .title,
            "Line One"
        );
    }

    #[test]
    fn refuses_an_empty_or_too_long_title() {
        assert!(is_invalid(metadata("", None, None)));
        assert!(is_invalid(metadata(" \n\t ", None, None)));
        assert!(metadata(&"é".repeat(512), None, None).is_ok());
        assert!(is_invalid(metadata(&"é".repeat(513), None, None)));
    }

    #[test]
    fn an_empty_subtitle_is_absent_and_a_long_one_refused() {
        assert_eq!(
            metadata("Title", Some("  "), None).expect("valid").subtitle,
            None
        );
        assert!(metadata("Title", Some(&"x".repeat(512)), None).is_ok());
        assert!(is_invalid(metadata("Title", Some(&"x".repeat(513)), None)));
    }

    #[test]
    fn takes_artwork_on_the_saved_server_only() {
        let url = "http://nas.local:8080/api/v1/images/abc?w=300&key=k";
        assert_eq!(
            metadata("Title", None, Some(url))
                .expect("valid")
                .artwork
                .map(|url| url.to_string())
                .as_deref(),
            Some(url)
        );
        assert_eq!(
            metadata("Title", None, Some("")).expect("valid").artwork,
            None
        );
        for refused in [
            "http://nas.local:8081/api/v1/images/abc",
            "https://nas.local:8080/api/v1/images/abc",
            "http://evil.example/x.jpg",
            "file:///C:/x.jpg",
            "data:image/png;base64,AAAA",
            "/api/v1/images/abc",
            "not a url",
            "http://user:pw@nas.local:8080/api/v1/images/abc",
        ] {
            assert!(
                is_invalid(metadata("Title", None, Some(refused))),
                "{refused}"
            );
        }
        let long = format!("{SERVER}/{}", "a".repeat(4096));
        assert!(is_invalid(metadata("Title", None, Some(&long))));
        // No saved server: no artwork, but the rest is fine.
        let url = "http://nas.local:8080/api/v1/images/abc";
        assert!(is_invalid(validate_metadata(
            "Title",
            None,
            Some(url),
            &[],
            None
        )));
        assert!(validate_metadata("Title", None, None, &[], None).is_ok());
    }

    #[test]
    fn parses_the_actions_and_refuses_an_unknown_one() {
        let taken = validate_metadata(
            "Title",
            None,
            None,
            &actions(&["play", "pause", "seekto", "nexttrack", "seekto"]),
            None,
        )
        .expect("valid");
        assert!(taken.actions.contains(MediaAction::Play));
        assert!(taken.actions.contains(MediaAction::SeekTo));
        assert!(taken.actions.contains(MediaAction::NextTrack));
        assert!(!taken.actions.contains(MediaAction::SeekForward));
        assert!(!taken.actions.contains(MediaAction::SeekBackward));
        for name in [
            "play",
            "pause",
            "seekbackward",
            "seekforward",
            "seekto",
            "nexttrack",
        ] {
            assert_eq!(MediaAction::parse(name).map(MediaAction::name), Some(name));
        }
        for unknown in ["stop", "previoustrack", "Play", ""] {
            assert!(
                is_invalid(validate_metadata(
                    "Title",
                    None,
                    None,
                    &actions(&["play", unknown]),
                    None
                )),
                "{unknown}"
            );
        }
    }

    #[test]
    fn validates_the_playback_state() {
        assert_eq!(
            validate_state(true, 1_000.0, 60_000.0, 1.5),
            Ok(PlaybackState {
                playing: true,
                position_ms: 1_000.0,
                duration_ms: 60_000.0,
                rate: 1.5
            })
        );
        // The position stays within the duration.
        assert_eq!(
            validate_state(false, 70_000.0, 60_000.0, 1.0).map(|state| state.position_ms),
            Ok(60_000.0)
        );
        assert_eq!(
            validate_state(false, 5.0, 0.0, 1.0).map(|state| state.position_ms),
            Ok(0.0)
        );
        // A rate that is not positive and finite is 1.
        for rate in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                validate_state(true, 0.0, 10.0, rate).map(|state| state.rate),
                Ok(1.0),
                "{rate}"
            );
        }
        for (position, duration) in [
            (f64::NAN, 10.0),
            (0.0, f64::INFINITY),
            (-1.0, 10.0),
            (0.0, -10.0),
        ] {
            assert!(
                is_invalid(validate_state(true, position, duration, 1.0)),
                "{position} {duration}"
            );
        }
    }

    #[test]
    fn maps_the_buttons_to_actions() {
        assert_eq!(action_for_button(button::PLAY), Some(MediaAction::Play));
        assert_eq!(action_for_button(button::PAUSE), Some(MediaAction::Pause));
        assert_eq!(
            action_for_button(button::NEXT),
            Some(MediaAction::NextTrack)
        );
        assert_eq!(
            action_for_button(button::REWIND),
            Some(MediaAction::SeekBackward)
        );
        assert_eq!(
            action_for_button(button::FAST_FORWARD),
            Some(MediaAction::SeekForward)
        );
        assert_eq!(action_for_button(button::STOP), None);
        assert_eq!(action_for_button(button::PREVIOUS), None);
        assert_eq!(action_for_button(3), None);
        assert_eq!(action_for_button(42), None);
    }

    #[cfg(windows)]
    #[test]
    fn the_button_values_are_the_bindings() {
        use windows::Media::SystemMediaTransportControlsButton as Button;
        assert_eq!(button::PLAY, Button::Play.0);
        assert_eq!(button::PAUSE, Button::Pause.0);
        assert_eq!(button::STOP, Button::Stop.0);
        assert_eq!(button::FAST_FORWARD, Button::FastForward.0);
        assert_eq!(button::REWIND, Button::Rewind.0);
        assert_eq!(button::NEXT, Button::Next.0);
        assert_eq!(button::PREVIOUS, Button::Previous.0);
    }

    #[test]
    fn converts_between_ticks_and_milliseconds() {
        assert_eq!(ms_from_ticks(0), 0);
        assert_eq!(ms_from_ticks(10_000), 1);
        assert_eq!(ms_from_ticks(15_000), 1);
        assert_eq!(ms_from_ticks(42_000 * 10_000), 42_000);
        assert_eq!(ms_from_ticks(-10_000), 0);
        assert_eq!(ticks_from_ms(0.0), 0);
        assert_eq!(ticks_from_ms(1.0), 10_000);
        assert_eq!(ticks_from_ms(1.23456), 12_346);
        assert_eq!(ticks_from_ms(-5.0), 0);
        assert_eq!(ticks_from_ms(f64::NAN), 0);
        assert_eq!(ticks_from_ms(f64::MAX), i64::MAX);
        assert_eq!(
            seek_request(90_000 * 10_000),
            ActionEvent {
                action: "seekto",
                seek_time_ms: Some(90_000)
            }
        );
    }

    #[test]
    fn the_action_payload_is_camel_case_without_absent_fields() {
        let json = |event: &ActionEvent| serde_json::to_string(event).expect("json");
        assert_eq!(
            json(&ActionEvent {
                action: "pause",
                seek_time_ms: None
            }),
            r#"{"action":"pause"}"#
        );
        assert_eq!(
            json(&seek_request(12_340_000)),
            r#"{"action":"seekto","seekTimeMs":1234}"#
        );
    }

    fn recording_session() -> (MediaSession, Arc<Mutex<Vec<ActionEvent>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&sent);
        let session = MediaSession::new(Arc::new(move |event: &ActionEvent| {
            if let Ok(mut sent) = sink.lock() {
                sent.push(event.clone());
            }
        }));
        (session, sent)
    }

    fn sent(events: &Arc<Mutex<Vec<ActionEvent>>>) -> Vec<&'static str> {
        events
            .lock()
            .map(|events| events.iter().map(|event| event.action).collect())
            .unwrap_or_default()
    }

    #[test]
    fn buttons_reach_the_page_while_a_session_is_shown_for_the_actions_it_listed() {
        let (session, events) = recording_session();
        // Nothing shown: nothing sent.
        session.shared.button_pressed(button::PLAY);
        assert!(sent(&events).is_empty());

        session.shared.active.store(true, Ordering::SeqCst);
        session.shared.allowed.store(
            ActionSet::default().with(MediaAction::SeekTo).0,
            Ordering::SeqCst,
        );
        session.shared.button_pressed(button::PAUSE);
        session.shared.button_pressed(button::NEXT);
        session.shared.button_pressed(button::STOP);
        session.shared.position_requested(5_000 * 10_000);
        assert_eq!(sent(&events), vec!["pause", "seekto"]);
    }

    #[test]
    fn without_a_window_the_controls_are_unavailable_and_clearing_is_harmless() {
        let (session, _events) = recording_session();
        let shown = metadata("Title", None, None).expect("valid");
        let state = validate_state(true, 0.0, 10.0, 1.0).expect("valid");
        // Nothing shown yet: an update or a clear does nothing.
        assert_eq!(session.state(&state), Ok(()));
        assert_eq!(session.clear(), Ok(()));
        assert!(matches!(
            session.set(&shown),
            Err(MediaError::Unavailable(_))
        ));
        assert!(!session.shared.active.load(Ordering::SeqCst));
        session.shutdown();
    }

    #[test]
    fn an_artwork_belongs_to_its_session_only() {
        let (session, _events) = recording_session();
        // A session shown as `set` would leave it.
        let first = session.generation.fetch_add(1, Ordering::SeqCst) + 1;
        session.shared.active.store(true, Ordering::SeqCst);
        assert!(session.is_current(first));
        // A later set wins.
        let second = session.generation.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(!session.is_current(first));
        assert!(session.is_current(second));
        // So does a clear.
        assert_eq!(session.clear(), Ok(()));
        assert!(!session.is_current(second));
        // A stale artwork is dropped without touching the controls.
        assert_eq!(
            session.set_thumbnail(
                second,
                &platform::thumbnail(&[1]).unwrap_or_else(|_| panic!("thumbnail"))
            ),
            Ok(())
        );
    }

    #[test]
    fn logs_the_artwork_url_without_its_query() {
        let url = Url::parse("https://projo.example.com/api/v1/images/abc?w=1280&key=secret#x")
            .expect("test url");
        assert_eq!(
            redacted(&url),
            "https://projo.example.com/api/v1/images/abc"
        );
    }

    #[test]
    fn follows_redirects_on_the_server_only() {
        let from = Url::parse("https://projo.example.com/api/v1/images/abc?key=k").expect("url");
        let origin = "https://projo.example.com";
        let to =
            |location: &str| redirect_target(&from, location, origin).map(|url| url.to_string());
        assert_eq!(
            to("/api/v1/images/abc.w1280.webp?key=k").as_deref(),
            Some("https://projo.example.com/api/v1/images/abc.w1280.webp?key=k")
        );
        assert_eq!(
            to("https://projo.example.com/x.jpg").as_deref(),
            Some("https://projo.example.com/x.jpg")
        );
        assert_eq!(to("https://evil.example/x.jpg"), None);
        assert_eq!(to("http://projo.example.com/x.jpg"), None);
        assert_eq!(to("https://projo.example.com:8443/x.jpg"), None);
        assert_eq!(to("https://user:pw@projo.example.com/x.jpg"), None);
        assert_eq!(to("file:///C:/x.jpg"), None);
    }

    #[test]
    fn takes_image_content_types_only() {
        assert!(is_image_content_type(Some("image/webp")));
        assert!(is_image_content_type(Some("Image/JPEG; charset=binary")));
        assert!(is_image_content_type(Some(" image/png ")));
        assert!(!is_image_content_type(Some("text/html")));
        assert!(!is_image_content_type(Some("application/json; image/png")));
        assert!(!is_image_content_type(Some("")));
        assert!(!is_image_content_type(None));
    }

    #[test]
    fn scales_wide_thumbnails_down_only() {
        assert_eq!(scaled_size(1280, 1920, 500), Some((500, 750)));
        assert_eq!(scaled_size(1000, 563, 500), Some((500, 282)));
        assert_eq!(scaled_size(2000, 1, 500), Some((500, 1)));
        assert_eq!(scaled_size(500, 750, 500), None);
        assert_eq!(scaled_size(300, 450, 500), None);
        assert_eq!(scaled_size(0, 0, 500), None);
    }

    #[cfg(windows)]
    #[test]
    fn transcodes_artwork_to_a_jpeg_at_most_500_px_wide() {
        const JPEG: [u8; 3] = [0xff, 0xd8, 0xff];
        let small = platform::png(4, 6).expect("png");
        assert!(small.starts_with(&[0x89, b'P', b'N', b'G']));
        let jpeg = platform::to_jpeg(&small).expect("jpeg");
        assert!(jpeg.starts_with(&JPEG));
        assert_eq!(platform::size_of(&jpeg), Ok((4, 6)));

        let wide = platform::png(1000, 1500).expect("png");
        let jpeg = platform::to_jpeg(&wide).expect("jpeg");
        assert!(jpeg.starts_with(&JPEG));
        assert_eq!(platform::size_of(&jpeg), Ok((500, 750)));

        // Not an image: no JPEG, and the thumbnail falls back to the bytes as they are.
        assert!(platform::to_jpeg(b"not an image").is_err());
        assert!(platform::thumbnail(b"not an image").is_ok());
    }
}
