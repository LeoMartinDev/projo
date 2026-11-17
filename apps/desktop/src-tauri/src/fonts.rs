//! Geist for libmpv's subtitles (PRODUCT.md §28.7): libass draws them and reads TrueType, not the
//! web's woff2, so the app writes the bundled SemiBold and its italic — the weight of the web's
//! captions (`.captions` of player.css) — into its config directory, and the player points
//! libmpv's `sub-fonts-dir` at it with `sub-font` = [`FAMILY`] (mpv/mod.rs) for plain text
//! subtitles and `sub-ass-style-overrides` = [`ass_style_overrides`] for ASS ones.

use std::path::{Path, PathBuf};

/// The family name both files declare (name ID 1), the one libass matches.
pub const FAMILY: &str = "Geist SemiBold";

/// `sub-font` only styles plain text subtitles: an ASS track keeps the fonts of its own styles.
/// This replaces the font of every style (no `Style.` prefix: all of them) and nothing else, so
/// sizes, colours, positions and the `\fn` of typeset signs stay the file's.
pub fn ass_style_overrides() -> String {
    format!("Fontname={FAMILY}")
}

/// `apps/desktop/src-tauri/assets/`, copied from the installed geist by
/// packages/design/scripts/fonts.ts (checked by packages/design/fonts.test.ts).
const FILES: &[(&str, &[u8])] = &[
    (
        "Geist-SemiBold.ttf",
        include_bytes!("../assets/Geist-SemiBold.ttf"),
    ),
    (
        "Geist-SemiBoldItalic.ttf",
        include_bytes!("../assets/Geist-SemiBoldItalic.ttf"),
    ),
];

/// Writes the fonts under `config_dir/fonts` when missing or from another build; answers the
/// directory to give libmpv.
pub fn install(config_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = config_dir.join("fonts");
    std::fs::create_dir_all(&dir)?;
    for (name, bytes) in FILES {
        let path = dir.join(name);
        if std::fs::read(&path).ok().as_deref() != Some(*bytes) {
            std::fs::write(&path, bytes)?;
        }
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overrides_only_the_font_of_every_ass_style() {
        assert_eq!(ass_style_overrides(), "Fontname=Geist SemiBold");
    }

    #[test]
    fn writes_the_fonts_once_and_repairs_them_when_altered() {
        let dir = std::env::temp_dir().join(format!("projo-fonts-{}", std::process::id()));
        let fonts = install(&dir).expect("installs");
        for (name, bytes) in FILES {
            assert_eq!(std::fs::read(fonts.join(name)).expect("reads"), *bytes);
        }
        let (name, bytes) = FILES[0];
        std::fs::write(fonts.join(name), b"old").expect("overwrites");
        install(&dir).expect("repairs");
        assert_eq!(std::fs::read(fonts.join(name)).expect("reads"), bytes);
        std::fs::remove_dir_all(&dir).expect("cleans up");
    }
}
