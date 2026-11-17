//! macOS: the picture under the page (PRODUCT.md §28.5). libmpv cannot draw into another app's view
//! there (`wid` embeds on Windows, X11 and Android only), so the app draws each frame itself through
//! libmpv's OpenGL render API, in a `CAOpenGLLayer` hosted by a view placed under the webview. The
//! page stays transparent over it, as over Windows' child window.
//!
//! Threads and locks:
//! - Core Animation draws the layer on the main thread, with the app's one OpenGL context.
//! - libmpv's update callback (any of its threads) only asks the main thread for a redraw: it may
//!   call no mpv function.
//! - The render context is created (`attach`) and freed (`detach`) on the mpv lifecycle thread,
//!   never waiting on the main thread (the app's exit waits on that thread from the main thread).
//! - Both sides take the OpenGL context's lock, then `RENDER`, in that order.
//!
//! HDR (like IINA): the layer is half-float and EDR-capable; while the video is PQ or HLG and the
//! screen has headroom above SDR white, libmpv renders PQ (`target-trc=pq`, the video's primaries,
//! `target-peak` the screen's peak) and the layer is tagged with the matching PQ colour space,
//! otherwise sRGB with no EDR. libmpv tone maps what the screen cannot reach.
//!
//! OpenGL is deprecated by Apple but is the only render API libmpv offers on macOS.
#![allow(deprecated)]

use std::ffi::{c_int, c_uint, c_void, CStr};
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use dispatch2::{DispatchQueue, MainThreadBound};
use objc2::rc::Retained;
use objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowOrderingMode};
use objc2_core_foundation::CFTimeInterval;
use objc2_core_graphics::{
    kCGColorSpaceDisplayP3_PQ, kCGColorSpaceITUR_2100_PQ, kCGColorSpaceSRGB, CGColorSpace,
};
use objc2_core_video::CVTimeStamp;
use objc2_open_gl::{
    CGLChoosePixelFormat, CGLContextObj, CGLCreateContext, CGLGetCurrentContext, CGLLockContext,
    CGLOpenGLProfile, CGLPixelFormatAttribute, CGLPixelFormatObj, CGLRetainContext,
    CGLRetainPixelFormat, CGLSetCurrentContext, CGLUnlockContext,
};
use objc2_quartz_core::{CALayer, CAOpenGLLayer};
use serde_json::Value;

use super::ffi::{
    MpvApi, MpvHandle, MpvOpenGlFbo, MpvOpenGlInitParams, MpvRenderContext, MpvRenderParam,
    MPV_RENDER_API_TYPE_OPENGL, MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME,
    MPV_RENDER_PARAM_FLIP_Y, MPV_RENDER_PARAM_INVALID, MPV_RENDER_PARAM_OPENGL_FBO,
    MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
};
use super::VideoOutput;

const GL_COLOR_BUFFER_BIT: c_uint = 0x4000;
const GL_VIEWPORT: c_uint = 0x0BA2;
const GL_DRAW_FRAMEBUFFER_BINDING: c_uint = 0x8CA6;
const GL_RGBA16F: c_int = 0x881A;

#[link(name = "OpenGL", kind = "framework")]
extern "C" {
    fn glGetIntegerv(name: c_uint, data: *mut c_int);
    fn glClearColor(red: f32, green: f32, blue: f32, alpha: f32);
    fn glClear(mask: c_uint);
}

/// The app's OpenGL context, created once and never destroyed: the layer draws with it (it hands it
/// to Core Animation) and libmpv's render context is created in it.
struct Gl {
    context: CGLContextObj,
    pixel_format: CGLPixelFormatObj,
    /// Half-float pixels (values above SDR white for EDR), else 8 bits.
    float: bool,
}
// SAFETY: CGL objects may be used from any thread under `CGLLockContext`, which every use takes.
unsafe impl Send for Gl {}
unsafe impl Sync for Gl {}

struct Render {
    api: &'static MpvApi,
    context: *mut MpvRenderContext,
}
// SAFETY: the render context is only used under the OpenGL context's lock and `RENDER`.
unsafe impl Send for Render {}

static GL: OnceLock<Gl> = OnceLock::new();
static RENDER: Mutex<Option<Render>> = Mutex::new(None);
static LAYER: OnceLock<MainThreadBound<Retained<VideoLayer>>> = OnceLock::new();
/// The window's screen's potential EDR headroom (`f64` bits): how far above SDR white it can go.
static HEADROOM: AtomicU64 = AtomicU64::new(0);
/// What the instance renders now (`property_changed`), reset with each instance.
static PICTURE: Mutex<Picture> = Mutex::new(Picture::Sdr);
/// `dlopen(NULL)`: libmpv resolves the OpenGL functions it needs through it.
static PROCESS: OnceLock<libloading::os::unix::Library> = OnceLock::new();

fn render_slot() -> MutexGuard<'static, Option<Render>> {
    RENDER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs `run` with the app's OpenGL context locked and current, then restores the previous one.
fn with_context<T>(gl: &Gl, run: impl FnOnce() -> T) -> T {
    // SAFETY: a live context (never destroyed); lock, current and restore are balanced.
    unsafe {
        CGLLockContext(gl.context);
        let previous = CGLGetCurrentContext();
        CGLSetCurrentContext(gl.context);
        let value = run();
        CGLSetCurrentContext(previous);
        CGLUnlockContext(gl.context);
        value
    }
}

define_class!(
    // SAFETY: CAOpenGLLayer may be subclassed; the overrides keep its contracts (a retained pixel
    // format and context, drawing into the context it passes).
    #[unsafe(super(CAOpenGLLayer, CALayer))]
    #[name = "ProjoVideoLayer"]
    struct VideoLayer;

    impl VideoLayer {
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> CGLPixelFormatObj {
            match GL.get() {
                // SAFETY: a live pixel format; Core Animation releases the reference it is given.
                Some(gl) => unsafe { CGLRetainPixelFormat(gl.pixel_format) },
                None => ptr::null_mut(),
            }
        }

        #[unsafe(method(copyCGLContextForPixelFormat:))]
        fn copy_context(&self, _pixel_format: CGLPixelFormatObj) -> CGLContextObj {
            match GL.get() {
                // SAFETY: a live context; Core Animation releases the reference it is given.
                Some(gl) => unsafe { CGLRetainContext(gl.context) },
                None => ptr::null_mut(),
            }
        }

        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn can_draw(
            &self,
            _context: CGLContextObj,
            _pixel_format: CGLPixelFormatObj,
            _time: CFTimeInterval,
            _display_time: *const CVTimeStamp,
        ) -> bool {
            true
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn draw(
            &self,
            context: CGLContextObj,
            pixel_format: CGLPixelFormatObj,
            time: CFTimeInterval,
            display_time: *const CVTimeStamp,
        ) {
            // SAFETY: Core Animation passes the context it got from `copy_context`, current.
            unsafe { CGLLockContext(context) };
            draw_frame();
            // SAFETY: as above; the superclass flushes the context.
            unsafe {
                let _: () = msg_send![
                    super(self),
                    drawInCGLContext: context,
                    pixelFormat: pixel_format,
                    forLayerTime: time,
                    displayTime: display_time
                ];
                CGLUnlockContext(context);
            }
        }
    }
);

/// The current frame from libmpv, or nothing (transparent) without a render context.
fn draw_frame() {
    let render = render_slot();
    let Some(render) = render.as_ref() else {
        // SAFETY: a current context (Core Animation's draw).
        unsafe {
            glClearColor(0.0, 0.0, 0.0, 0.0);
            glClear(GL_COLOR_BUFFER_BIT);
        }
        return;
    };
    let mut framebuffer: c_int = 0;
    let mut viewport: [c_int; 4] = [0; 4];
    // SAFETY: a current context; both out-parameters have room for the values asked.
    unsafe {
        glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &mut framebuffer);
        glGetIntegerv(GL_VIEWPORT, viewport.as_mut_ptr());
    }
    let float = GL.get().is_some_and(|gl| gl.float);
    let mut target = MpvOpenGlFbo {
        fbo: framebuffer,
        w: viewport[2],
        h: viewport[3],
        internal_format: if float { GL_RGBA16F } else { 0 },
    };
    let mut flip_y: c_int = 1;
    // Never wait for the frame's display time here: this is the main thread (`video-timing-offset`
    // is 0, `GlLayer::options`).
    let mut block: c_int = 0;
    let mut params = [
        param(MPV_RENDER_PARAM_OPENGL_FBO, &mut target),
        param(MPV_RENDER_PARAM_FLIP_Y, &mut flip_y),
        param(MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &mut block),
        end_of_params(),
    ];
    // SAFETY: a live render context (held under `RENDER`), created in this OpenGL context, current;
    // parameters outlive the call.
    let code = unsafe { (render.api.render_context_render)(render.context, params.as_mut_ptr()) };
    if code < 0 {
        log::debug!("mpv render: {}", render.api.error_message(code));
    }
}

fn param<T>(kind: c_int, data: &mut T) -> MpvRenderParam {
    MpvRenderParam {
        kind,
        data: (data as *mut T).cast(),
    }
}

fn end_of_params() -> MpvRenderParam {
    MpvRenderParam {
        kind: MPV_RENDER_PARAM_INVALID,
        data: ptr::null_mut(),
    }
}

/// Asks the main thread to draw the layer again (any thread).
fn request_redraw() {
    DispatchQueue::main().exec_async(|| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if let Some(layer) = LAYER.get() {
            layer.get(mtm).setNeedsDisplay();
        }
    });
}

unsafe extern "C" fn on_update(_context: *mut c_void) {
    request_redraw();
}

unsafe extern "C" fn get_proc_address(
    _context: *mut c_void,
    name: *const std::ffi::c_char,
) -> *mut c_void {
    if name.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: libmpv passes a NUL-terminated name.
    let name = unsafe { CStr::from_ptr(name) };
    let process = PROCESS.get_or_init(libloading::os::unix::Library::this);
    // SAFETY: the address is only handed to libmpv, which calls it with the GL signature it asked
    // for.
    unsafe { process.get::<*mut c_void>(name.to_bytes_with_nul()) }
        .map(|symbol| symbol.into_raw())
        .unwrap_or(ptr::null_mut())
}

fn choose_pixel_format(float: bool) -> Result<CGLPixelFormatObj, String> {
    let mut attributes = vec![
        CGLPixelFormatAttribute::CGLPFAOpenGLProfile,
        CGLPixelFormatAttribute(CGLOpenGLProfile::CGLOGLPVersion_3_2_Core.0),
        CGLPixelFormatAttribute::CGLPFAAccelerated,
        CGLPixelFormatAttribute::CGLPFADoubleBuffer,
        CGLPixelFormatAttribute::CGLPFAAllowOfflineRenderers,
    ];
    if float {
        attributes.extend([
            CGLPixelFormatAttribute::CGLPFAColorSize,
            CGLPixelFormatAttribute(64),
            CGLPixelFormatAttribute::CGLPFAColorFloat,
        ]);
    }
    attributes.push(CGLPixelFormatAttribute(0));
    let mut pixel_format: CGLPixelFormatObj = ptr::null_mut();
    let mut count = 0;
    // SAFETY: a zero-terminated attribute list and valid out-parameters.
    let error = unsafe {
        CGLChoosePixelFormat(
            NonNull::from(&attributes[0]),
            NonNull::from(&mut pixel_format),
            NonNull::from(&mut count),
        )
    };
    if error.0 != 0 || pixel_format.is_null() {
        return Err(format!("no OpenGL pixel format (CGL error {})", error.0));
    }
    Ok(pixel_format)
}

fn create_gl() -> Result<Gl, String> {
    let (pixel_format, float) = match choose_pixel_format(true) {
        Ok(pixel_format) => (pixel_format, true),
        Err(error) => {
            log::warn!("no half-float pixels ({error}): the picture stays SDR");
            (choose_pixel_format(false)?, false)
        }
    };
    let mut context: CGLContextObj = ptr::null_mut();
    // SAFETY: a pixel format chosen above, no shared context, a valid out-parameter.
    let error =
        unsafe { CGLCreateContext(pixel_format, ptr::null_mut(), NonNull::from(&mut context)) };
    if error.0 != 0 || context.is_null() {
        return Err(format!("no OpenGL context (CGL error {})", error.0));
    }
    Ok(Gl {
        context,
        pixel_format,
        float,
    })
}

/// The primaries of an HDR picture, as libmpv names them (`video-params/primaries`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HdrPrimaries {
    Bt2020,
    DisplayP3,
}

/// What the layer shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Picture {
    Sdr,
    /// PQ output for a screen reaching `peak_nits`.
    Hdr {
        primaries: HdrPrimaries,
        peak_nits: u32,
    },
}

/// SDR white in nits, which EDR headroom multiplies.
const SDR_WHITE_NITS: f64 = 100.0;

/// HDR when the video is PQ or HLG on wide primaries and the screen can go above SDR white
/// (`headroom`: its potential EDR value, 1 for an SDR screen); SDR otherwise.
pub fn picture_of(gamma: Option<&str>, primaries: Option<&str>, headroom: f64) -> Picture {
    if !matches!(gamma, Some("pq" | "hlg")) || !headroom.is_finite() || headroom <= 1.0 {
        return Picture::Sdr;
    }
    let primaries = match primaries {
        Some("bt.2020") => HdrPrimaries::Bt2020,
        Some("display-p3") => HdrPrimaries::DisplayP3,
        _ => return Picture::Sdr,
    };
    Picture::Hdr {
        primaries,
        peak_nits: (headroom * SDR_WHITE_NITS).round() as u32,
    }
}

/// libmpv's output for `picture`: PQ in the video's primaries (HLG converted), tone mapped to the
/// screen's peak; for SDR, libmpv's defaults again.
pub fn render_targets(picture: Picture) -> [(&'static str, String); 3] {
    match picture {
        Picture::Sdr => [
            ("target-trc", "auto".into()),
            ("target-prim", "auto".into()),
            ("target-peak", "auto".into()),
        ],
        Picture::Hdr {
            primaries,
            peak_nits,
        } => [
            ("target-trc", "pq".into()),
            (
                "target-prim",
                match primaries {
                    HdrPrimaries::Bt2020 => "bt.2020",
                    HdrPrimaries::DisplayP3 => "display-p3",
                }
                .into(),
            ),
            ("target-peak", peak_nits.to_string()),
        ],
    }
}

fn headroom() -> f64 {
    f64::from_bits(HEADROOM.load(Ordering::SeqCst))
}

/// Tags the layer for `picture` (any thread: done on the main thread) and redraws it.
fn show(picture: Picture) {
    DispatchQueue::main().exec_async(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(layer) = LAYER.get() else {
            return;
        };
        let layer = layer.get(mtm);
        // SAFETY: Core Graphics' named colour space constants.
        let name = unsafe {
            match picture {
                Picture::Sdr => kCGColorSpaceSRGB,
                Picture::Hdr {
                    primaries: HdrPrimaries::Bt2020,
                    ..
                } => kCGColorSpaceITUR_2100_PQ,
                Picture::Hdr {
                    primaries: HdrPrimaries::DisplayP3,
                    ..
                } => kCGColorSpaceDisplayP3_PQ,
            }
        };
        let space = CGColorSpace::with_name(Some(name));
        layer.setWantsExtendedDynamicRangeContent(matches!(picture, Picture::Hdr { .. }));
        layer.setColorspace(space.as_deref());
        layer.setNeedsDisplay();
    });
}

fn picture_slot() -> MutexGuard<'static, Picture> {
    PICTURE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Libmpv's picture drawn by the app in its layer: `vo=libmpv` and a render context per instance.
pub struct GlLayer;

impl VideoOutput for GlLayer {
    fn options(&self) -> Vec<(&'static str, String)> {
        vec![
            ("vo", "libmpv".into()),
            // The layer never waits for a frame's display time (`draw_frame`): libmpv times them.
            ("video-timing-offset", "0".into()),
        ]
    }

    fn attach(&self, api: &'static MpvApi, handle: *mut MpvHandle) -> Result<(), String> {
        let gl = GL.get().ok_or("no OpenGL context for the picture")?;
        with_context(gl, || {
            let mut slot = render_slot();
            let mut init = MpvOpenGlInitParams {
                get_proc_address: Some(get_proc_address),
                get_proc_address_ctx: ptr::null_mut(),
            };
            let mut params = [
                MpvRenderParam {
                    kind: MPV_RENDER_PARAM_API_TYPE,
                    data: MPV_RENDER_API_TYPE_OPENGL.as_ptr().cast_mut().cast(),
                },
                param(MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &mut init),
                end_of_params(),
            ];
            let mut context: *mut MpvRenderContext = ptr::null_mut();
            // SAFETY: an initialised handle, the OpenGL context current, parameters alive for the
            // call.
            let code =
                unsafe { (api.render_context_create)(&mut context, handle, params.as_mut_ptr()) };
            if code < 0 || context.is_null() {
                return Err(format!(
                    "mpv_render_context_create: {}",
                    api.error_message(code)
                ));
            }
            // SAFETY: the render context created above; the callback calls no mpv function.
            unsafe {
                (api.render_context_set_update_callback)(context, Some(on_update), ptr::null_mut())
            };
            *slot = Some(Render { api, context });
            Ok(())
        })?;
        show(Picture::Sdr);
        Ok(())
    }

    fn detach(&self, api: &'static MpvApi) {
        let Some(gl) = GL.get() else {
            return;
        };
        with_context(gl, || {
            if let Some(render) = render_slot().take() {
                // SAFETY: the render context of this instance, no draw using it (`RENDER` held),
                // freed once, before its core is destroyed.
                unsafe {
                    (api.render_context_set_update_callback)(render.context, None, ptr::null_mut());
                    (api.render_context_free)(render.context);
                }
            }
        });
        *picture_slot() = Picture::Sdr;
        // Transparent again: the picture never stays under another page.
        show(Picture::Sdr);
    }

    fn observed(&self) -> &'static [&'static str] {
        &["video-params"]
    }

    fn property_changed(
        &self,
        api: &'static MpvApi,
        handle: *mut MpvHandle,
        name: &str,
        value: Option<&Value>,
    ) {
        if name != "video-params" || !GL.get().is_some_and(|gl| gl.float) {
            return;
        }
        let field = |key: &str| value.and_then(|params| params.get(key)?.as_str());
        let picture = picture_of(field("gamma"), field("primaries"), headroom());
        let mut current = picture_slot();
        if *current == picture {
            return;
        }
        log::info!("picture: {picture:?}");
        for (option, target) in render_targets(picture) {
            let (Ok(c_option), Ok(c_target)) = (
                std::ffi::CString::new(option),
                std::ffi::CString::new(target),
            ) else {
                continue;
            };
            // SAFETY: the live handle of the event thread calling this, NUL-terminated strings.
            let code =
                unsafe { (api.set_property_string)(handle, c_option.as_ptr(), c_target.as_ptr()) };
            if code < 0 {
                log::warn!("set {option}: {}", api.error_message(code));
            }
        }
        *current = picture;
        show(picture);
    }
}

/// Reads what the window's screen can show (main thread): its scale, for full resolution, and its
/// EDR headroom, for the next video.
fn read_screen(window: &NSWindow) {
    let headroom = window.screen().map_or(1.0, |screen| {
        screen.maximumPotentialExtendedDynamicRangeColorComponentValue()
    });
    HEADROOM.store(headroom.to_bits(), Ordering::SeqCst);
}

/// Puts the picture's layer under the webview of `ns_window` (main thread, once the webview is in
/// the window).
pub fn install(ns_window: *mut c_void) -> Result<GlLayer, String> {
    let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
    if ns_window.is_null() {
        return Err("no window".into());
    }
    // SAFETY: Tauri's NSWindow pointer, alive while the app runs (main thread).
    let window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
    let content = window
        .contentView()
        .ok_or("the window has no content view")?;
    if GL.get().is_none() {
        let _ = GL.set(create_gl()?);
    }
    read_screen(window);
    let layer: Retained<VideoLayer> = {
        let allocated = VideoLayer::alloc().set_ivars(());
        // SAFETY: CALayer's designated initialiser.
        unsafe { msg_send![super(allocated), init] }
    };
    layer.setAsynchronous(false);
    layer.setOpaque(false);
    layer.setNeedsDisplayOnBoundsChange(true);
    layer.setContentsScale(window.backingScaleFactor());
    // SAFETY: Core Graphics' named colour space constant.
    layer.setColorspace(CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB })).as_deref());
    let view = NSView::initWithFrame(NSView::alloc(mtm), content.bounds());
    // A layer-hosting view (the layer set before `wantsLayer`): AppKit sizes the layer with the
    // view and draws nothing of its own in it.
    view.setLayer(Some(&layer));
    view.setWantsLayer(true);
    view.setWantsExtendedDynamicRangeOpenGLSurface(true);
    view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    content.setWantsLayer(true);
    content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
    let _ = LAYER.set(MainThreadBound::new(layer, mtm));
    Ok(GlLayer)
}

/// The window moved, maybe to another screen (main thread): the picture keeps full resolution, and
/// the next video uses that screen's headroom.
pub fn screen_changed(ns_window: *mut c_void) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    if ns_window.is_null() {
        return;
    }
    // SAFETY: Tauri's NSWindow pointer, alive while the app runs (main thread).
    let window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
    read_screen(window);
    if let Some(layer) = LAYER.get() {
        let layer = layer.get(mtm);
        let scale = window.backingScaleFactor();
        if layer.contentsScale() != scale {
            layer.setContentsScale(scale);
            layer.setNeedsDisplay();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hdr_video_on_an_hdr_screen() {
        assert_eq!(
            picture_of(Some("pq"), Some("bt.2020"), 16.0),
            Picture::Hdr {
                primaries: HdrPrimaries::Bt2020,
                peak_nits: 1600
            }
        );
        assert_eq!(
            picture_of(Some("hlg"), Some("display-p3"), 2.5),
            Picture::Hdr {
                primaries: HdrPrimaries::DisplayP3,
                peak_nits: 250
            }
        );
    }

    #[test]
    fn sdr_otherwise() {
        assert_eq!(picture_of(Some("pq"), Some("bt.2020"), 1.0), Picture::Sdr);
        assert_eq!(
            picture_of(Some("pq"), Some("bt.2020"), f64::NAN),
            Picture::Sdr
        );
        assert_eq!(
            picture_of(Some("bt.1886"), Some("bt.709"), 16.0),
            Picture::Sdr
        );
        assert_eq!(picture_of(Some("pq"), Some("bt.709"), 16.0), Picture::Sdr);
        assert_eq!(picture_of(None, None, 16.0), Picture::Sdr);
    }

    #[test]
    fn render_targets_follow_the_picture() {
        let hdr = render_targets(Picture::Hdr {
            primaries: HdrPrimaries::Bt2020,
            peak_nits: 1000,
        });
        assert_eq!(hdr[0], ("target-trc", "pq".to_string()));
        assert_eq!(hdr[1], ("target-prim", "bt.2020".to_string()));
        assert_eq!(hdr[2], ("target-peak", "1000".to_string()));
        assert!(render_targets(Picture::Sdr)
            .iter()
            .all(|(_, value)| value == "auto"));
    }
}
