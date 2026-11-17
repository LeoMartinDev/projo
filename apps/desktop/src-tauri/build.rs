fn main() {
    // App commands get ACL permissions (`allow-mpv-init`…), granted to the bundled page only by
    // capabilities/main.json.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "mpv_init",
        "mpv_command",
        "mpv_set_property",
        "mpv_get_property",
        "mpv_observe",
        "mpv_destroy",
        "desktop_window_ready",
        "desktop_info",
        "desktop_device",
        "desktop_update_status",
        "desktop_update_install",
        "get_server",
        "check_server",
        "save_server",
        "get_token",
        "set_token",
        "clear_token",
        "change_server",
        "media_session_set",
        "media_session_state",
        "media_session_clear",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri build configuration");
    // macOS: `libmpv.dylib` names its dependencies `@rpath/…` (PRODUCT.md §28.11); the executable
    // gives the bundle's Frameworks/ and, for debug builds, where `fetch-libmpv` puts them.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,@executable_path/../Frameworks");
        if std::env::var("PROFILE").as_deref() == Ok("debug") {
            let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
            println!("cargo:rustc-link-arg-bins=-Wl,-rpath,{manifest}/lib/macos");
        }
    }
}
