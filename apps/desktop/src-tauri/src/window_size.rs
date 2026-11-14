//! Size of the main window (PRODUCT.md §28.4): it opens at, and never shrinks below, the size the
//! web app is drawn for, unless the screen's work area is smaller.

/// Logical pixels: the web app's layouts look right from here up.
pub const MINIMUM: (f64, f64) = (1280.0, 720.0);

/// The minimum (and opening) size, fitted into the work area (logical pixels) when one is known.
pub fn fitted_minimum(work_area: Option<(f64, f64)>) -> (f64, f64) {
    match work_area {
        Some((width, height)) => (MINIMUM.0.min(width), MINIMUM.1.min(height)),
        None => MINIMUM,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
