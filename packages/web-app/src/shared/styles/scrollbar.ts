/**
 * `--scrollbar-width` (the page's scrollbar, kept when a modal locks the page) and
 * `data-scrollbars` on the root: `classic` where scrollbars take room (Windows, Linux, a Mac set
 * to always show them), which base.css draws in the app's style; `overlay` scrollbars (macOS,
 * iOS) are left to the system. Measured again whenever the root's box changes: the window's
 * width, and the scrollbar once base.css has restyled it.
 */
export const trackScrollbarWidth = (): void => {
  const root = document.documentElement
  const measure = () => {
    if (window.getComputedStyle(root).overflowY !== 'scroll') return
    const width = window.innerWidth - root.clientWidth
    root.style.setProperty('--scrollbar-width', `${width}px`)
    root.dataset['scrollbars'] = width > 0 ? 'classic' : 'overlay'
  }
  measure()
  new ResizeObserver(measure).observe(root)
}
