// The splash of index.html (§28.4): painted before any script, under a window the app creates
// hidden; the page shows the window once the splash is painted, and fades the splash out once its
// first real screen is drawn (an Entry screen, or the app's first route).

/** The splash element, as far as the page touches it. */
export type SplashElement = {
  classList: { add: (name: string) => void }
  remove: () => void
}

type Deps = {
  element: SplashElement | undefined
  /** `desktop_window_ready`: shows the window (the app shows it alone after 3 s otherwise). */
  showWindow: () => Promise<unknown>
  /** Runs `run` once the page has painted. */
  afterPaint: (run: () => void) => void
  later: (run: () => void, ms: number) => void
  warn: (message: string, cause: unknown) => void
}

/** Kept a little longer than the fade of `.splash--leaving` (public/boot.css). */
export const splashFadeMs = 200

export const splashFactory = ({ element, showWindow, afterPaint, later, warn }: Deps) => {
  let windowAsked = false
  let dismissed = false
  return {
    /** Asks the app to show the window, once, after the splash is painted. */
    showWindow: () => {
      if (windowAsked) return
      windowAsked = true
      afterPaint(() => {
        void showWindow().catch((cause: unknown) =>
          warn('the window could not be shown by the page (an older app?)', cause),
        )
      })
    },
    /** Fades the splash out and removes it; once. */
    dismiss: () => {
      if (dismissed) return
      dismissed = true
      element?.classList.add('splash--leaving')
      later(() => element?.remove(), splashFadeMs)
    },
  }
}

export type Splash = ReturnType<typeof splashFactory>

// A hidden window may not run animation frames: past this, the page counts as painted.
const paintFallbackMs = 100

/** After the next frame is painted (a task after its animation frame), or the fallback. */
export const afterNextPaint = (run: () => void): void => {
  let ran = false
  const once = () => {
    if (ran) return
    ran = true
    run()
  }
  requestAnimationFrame(() => setTimeout(once, 0))
  setTimeout(once, paintFallbackMs)
}
