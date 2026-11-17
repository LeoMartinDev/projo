//! The name the app gives its sessions (PRODUCT.md §28.3, `deviceName` of sign-in and of the
//! pairing claim), shown in the account's devices. Like the mobile app's (its model name, else
//! "iPhone"): the computer's name as its owner set it, else the system's name.

/// When the computer has no readable name.
#[cfg(not(target_os = "macos"))]
pub const FALLBACK: &str = "Windows";
#[cfg(target_os = "macos")]
pub const FALLBACK: &str = "Mac";
/// The server takes up to 64 characters (`deviceNameSchema`).
const MAX_CHARS: usize = 64;

/// The device name for a raw computer name: trimmed, at most 64 characters, else `FALLBACK`.
pub fn device_name_of(raw: Option<&str>) -> String {
    let trimmed = raw.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return FALLBACK.to_string();
    }
    trimmed.chars().take(MAX_CHARS).collect()
}

pub fn device_name() -> String {
    device_name_of(computer_name().as_deref())
}

/// The DNS host name with the case its owner gave it ("Leo-PC"), else the NetBIOS name
/// (`COMPUTERNAME`, upper case).
#[cfg(windows)]
fn computer_name() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::SystemInformation::{
        ComputerNamePhysicalDnsHostname, GetComputerNameExW,
    };

    let read = || -> Option<String> {
        let mut size: u32 = 0;
        // Asked with no buffer, it fails and gives the size it needs (terminating NUL included).
        // SAFETY: a null buffer with a size of 0 is the documented way to ask for the size.
        let _ = unsafe { GetComputerNameExW(ComputerNamePhysicalDnsHostname, None, &mut size) };
        if size == 0 {
            return None;
        }
        let mut buffer = vec![0u16; size as usize];
        // SAFETY: `buffer` holds `size` UTF-16 units; on success `size` is the length written,
        // without the NUL.
        unsafe {
            GetComputerNameExW(
                ComputerNamePhysicalDnsHostname,
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut size,
            )
        }
        .ok()?;
        let written = buffer.get(..size as usize)?;
        String::from_utf16(written).ok()
    };
    read().or_else(|| std::env::var("COMPUTERNAME").ok())
}

/// The name set in System Settings → General → Sharing ("MacBook Pro de Léo").
#[cfg(target_os = "macos")]
fn computer_name() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn computer_name() -> Option<String> {
    std::env::var("HOSTNAME").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_computer_name() {
        assert_eq!(device_name_of(Some("Leo-PC")), "Leo-PC");
        assert_eq!(device_name_of(Some("  DESKTOP-4F2K9 \n")), "DESKTOP-4F2K9");
    }

    #[test]
    fn falls_back_without_a_name() {
        assert_eq!(device_name_of(None), FALLBACK);
        assert_eq!(device_name_of(Some("")), FALLBACK);
        assert_eq!(device_name_of(Some("   ")), FALLBACK);
    }

    #[test]
    fn cuts_a_long_name_on_a_character() {
        let long = "é".repeat(80);
        let name = device_name_of(Some(&long));
        assert_eq!(name.chars().count(), 64);
        assert!(name.chars().all(|c| c == 'é'));
    }

    #[test]
    fn reads_this_computer() {
        assert!(!device_name().is_empty());
    }
}
