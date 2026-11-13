//! What the server page may ask of mpv. The page is the user's own server, but an XSS there must not
//! become code execution or file writes on the desktop: commands that run programs or scripts or
//! write files are refused, and so are the options/properties that load scripts or configuration,
//! open IPC servers or pick output files. Everything else (loadfile, seek, set, sub-add…) passes.

/// Options the app always sets, before the page's own (which cannot override `FORCED_OPTIONS`).
pub const DEFAULT_OPTIONS: &[(&str, &str)] = &[
    ("vo", "gpu-next"),
    ("hwdec", "auto-safe"),
    ("keep-open", "yes"),
    ("force-window", "yes"),
    ("target-colorspace-hint", "yes"),
    ("osc", "no"),
    ("input-default-bindings", "no"),
    ("input-vo-keyboard", "no"),
];

/// Set last, after the page's options: no user config, no scripts (ytdl_hook would spawn yt-dlp).
pub const FORCED_OPTIONS: &[(&str, &str)] =
    &[("config", "no"), ("load-scripts", "no"), ("ytdl", "no")];

const DENIED_COMMANDS: &[&str] = &[
    "run",
    "subprocess",
    "load-script",
    "load-config-file",
    "load-input-conf",
    "script-message",
    "script-message-to",
    "script-binding",
    "keybind",
    "screenshot",
    "screenshot-to-file",
    "dump-cache",
    "write-watch-later-config",
];

const DENIED_OPTIONS: &[&str] = &[
    "wid",
    "config",
    "config-dir",
    "include",
    "load-scripts",
    "script",
    "scripts",
    "scripts-append",
    "scripts-add",
    "scripts-set",
    "script-opts",
    "ytdl",
    "ytdl-path",
    "script-opts-append",
    "input-conf",
    "input-ipc-server",
    "input-ipc-client",
    "log-file",
    "dump-stats",
    "stream-record",
    "record-file",
    "screenshot-directory",
    "screenshot-dir",
    "watch-later-dir",
    "watch-later-directory",
    "save-position-on-quit",
    "use-filedir-conf",
];

fn base_name(name: &str) -> &str {
    // `--foo`, `file-local-options/foo` and `options/foo` all reach the option `foo`.
    let name = name.trim().trim_start_matches("--");
    name.rsplit('/').next().unwrap_or(name)
}

pub fn check_option(name: &str) -> Result<(), String> {
    let base = base_name(name).to_ascii_lowercase();
    if DENIED_OPTIONS.contains(&base.as_str()) {
        return Err(format!("option or property '{name}' is not allowed"));
    }
    Ok(())
}

pub fn check_command(args: &[String]) -> Result<(), String> {
    let Some(name) = args.first() else {
        return Err("empty command".into());
    };
    // Command prefixes (`no-osd seek …`, `async run …`) come before the name.
    let mut words = args.iter().map(|arg| arg.trim().to_ascii_lowercase());
    let name = words
        .by_ref()
        .find(|word| !COMMAND_PREFIXES.contains(&word.as_str()))
        .unwrap_or_else(|| name.to_ascii_lowercase());
    if DENIED_COMMANDS.contains(&name.as_str()) {
        return Err(format!("command '{name}' is not allowed"));
    }
    let position = args
        .iter()
        .position(|arg| arg.trim().eq_ignore_ascii_case(&name))
        .unwrap_or(0);
    let rest = &args[position + 1..];
    match name.as_str() {
        // set/add/cycle/multiply/cycle-values <property> …
        "set" | "add" | "cycle" | "multiply" | "cycle-values" | "change-list" => rest
            .first()
            .map_or(Ok(()), |property| check_option(property)),
        // loadfile <url> [<flags> [<index> [<options>]]] (older mpv: options third)
        "loadfile" | "loadlist" => rest
            .iter()
            .skip(1)
            .try_for_each(|arg| check_option_list(arg)),
        _ => Ok(()),
    }
}

const COMMAND_PREFIXES: &[&str] = &[
    "osd-auto",
    "no-osd",
    "osd-bar",
    "osd-msg",
    "osd-msg-bar",
    "raw",
    "expand-properties",
    "repeatable",
    "nonrepeatable",
    "async",
    "sync",
];

/// `a=b,c=d` (loadfile per-file options).
fn check_option_list(list: &str) -> Result<(), String> {
    list.split(',')
        .filter_map(|entry| entry.split('=').next())
        .filter(|name| !name.trim().is_empty())
        .try_for_each(check_option)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| word.to_string()).collect()
    }

    #[test]
    fn allows_playback_commands() {
        for command in [
            args(&[
                "loadfile",
                "https://projo.example/stream/a/b/file.mkv",
                "replace",
            ]),
            args(&[
                "loadfile",
                "Z:/Films/a.mkv",
                "replace",
                "-1",
                "start=120,pause=yes",
            ]),
            args(&["seek", "90", "absolute"]),
            args(&["no-osd", "seek", "-10", "relative"]),
            args(&["set", "aid", "2"]),
            args(&["cycle", "pause"]),
            args(&["sub-add", "https://projo.example/sub.vtt", "select"]),
            args(&["stop"]),
        ] {
            assert_eq!(check_command(&command), Ok(()), "{command:?}");
        }
    }

    #[test]
    fn refuses_commands_that_run_code_or_write_files() {
        for command in [
            args(&["run", "calc.exe"]),
            args(&["subprocess", "cmd"]),
            args(&["async", "run", "calc.exe"]),
            args(&["RUN", "calc.exe"]),
            args(&["load-script", "\\\\host\\share\\x.lua"]),
            args(&["screenshot-to-file", "C:/x.png"]),
            args(&["dump-cache", "0", "100", "C:/x.mkv"]),
            args(&["set", "input-ipc-server", "\\\\.\\pipe\\x"]),
            args(&["set", "options/script", "x.lua"]),
            args(&[
                "loadfile",
                "a.mkv",
                "replace",
                "-1",
                "start=1,stream-record=C:/x.mkv",
            ]),
            args(&[]),
        ] {
            assert!(check_command(&command).is_err(), "{command:?}");
        }
    }

    #[test]
    fn refuses_dangerous_options_and_properties() {
        for name in [
            "wid",
            "script",
            "--script",
            "file-local-options/record-file",
            "Log-File",
            "config-dir",
            "ytdl",
        ] {
            assert!(check_option(name).is_err(), "{name}");
        }
        for name in [
            "pause",
            "aid",
            "sid",
            "volume",
            "mute",
            "hwdec",
            "video-margin-ratio-left",
            "start",
        ] {
            assert_eq!(check_option(name), Ok(()), "{name}");
        }
    }
}
