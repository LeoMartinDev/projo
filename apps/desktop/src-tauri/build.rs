fn main() {
    // App commands get ACL permissions (`allow-mpv-init`…): the server origin is granted them at
    // runtime (commands::SERVER_PERMISSIONS), the bundled page through capabilities/setup.json.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "mpv_init",
        "mpv_command",
        "mpv_set_property",
        "mpv_get_property",
        "mpv_observe",
        "mpv_destroy",
        "desktop_info",
        "get_setup",
        "connect_server",
        "change_server",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri build configuration");
}
