//! One libmpv instance drawn into the main window (`wid`), driven by the server page through IPC.
//!
//! Threads and lifetimes (the reason for this shape):
//! - Creating and destroying the instance runs on one `lifecycle` worker thread, in the order it was
//!   asked (a page load's destroy always lands before the next page's init). Never on the UI thread:
//!   mpv's video window is a child of the main window, created and destroyed on mpv's own threads,
//!   which message the parent window; blocking the UI thread there would deadlock.
//! - Calls on a live instance (command, properties, observe) take a read lock; destroy takes the
//!   write lock, so it waits for calls in flight and no call can reach a destroyed handle.
//! - The event thread owns `mpv_wait_event`. Destroy stops it (flag + `mpv_wakeup`) and joins it
//!   before `mpv_terminate_destroy`.
//! - The DLL is loaded once and never unloaded.

pub mod ffi;
pub mod guard;
pub mod node;

use std::collections::{BTreeMap, HashSet};
use std::ffi::{c_void, CString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread::JoinHandle;

use serde::Serialize;
use serde_json::Value;

use ffi::{
    MpvApi, MpvEventEndFile, MpvEventProperty, MpvHandle, MpvNode, MpvNodeValue,
    MPV_ERROR_PROPERTY_UNAVAILABLE, MPV_FORMAT_NODE, MPV_FORMAT_NONE,
};

#[derive(Debug, Clone, Serialize)]
pub struct PropertyPayload {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventPayload {
    pub event: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub enum Emitted {
    Property(PropertyPayload),
    Event(EventPayload),
}

pub type Sink = Arc<dyn Fn(Emitted) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MpvError {
    LibraryMissing(String),
    NotInitialized,
    Refused(String),
    InvalidArgument(String),
    Failed(String),
}

impl MpvError {
    pub fn code(&self) -> &'static str {
        match self {
            MpvError::LibraryMissing(_) => "mpv/library_missing",
            MpvError::NotInitialized => "mpv/not_initialized",
            MpvError::Refused(_) => "mpv/refused",
            MpvError::InvalidArgument(_) => "mpv/invalid_argument",
            MpvError::Failed(_) => "mpv/failed",
        }
    }
    pub fn message(&self) -> String {
        match self {
            MpvError::LibraryMissing(message)
            | MpvError::Refused(message)
            | MpvError::InvalidArgument(message)
            | MpvError::Failed(message) => message.clone(),
            MpvError::NotInitialized => "mpv is not initialised (call mpv_init)".into(),
        }
    }
}

#[derive(Clone, Copy)]
struct Handle(*mut MpvHandle);
// SAFETY: the libmpv client API is thread-safe for one handle (mpv/client.h, "Thread safety"); the
// handle is only destroyed after every user of it is gone (see the module comment).
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}

struct Instance {
    handle: Handle,
    stop: Arc<AtomicBool>,
    events: Option<JoinHandle<()>>,
    observed: Mutex<HashSet<String>>,
}

type Job = Box<dyn FnOnce() + Send>;

pub struct Player {
    library_candidates: Vec<PathBuf>,
    instance: RwLock<Option<Instance>>,
    lifecycle: Mutex<Sender<Job>>,
    wid: AtomicI64,
    sink: Sink,
    version: OnceLock<String>,
}

static API: OnceLock<Result<MpvApi, String>> = OnceLock::new();

fn cstring(value: &str) -> Result<CString, MpvError> {
    CString::new(value).map_err(|_| MpvError::InvalidArgument(format!("NUL byte in {value:?}")))
}

impl Player {
    pub fn new(library_candidates: Vec<PathBuf>, sink: Sink) -> Arc<Player> {
        let (sender, receiver) = mpsc::channel::<Job>();
        let spawned = std::thread::Builder::new()
            .name("mpv-lifecycle".into())
            .spawn(move || {
                for job in receiver {
                    job();
                }
            });
        if let Err(error) = spawned {
            // Without the worker, every lifecycle call reports `mpv/failed` (the channel is closed).
            log::error!("cannot start the mpv lifecycle thread: {error}");
        }
        Arc::new(Player {
            library_candidates,
            instance: RwLock::new(None),
            lifecycle: Mutex::new(sender),
            wid: AtomicI64::new(0),
            sink,
            version: OnceLock::new(),
        })
    }

    /// The native window mpv draws into (HWND on Windows).
    pub fn set_wid(&self, wid: i64) {
        self.wid.store(wid, Ordering::SeqCst);
    }

    fn api(&self) -> Result<&'static MpvApi, MpvError> {
        API.get_or_init(|| MpvApi::load(&self.library_candidates))
            .as_ref()
            .map_err(|message| MpvError::LibraryMissing(message.clone()))
    }

    /// Runs `job` on the lifecycle thread and returns a receiver for its result.
    fn on_lifecycle<T: Send + 'static>(
        self: &Arc<Self>,
        job: impl FnOnce(&Arc<Player>) -> T + Send + 'static,
    ) -> Receiver<T> {
        let (sender, receiver) = mpsc::channel();
        let player = Arc::clone(self);
        let queued = self
            .lifecycle
            .lock()
            .map(|lifecycle| {
                lifecycle.send(Box::new(move || {
                    let _ = sender.send(job(&player));
                }))
            })
            .is_ok_and(|sent| sent.is_ok());
        if !queued {
            log::error!("the mpv lifecycle thread is gone");
        }
        receiver
    }

    fn wait<T>(receiver: Receiver<Result<T, MpvError>>) -> Result<T, MpvError> {
        receiver
            .recv()
            .unwrap_or_else(|_| Err(MpvError::Failed("the mpv lifecycle thread is gone".into())))
    }

    /// Creates the instance if there is none (or if its core has shut down). Blocking.
    pub fn init_blocking(
        self: &Arc<Self>,
        options: BTreeMap<String, String>,
    ) -> Result<(), MpvError> {
        Self::wait(self.on_lifecycle(move |player| player.init_now(&options)))
    }

    /// Stops and destroys the instance, if any. Blocking.
    pub fn destroy_blocking(self: &Arc<Self>) {
        let _ = self.on_lifecycle(|player| player.destroy_now()).recv();
    }

    /// Queues a destroy without waiting (UI thread: page loads).
    pub fn destroy_later(self: &Arc<Self>) {
        drop(self.on_lifecycle(|player| player.destroy_now()));
    }

    pub fn has_instance(&self) -> bool {
        self.instance
            .read()
            .map(|instance| instance.is_some())
            .unwrap_or(false)
    }

    fn init_now(self: &Arc<Self>, options: &BTreeMap<String, String>) -> Result<(), MpvError> {
        for name in options.keys() {
            guard::check_option(name).map_err(MpvError::Refused)?;
        }
        let alive = self
            .instance
            .read()
            .map(|instance| {
                instance.as_ref().map(|instance| {
                    instance
                        .events
                        .as_ref()
                        .is_some_and(|events| !events.is_finished())
                })
            })
            .map_err(|_| MpvError::Failed("mpv state poisoned".into()))?;
        match alive {
            Some(true) => return Ok(()),
            Some(false) => self.destroy_now(),
            None => {}
        }
        let api = self.api()?;
        // SAFETY: mpv_create has no preconditions; NULL is checked.
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err(MpvError::Failed("mpv_create failed".into()));
        }
        let handle = Handle(handle);
        if let Err(error) = self.configure(api, handle, options) {
            // SAFETY: the handle was created above and is used by nobody else.
            unsafe { (api.terminate_destroy)(handle.0) };
            return Err(error);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let events = {
            let stop = Arc::clone(&stop);
            let sink = Arc::clone(&self.sink);
            std::thread::Builder::new()
                .name("mpv-events".into())
                .spawn(move || event_loop(api, handle, &stop, &sink))
        };
        let events = match events {
            Ok(events) => events,
            Err(error) => {
                // SAFETY: no event thread started; nobody else holds the handle.
                unsafe { (api.terminate_destroy)(handle.0) };
                return Err(MpvError::Failed(format!(
                    "cannot start the mpv event thread: {error}"
                )));
            }
        };
        let mut instance = self
            .instance
            .write()
            .map_err(|_| MpvError::Failed("mpv state poisoned".into()))?;
        *instance = Some(Instance {
            handle,
            stop,
            events: Some(events),
            observed: Mutex::new(HashSet::new()),
        });
        log::info!("mpv instance created");
        Ok(())
    }

    fn configure(
        &self,
        api: &MpvApi,
        handle: Handle,
        options: &BTreeMap<String, String>,
    ) -> Result<(), MpvError> {
        let set = |name: &str, value: &str| -> Result<(), MpvError> {
            let (c_name, c_value) = (cstring(name)?, cstring(value)?);
            // SAFETY: valid handle (before mpv_initialize), NUL-terminated strings.
            let code =
                unsafe { (api.set_option_string)(handle.0, c_name.as_ptr(), c_value.as_ptr()) };
            if code < 0 {
                return Err(MpvError::Failed(format!(
                    "option {name}={value}: {}",
                    api.error_message(code)
                )));
            }
            Ok(())
        };
        for (name, value) in guard::DEFAULT_OPTIONS {
            set(name, value)?;
        }
        for (name, value) in options {
            set(name, value)?;
        }
        for (name, value) in guard::FORCED_OPTIONS {
            set(name, value)?;
        }
        let wid = self.wid.load(Ordering::SeqCst);
        if wid != 0 {
            set("wid", &wid.to_string())?;
        }
        // SAFETY: valid, configured handle.
        let code = unsafe { (api.initialize)(handle.0) };
        if code < 0 {
            return Err(MpvError::Failed(format!(
                "mpv_initialize: {}",
                api.error_message(code)
            )));
        }
        Ok(())
    }

    fn destroy_now(&self) {
        let Some(api) = API.get().and_then(|api| api.as_ref().ok()) else {
            return;
        };
        let taken = match self.instance.write() {
            Ok(mut instance) => instance.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };
        let Some(mut instance) = taken else {
            return;
        };
        instance.stop.store(true, Ordering::SeqCst);
        // SAFETY: the handle is still alive (destroyed below, after the event thread is joined).
        unsafe { (api.wakeup)(instance.handle.0) };
        if let Some(events) = instance.events.take() {
            if events.join().is_err() {
                log::error!("the mpv event thread panicked");
            }
        }
        // SAFETY: no reader left (write lock taken above, event thread joined).
        unsafe { (api.terminate_destroy)(instance.handle.0) };
        log::info!("mpv instance destroyed");
    }

    fn with_instance<T>(
        &self,
        run: impl FnOnce(&MpvApi, &Instance) -> Result<T, MpvError>,
    ) -> Result<T, MpvError> {
        let api = self.api()?;
        let instance = self
            .instance
            .read()
            .map_err(|_| MpvError::Failed("mpv state poisoned".into()))?;
        match instance.as_ref() {
            Some(instance) => run(api, instance),
            None => Err(MpvError::NotInitialized),
        }
    }

    pub fn command(&self, args: &[String]) -> Result<(), MpvError> {
        guard::check_command(args).map_err(MpvError::Refused)?;
        let c_args = args
            .iter()
            .map(|arg| cstring(arg))
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers: Vec<*const std::ffi::c_char> =
            c_args.iter().map(|arg| arg.as_ptr()).collect();
        pointers.push(std::ptr::null());
        self.with_instance(|api, instance| {
            // SAFETY: live handle (read lock), NULL-terminated array of NUL-terminated strings.
            let code = unsafe { (api.command)(instance.handle.0, pointers.as_mut_ptr()) };
            if code < 0 {
                return Err(MpvError::Failed(format!(
                    "{}: {}",
                    args.join(" "),
                    api.error_message(code)
                )));
            }
            Ok(())
        })
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), MpvError> {
        guard::check_option(name).map_err(MpvError::Refused)?;
        let (c_name, c_value) = (cstring(name)?, cstring(value)?);
        self.with_instance(|api, instance| {
            // SAFETY: live handle, NUL-terminated strings.
            let code = unsafe {
                (api.set_property_string)(instance.handle.0, c_name.as_ptr(), c_value.as_ptr())
            };
            if code < 0 {
                return Err(MpvError::Failed(format!(
                    "set {name}={value}: {}",
                    api.error_message(code)
                )));
            }
            Ok(())
        })
    }

    /// The property as JSON, `None` when mpv has no value for it now (unavailable).
    pub fn get_property(&self, name: &str) -> Result<Option<Value>, MpvError> {
        let c_name = cstring(name)?;
        self.with_instance(|api, instance| get_node(api, instance.handle, &c_name, name))
    }

    pub fn observe(&self, names: &[String]) -> Result<(), MpvError> {
        let c_names = names
            .iter()
            .map(|name| cstring(name))
            .collect::<Result<Vec<_>, _>>()?;
        self.with_instance(|api, instance| {
            let mut observed = instance
                .observed
                .lock()
                .map_err(|_| MpvError::Failed("mpv state poisoned".into()))?;
            for (name, c_name) in names.iter().zip(&c_names) {
                if observed.contains(name) {
                    continue;
                }
                // SAFETY: live handle, NUL-terminated name.
                let code = unsafe {
                    (api.observe_property)(instance.handle.0, 0, c_name.as_ptr(), MPV_FORMAT_NODE)
                };
                if code < 0 {
                    return Err(MpvError::Failed(format!(
                        "observe {name}: {}",
                        api.error_message(code)
                    )));
                }
                observed.insert(name.clone());
            }
            Ok(())
        })
    }

    /// `mpv-version`, from the live instance or a short-lived headless one (cached).
    pub fn mpv_version_blocking(self: &Arc<Self>) -> Result<String, MpvError> {
        if let Some(version) = self.version.get() {
            return Ok(version.clone());
        }
        let version = Self::wait(self.on_lifecycle(|player| player.read_version()))?;
        Ok(self.version.get_or_init(|| version).clone())
    }

    fn read_version(&self) -> Result<String, MpvError> {
        let c_name = cstring("mpv-version")?;
        let from_instance = self
            .with_instance(|api, instance| get_node(api, instance.handle, &c_name, "mpv-version"));
        let value = match from_instance {
            Err(MpvError::NotInitialized) => {
                let api = self.api()?;
                // SAFETY: fresh handle, never shared, destroyed before returning.
                let handle = unsafe { (api.create)() };
                if handle.is_null() {
                    return Err(MpvError::Failed("mpv_create failed".into()));
                }
                let handle = Handle(handle);
                // Initialised without window, video or audio: nothing is shown or played.
                let value = initialize_headless(api, handle)
                    .and_then(|()| get_node(api, handle, &c_name, "mpv-version"));
                // SAFETY: as above.
                unsafe { (api.terminate_destroy)(handle.0) };
                value?
            }
            other => other?,
        };
        match value {
            Some(Value::String(version)) => Ok(version),
            other => Err(MpvError::Failed(format!(
                "unexpected mpv-version {other:?}"
            ))),
        }
    }
}

fn initialize_headless(api: &MpvApi, handle: Handle) -> Result<(), MpvError> {
    for (name, value) in [
        ("config", "no"),
        ("load-scripts", "no"),
        ("vo", "null"),
        ("ao", "null"),
        ("idle", "yes"),
    ] {
        let (c_name, c_value) = (cstring(name)?, cstring(value)?);
        // SAFETY: valid handle (before mpv_initialize), NUL-terminated strings.
        let code = unsafe { (api.set_option_string)(handle.0, c_name.as_ptr(), c_value.as_ptr()) };
        if code < 0 {
            return Err(MpvError::Failed(format!(
                "option {name}={value}: {}",
                api.error_message(code)
            )));
        }
    }
    // SAFETY: valid, configured handle.
    let code = unsafe { (api.initialize)(handle.0) };
    if code < 0 {
        return Err(MpvError::Failed(format!(
            "mpv_initialize: {}",
            api.error_message(code)
        )));
    }
    Ok(())
}

fn get_node(
    api: &MpvApi,
    handle: Handle,
    c_name: &CString,
    name: &str,
) -> Result<Option<Value>, MpvError> {
    let mut node = MpvNode {
        u: MpvNodeValue { int64: 0 },
        format: MPV_FORMAT_NONE,
    };
    // SAFETY: live handle, NUL-terminated name, `node` is a valid out-parameter for MPV_FORMAT_NODE.
    let code = unsafe {
        (api.get_property)(
            handle.0,
            c_name.as_ptr(),
            MPV_FORMAT_NODE,
            &mut node as *mut MpvNode as *mut c_void,
        )
    };
    if code == MPV_ERROR_PROPERTY_UNAVAILABLE {
        return Ok(None);
    }
    if code < 0 {
        return Err(MpvError::Failed(format!(
            "get {name}: {}",
            api.error_message(code)
        )));
    }
    // SAFETY: on success mpv filled `node`; it is converted, then freed exactly once.
    let value = unsafe { node::node_to_json(&node) };
    unsafe { (api.free_node_contents)(&mut node) };
    Ok(value)
}

fn end_reason(reason: i32) -> Option<&'static str> {
    match reason {
        ffi::MPV_END_FILE_REASON_EOF => Some("eof"),
        ffi::MPV_END_FILE_REASON_STOP => Some("stop"),
        ffi::MPV_END_FILE_REASON_QUIT => Some("quit"),
        ffi::MPV_END_FILE_REASON_ERROR => Some("error"),
        ffi::MPV_END_FILE_REASON_REDIRECT => Some("redirect"),
        _ => None,
    }
}

fn event(name: &'static str) -> Emitted {
    Emitted::Event(EventPayload {
        event: name,
        reason: None,
        error: None,
    })
}

fn event_loop(api: &'static MpvApi, handle: Handle, stop: &AtomicBool, sink: &Sink) {
    loop {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: live handle (joined before destroy); this is the only thread waiting on it.
        let raw = unsafe { (api.wait_event)(handle.0, -1.0) };
        if raw.is_null() {
            continue;
        }
        // SAFETY: mpv returns a valid event, alive until the next mpv_wait_event call; everything
        // needed is copied out before looping.
        let current = unsafe { &*raw };
        match current.event_id {
            ffi::MPV_EVENT_NONE => {}
            ffi::MPV_EVENT_SHUTDOWN => {
                sink(event("shutdown"));
                return;
            }
            ffi::MPV_EVENT_FILE_LOADED => sink(event("file-loaded")),
            ffi::MPV_EVENT_PLAYBACK_RESTART => sink(event("playback-restart")),
            ffi::MPV_EVENT_SEEK => sink(event("seek")),
            ffi::MPV_EVENT_END_FILE if !current.data.is_null() => {
                // SAFETY: END_FILE carries an mpv_event_end_file.
                let end = unsafe { &*(current.data as *const MpvEventEndFile) };
                let reason = end_reason(end.reason);
                let error = (reason == Some("error")).then(|| api.error_message(end.error));
                sink(Emitted::Event(EventPayload {
                    event: "end-file",
                    reason,
                    error,
                }));
            }
            ffi::MPV_EVENT_PROPERTY_CHANGE if !current.data.is_null() => {
                // SAFETY: PROPERTY_CHANGE carries an mpv_event_property; with MPV_FORMAT_NODE its data
                // points to an mpv_node.
                let property = unsafe { &*(current.data as *const MpvEventProperty) };
                let Some(name) = (unsafe { node::c_string(property.name) }) else {
                    continue;
                };
                let value = if property.format == MPV_FORMAT_NODE && !property.data.is_null() {
                    unsafe { node::node_to_json(&*(property.data as *const MpvNode)) }
                } else {
                    None
                };
                sink(Emitted::Property(PropertyPayload { name, value }));
            }
            _ => {}
        }
    }
}
