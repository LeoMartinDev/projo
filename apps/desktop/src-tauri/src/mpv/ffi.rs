//! The subset of libmpv's C client API (`mpv/client.h`, API 2.x) the app uses, and of its render API
//! (`mpv/render.h`, `mpv/render_gl.h`: macOS, where libmpv cannot draw into the app's window
//! itself), loaded at runtime with `libloading` so the executable starts (and shows the bundled
//! page) even without the library.

use std::ffi::{c_char, c_double, c_int, c_void, CStr};
use std::path::{Path, PathBuf};

use libloading::Library;

#[repr(C)]
pub struct MpvHandle {
    _private: [u8; 0],
}

pub type MpvFormat = c_int;
pub const MPV_FORMAT_NONE: MpvFormat = 0;
pub const MPV_FORMAT_STRING: MpvFormat = 1;
pub const MPV_FORMAT_OSD_STRING: MpvFormat = 2;
pub const MPV_FORMAT_FLAG: MpvFormat = 3;
pub const MPV_FORMAT_INT64: MpvFormat = 4;
pub const MPV_FORMAT_DOUBLE: MpvFormat = 5;
pub const MPV_FORMAT_NODE: MpvFormat = 6;
pub const MPV_FORMAT_NODE_ARRAY: MpvFormat = 7;
pub const MPV_FORMAT_NODE_MAP: MpvFormat = 8;
pub const MPV_FORMAT_BYTE_ARRAY: MpvFormat = 9;

pub const MPV_ERROR_OPTION_NOT_FOUND: c_int = -5;
pub const MPV_ERROR_PROPERTY_UNAVAILABLE: c_int = -10;

pub type MpvEventId = c_int;
pub const MPV_EVENT_NONE: MpvEventId = 0;
pub const MPV_EVENT_SHUTDOWN: MpvEventId = 1;
pub const MPV_EVENT_END_FILE: MpvEventId = 7;
pub const MPV_EVENT_FILE_LOADED: MpvEventId = 8;
pub const MPV_EVENT_SEEK: MpvEventId = 20;
pub const MPV_EVENT_PLAYBACK_RESTART: MpvEventId = 21;
pub const MPV_EVENT_PROPERTY_CHANGE: MpvEventId = 22;

pub const MPV_END_FILE_REASON_EOF: c_int = 0;
pub const MPV_END_FILE_REASON_STOP: c_int = 2;
pub const MPV_END_FILE_REASON_QUIT: c_int = 3;
pub const MPV_END_FILE_REASON_ERROR: c_int = 4;
pub const MPV_END_FILE_REASON_REDIRECT: c_int = 5;

#[repr(C)]
#[derive(Clone, Copy)]
pub union MpvNodeValue {
    pub string: *mut c_char,
    pub flag: c_int,
    pub int64: i64,
    pub double: c_double,
    pub list: *mut MpvNodeList,
    pub ba: *mut MpvByteArray,
}

#[repr(C)]
pub struct MpvNode {
    pub u: MpvNodeValue,
    pub format: MpvFormat,
}

#[repr(C)]
pub struct MpvNodeList {
    pub num: c_int,
    pub values: *mut MpvNode,
    pub keys: *mut *mut c_char,
}

#[repr(C)]
pub struct MpvByteArray {
    pub data: *mut c_void,
    pub size: usize,
}

#[repr(C)]
pub struct MpvEvent {
    pub event_id: MpvEventId,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventProperty {
    pub name: *const c_char,
    pub format: MpvFormat,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventEndFile {
    pub reason: c_int,
    pub error: c_int,
    pub playlist_entry_id: i64,
    pub playlist_insert_id: i64,
    pub playlist_insert_num_entries: c_int,
}

#[repr(C)]
pub struct MpvRenderContext {
    _private: [u8; 0],
}

#[repr(C)]
pub struct MpvRenderParam {
    pub kind: c_int,
    pub data: *mut c_void,
}

pub const MPV_RENDER_PARAM_INVALID: c_int = 0;
pub const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
pub const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
pub const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
pub const MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;
pub const MPV_RENDER_API_TYPE_OPENGL: &CStr = c"opengl";

pub type GetProcAddressFn = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void;

#[repr(C)]
pub struct MpvOpenGlInitParams {
    pub get_proc_address: Option<GetProcAddressFn>,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct MpvOpenGlFbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

pub type RenderUpdateFn = unsafe extern "C" fn(*mut c_void);

type RenderContextCreateFn =
    unsafe extern "C" fn(*mut *mut MpvRenderContext, *mut MpvHandle, *mut MpvRenderParam) -> c_int;
type RenderContextSetUpdateCallbackFn =
    unsafe extern "C" fn(*mut MpvRenderContext, Option<RenderUpdateFn>, *mut c_void);
type RenderContextRenderFn =
    unsafe extern "C" fn(*mut MpvRenderContext, *mut MpvRenderParam) -> c_int;
type RenderContextFreeFn = unsafe extern "C" fn(*mut MpvRenderContext);

type CreateFn = unsafe extern "C" fn() -> *mut MpvHandle;
type InitializeFn = unsafe extern "C" fn(*mut MpvHandle) -> c_int;
type TerminateDestroyFn = unsafe extern "C" fn(*mut MpvHandle);
type SetOptionStringFn =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type CommandFn = unsafe extern "C" fn(*mut MpvHandle, *mut *const c_char) -> c_int;
type SetPropertyStringFn =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type GetPropertyFn =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, MpvFormat, *mut c_void) -> c_int;
type ObservePropertyFn =
    unsafe extern "C" fn(*mut MpvHandle, u64, *const c_char, MpvFormat) -> c_int;
type WaitEventFn = unsafe extern "C" fn(*mut MpvHandle, c_double) -> *mut MpvEvent;
type WakeupFn = unsafe extern "C" fn(*mut MpvHandle);
type FreeNodeContentsFn = unsafe extern "C" fn(*mut MpvNode);
type ErrorStringFn = unsafe extern "C" fn(c_int) -> *const c_char;

/// Function pointers resolved from libmpv. The library is kept loaded for the whole process
/// (stored in a `static`), so the pointers never dangle.
pub struct MpvApi {
    _library: Library,
    pub create: CreateFn,
    pub initialize: InitializeFn,
    pub terminate_destroy: TerminateDestroyFn,
    pub set_option_string: SetOptionStringFn,
    pub command: CommandFn,
    pub set_property_string: SetPropertyStringFn,
    pub get_property: GetPropertyFn,
    pub observe_property: ObservePropertyFn,
    pub wait_event: WaitEventFn,
    pub wakeup: WakeupFn,
    pub free_node_contents: FreeNodeContentsFn,
    error_string: ErrorStringFn,
    pub render_context_create: RenderContextCreateFn,
    pub render_context_set_update_callback: RenderContextSetUpdateCallbackFn,
    pub render_context_render: RenderContextRenderFn,
    pub render_context_free: RenderContextFreeFn,
}

#[cfg(not(target_os = "macos"))]
pub const LIBRARY_NAME: &str = "libmpv-2.dll";
#[cfg(target_os = "macos")]
pub const LIBRARY_NAME: &str = "libmpv.dylib";

/// Where the library is looked for, in order: next to the executable, `lib/` next to it (the
/// installed layout on Windows: bundled resource), and in debug builds `src-tauri/lib/` (where
/// `fetch-libmpv` puts it). On macOS: the app bundle's `Frameworks/`, and in debug builds
/// `src-tauri/lib/macos/`, then Homebrew's (`brew install mpv`; a GPL build, never bundled). The
/// libraries `libmpv.dylib` needs are found through the executable's rpaths (build.rs).
pub fn library_candidates(exe_dir: &Path) -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push(exe_dir.join("../Frameworks").join(LIBRARY_NAME));
        if cfg!(debug_assertions) {
            candidates.push(manifest.join("lib/macos").join(LIBRARY_NAME));
            candidates.push(Path::new("/opt/homebrew/lib").join(LIBRARY_NAME));
        }
        return candidates;
    }
    candidates.push(exe_dir.join(LIBRARY_NAME));
    candidates.push(exe_dir.join("lib").join(LIBRARY_NAME));
    if cfg!(debug_assertions) {
        candidates.push(manifest.join("lib").join(LIBRARY_NAME));
    }
    candidates
}

macro_rules! symbol {
    ($library:expr, $name:literal, $type:ty) => {{
        // SAFETY: the type of each symbol is the one declared in mpv/client.h.
        let symbol: libloading::Symbol<$type> =
            unsafe { $library.get(concat!($name, "\0").as_bytes()) }
                .map_err(|error| format!("{}: missing symbol {}: {error}", LIBRARY_NAME, $name))?;
        *symbol
    }};
}

impl MpvApi {
    pub fn load(candidates: &[PathBuf]) -> Result<MpvApi, String> {
        let path = candidates
            .iter()
            .find(|path| path.is_file())
            .ok_or_else(|| format!("{LIBRARY_NAME} not found (looked in {candidates:?})"))?;
        // SAFETY: loading libmpv runs its initialisers, which have no preconditions.
        let library = unsafe { Library::new(path) }
            .map_err(|error| format!("cannot load {}: {error}", path.display()))?;
        let create = symbol!(library, "mpv_create", CreateFn);
        let initialize = symbol!(library, "mpv_initialize", InitializeFn);
        let terminate_destroy = symbol!(library, "mpv_terminate_destroy", TerminateDestroyFn);
        let set_option_string = symbol!(library, "mpv_set_option_string", SetOptionStringFn);
        let command = symbol!(library, "mpv_command", CommandFn);
        let set_property_string = symbol!(library, "mpv_set_property_string", SetPropertyStringFn);
        let get_property = symbol!(library, "mpv_get_property", GetPropertyFn);
        let observe_property = symbol!(library, "mpv_observe_property", ObservePropertyFn);
        let wait_event = symbol!(library, "mpv_wait_event", WaitEventFn);
        let wakeup = symbol!(library, "mpv_wakeup", WakeupFn);
        let free_node_contents = symbol!(library, "mpv_free_node_contents", FreeNodeContentsFn);
        let error_string = symbol!(library, "mpv_error_string", ErrorStringFn);
        let render_context_create =
            symbol!(library, "mpv_render_context_create", RenderContextCreateFn);
        let render_context_set_update_callback = symbol!(
            library,
            "mpv_render_context_set_update_callback",
            RenderContextSetUpdateCallbackFn
        );
        let render_context_render =
            symbol!(library, "mpv_render_context_render", RenderContextRenderFn);
        let render_context_free = symbol!(library, "mpv_render_context_free", RenderContextFreeFn);
        log::info!("loaded {}", path.display());
        Ok(MpvApi {
            _library: library,
            create,
            initialize,
            terminate_destroy,
            set_option_string,
            command,
            set_property_string,
            get_property,
            observe_property,
            wait_event,
            wakeup,
            free_node_contents,
            error_string,
            render_context_create,
            render_context_set_update_callback,
            render_context_render,
            render_context_free,
        })
    }

    pub fn error_message(&self, code: c_int) -> String {
        // SAFETY: mpv_error_string returns a static string for any code (never NULL).
        let message = unsafe { (self.error_string)(code) };
        if message.is_null() {
            return format!("mpv error {code}");
        }
        // SAFETY: non-NULL, NUL-terminated static string.
        unsafe { CStr::from_ptr(message) }
            .to_string_lossy()
            .into_owned()
    }
}
