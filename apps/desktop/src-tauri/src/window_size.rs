//! Size and place of the main window (PRODUCT.md §28.4): it never shrinks below the size the web app
//! is drawn for, unless the screen's work area is smaller; it opens where it was when the app last
//! closed, else at that minimum, centered on the primary monitor.

use crate::config::WindowBounds;

/// Logical pixels: the web app's layouts look right from here up.
pub const MINIMUM: (f64, f64) = (1280.0, 720.0);

/// At least this share of the saved window must lie on one connected monitor for it to open there.
const VISIBLE_SHARE: f64 = 0.5;

/// The minimum (and opening) size, fitted into the work area (logical pixels) when one is known.
pub fn fitted_minimum(work_area: Option<(f64, f64)>) -> (f64, f64) {
    match work_area {
        Some((width, height)) => (MINIMUM.0.min(width), MINIMUM.1.min(height)),
        None => MINIMUM,
    }
}

/// A rectangle in physical pixels, in the virtual screen's coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn area(&self) -> f64 {
        self.width.max(0.0) * self.height.max(0.0)
    }

    fn overlap(&self, other: &Rect) -> f64 {
        let width = (self.x + self.width).min(other.x + other.width) - self.x.max(other.x);
        let height = (self.y + self.height).min(other.y + other.height) - self.y.max(other.y);
        width.max(0.0) * height.max(0.0)
    }
}

/// A connected monitor: its whole area and its work area (the taskbar left out), physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Monitor {
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale: f64,
}

impl Monitor {
    fn logical_work_area(&self) -> (f64, f64) {
        (
            self.work_area.width / self.scale,
            self.work_area.height / self.scale,
        )
    }
}

/// Where the window opens: `position` (outer, physical pixels; none: the system's choice), `size`
/// (inner, logical pixels; the size it restores to when `maximized`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub position: Option<(i32, i32)>,
    pub size: (f64, f64),
    pub maximized: bool,
}

/// The minimum size: fitted into the primary monitor's work area.
pub fn minimum_for(primary: Option<&Monitor>) -> (f64, f64) {
    fitted_minimum(primary.map(Monitor::logical_work_area))
}

/// The saved bounds when at least half of the window lies on one connected monitor (never below
/// the minimum, its top edge kept inside that monitor's work area so that the drag strip stays
/// reachable), otherwise the minimum centered on the primary monitor's work area.
pub fn placement(
    saved: Option<&WindowBounds>,
    monitors: &[Monitor],
    primary: Option<&Monitor>,
) -> Placement {
    let minimum = minimum_for(primary);
    if let Some(saved) = saved.filter(|saved| is_usable(saved)) {
        let size = (saved.width.max(minimum.0), saved.height.max(minimum.1));
        let shown_on = monitors
            .iter()
            .map(|monitor| (monitor, visible_share(saved, size, monitor)))
            .filter(|(_, share)| *share >= VISIBLE_SHARE)
            .max_by(|(_, a), (_, b)| a.total_cmp(b));
        if let Some((monitor, _)) = shown_on {
            let top = saved.y.max(monitor.work_area.y.ceil() as i32);
            return Placement {
                position: Some((saved.x, top)),
                size,
                maximized: saved.maximized,
            };
        }
    }
    Placement {
        position: primary.map(|monitor| centered(minimum, monitor)),
        size: minimum,
        maximized: false,
    }
}

fn is_usable(saved: &WindowBounds) -> bool {
    saved.width.is_finite() && saved.height.is_finite() && saved.width > 0.0 && saved.height > 0.0
}

/// The share of the window (at `size`, drawn at `monitor`'s scale) that lies on `monitor`.
fn visible_share(saved: &WindowBounds, size: (f64, f64), monitor: &Monitor) -> f64 {
    let window = Rect {
        x: f64::from(saved.x),
        y: f64::from(saved.y),
        width: size.0 * monitor.scale,
        height: size.1 * monitor.scale,
    };
    let area = window.area();
    if area <= 0.0 {
        return 0.0;
    }
    window.overlap(&monitor.bounds) / area
}

fn centered(size: (f64, f64), monitor: &Monitor) -> (i32, i32) {
    let area = &monitor.work_area;
    let x = area.x + (area.width - size.0 * monitor.scale) / 2.0;
    let y = area.y + (area.height - size.1 * monitor.scale) / 2.0;
    (x.round() as i32, y.max(area.y).round() as i32)
}

/// The window as it is now: outer position (physical), inner size (logical).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Observation {
    pub position: (i32, i32),
    pub size: (f64, f64),
    pub maximized: bool,
    pub minimized: bool,
    pub fullscreen: bool,
}

/// The bounds to remember after seeing the window as `seen`: full screen and minimized change
/// nothing (the window comes back from them as it was); maximized keeps the bounds it restores
/// to; otherwise its current bounds.
pub fn observe(remembered: Option<WindowBounds>, seen: Observation) -> Option<WindowBounds> {
    if seen.fullscreen || seen.minimized {
        return remembered;
    }
    if seen.maximized {
        let restored = remembered.unwrap_or(WindowBounds {
            x: seen.position.0,
            y: seen.position.1,
            width: seen.size.0,
            height: seen.size.1,
            maximized: true,
        });
        return Some(WindowBounds {
            maximized: true,
            ..restored
        });
    }
    Some(WindowBounds {
        x: seen.position.0,
        y: seen.position.1,
        width: seen.size.0,
        height: seen.size.1,
        maximized: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: f64, y: f64, width: f64, height: f64, scale: f64) -> Monitor {
        // A 48 px taskbar at the bottom (physical pixels).
        Monitor {
            bounds: Rect {
                x,
                y,
                width,
                height,
            },
            work_area: Rect {
                x,
                y,
                width,
                height: height - 48.0,
            },
            scale,
        }
    }

    fn bounds(x: i32, y: i32, width: f64, height: f64, maximized: bool) -> WindowBounds {
        WindowBounds {
            x,
            y,
            width,
            height,
            maximized,
        }
    }

    #[test]
    fn keeps_the_minimum_on_a_large_screen() {
        assert_eq!(fitted_minimum(Some((2560.0, 1400.0))), MINIMUM);
    }

    #[test]
    fn fits_a_smaller_work_area() {
        // 1920 × 1080 at 150 %, taskbar excluded.
        assert_eq!(fitted_minimum(Some((1280.0, 688.0))), (1280.0, 688.0));
        assert_eq!(fitted_minimum(Some((1024.0, 740.0))), (1024.0, 720.0));
    }

    #[test]
    fn keeps_the_minimum_without_a_monitor() {
        assert_eq!(fitted_minimum(None), MINIMUM);
    }

    #[test]
    fn first_launch_centers_the_minimum_on_the_primary_monitor() {
        let primary = monitor(0.0, 0.0, 2560.0, 1440.0, 1.0);
        assert_eq!(
            placement(None, &[primary], Some(&primary)),
            Placement {
                position: Some((640, 336)),
                size: MINIMUM,
                maximized: false,
            }
        );
        // 1920 × 1080 at 150 %: the minimum fills the work area's height.
        let small = monitor(0.0, 0.0, 1920.0, 1080.0, 1.5);
        assert_eq!(
            placement(None, &[small], Some(&small)),
            Placement {
                position: Some((0, 0)),
                size: (1280.0, 688.0),
                maximized: false,
            }
        );
        assert_eq!(
            placement(None, &[], None),
            Placement {
                position: None,
                size: MINIMUM,
                maximized: false,
            }
        );
    }

    #[test]
    fn restores_the_saved_bounds() {
        let primary = monitor(0.0, 0.0, 2560.0, 1440.0, 1.0);
        let saved = bounds(200, 100, 1600.0, 1000.0, false);
        assert_eq!(
            placement(Some(&saved), &[primary], Some(&primary)),
            Placement {
                position: Some((200, 100)),
                size: (1600.0, 1000.0),
                maximized: false,
            }
        );
        let maximized = bounds(200, 100, 1600.0, 1000.0, true);
        assert!(placement(Some(&maximized), &[primary], Some(&primary)).maximized);
    }

    #[test]
    fn restores_on_a_second_monitor_at_its_own_scale() {
        let primary = monitor(0.0, 0.0, 1920.0, 1080.0, 1.0);
        // Left of the primary, 4K at 150 %.
        let left = monitor(-3840.0, -400.0, 3840.0, 2160.0, 1.5);
        let saved = bounds(-3600, -300, 1440.0, 900.0, false);
        assert_eq!(
            placement(Some(&saved), &[primary, left], Some(&primary)).position,
            Some((-3600, -300))
        );
    }

    #[test]
    fn never_restores_below_the_minimum() {
        let primary = monitor(0.0, 0.0, 2560.0, 1440.0, 1.0);
        let saved = bounds(100, 100, 800.0, 500.0, false);
        assert_eq!(
            placement(Some(&saved), &[primary], Some(&primary)).size,
            MINIMUM
        );
    }

    #[test]
    fn keeps_the_drag_strip_on_screen() {
        let primary = monitor(0.0, 0.0, 2560.0, 1440.0, 1.0);
        let saved = bounds(100, -200, 1280.0, 720.0, false);
        assert_eq!(
            placement(Some(&saved), &[primary], Some(&primary)).position,
            Some((100, 0))
        );
    }

    #[test]
    fn a_window_mostly_off_screen_opens_centered() {
        let primary = monitor(0.0, 0.0, 2560.0, 1440.0, 1.0);
        // On a monitor that is gone.
        let gone = bounds(-2000, 100, 1280.0, 720.0, true);
        // Two thirds past the right edge.
        let off = bounds(2560 - 426, 100, 1280.0, 720.0, false);
        for saved in [gone, off] {
            assert_eq!(
                placement(Some(&saved), &[primary], Some(&primary)),
                Placement {
                    position: Some((640, 336)),
                    size: MINIMUM,
                    maximized: false,
                }
            );
        }
        // Half on screen is enough.
        let half = bounds(2560 - 640, 100, 1280.0, 720.0, false);
        assert_eq!(
            placement(Some(&half), &[primary], Some(&primary)).position,
            Some((1920, 100))
        );
    }

    #[test]
    fn ignores_nonsense_bounds() {
        let primary = monitor(0.0, 0.0, 2560.0, 1440.0, 1.0);
        for (width, height) in [(f64::NAN, 720.0), (1280.0, f64::INFINITY), (0.0, 720.0)] {
            let saved = bounds(10, 10, width, height, false);
            assert_eq!(
                placement(Some(&saved), &[primary], Some(&primary)).position,
                Some((640, 336))
            );
        }
    }

    fn seen(x: i32, y: i32, width: f64, height: f64) -> Observation {
        Observation {
            position: (x, y),
            size: (width, height),
            maximized: false,
            minimized: false,
            fullscreen: false,
        }
    }

    #[test]
    fn remembers_the_normal_bounds() {
        assert_eq!(
            observe(None, seen(10, 20, 1300.0, 800.0)),
            Some(bounds(10, 20, 1300.0, 800.0, false))
        );
    }

    #[test]
    fn a_maximized_window_keeps_the_bounds_it_restores_to() {
        let normal = Some(bounds(10, 20, 1300.0, 800.0, false));
        let maximized = Observation {
            maximized: true,
            ..seen(-8, -8, 2560.0, 1392.0)
        };
        let remembered = observe(normal, maximized);
        assert_eq!(remembered, Some(bounds(10, 20, 1300.0, 800.0, true)));
        // Restored again.
        assert_eq!(
            observe(remembered, seen(10, 20, 1300.0, 800.0)),
            Some(bounds(10, 20, 1300.0, 800.0, false))
        );
        // Maximized with nothing known before: what it is now.
        assert_eq!(
            observe(None, maximized),
            Some(bounds(-8, -8, 2560.0, 1392.0, true))
        );
    }

    #[test]
    fn full_screen_and_minimized_change_nothing() {
        let normal = Some(bounds(10, 20, 1300.0, 800.0, true));
        let fullscreen = Observation {
            fullscreen: true,
            ..seen(0, 0, 2560.0, 1440.0)
        };
        let minimized = Observation {
            minimized: true,
            ..seen(-32000, -32000, 160.0, 28.0)
        };
        assert_eq!(observe(normal, fullscreen), normal);
        assert_eq!(observe(normal, minimized), normal);
        assert_eq!(observe(None, fullscreen), None);
    }
}
