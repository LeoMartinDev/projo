/**
 * Keeps `--scrollbar-width` on the root: the room of the page's scrollbar (always shown,
 * base.css), which a modal dialog turns into padding so nothing shifts behind it. 0 with overlay
 * scrollbars. Measured again on resize (zoom changes it), but not while the bar is hidden (a
 * modal, the player).
 */
export const trackScrollbarWidth = (): void => {
  const root = document.documentElement
  const measure = () => {
    if (window.getComputedStyle(root).overflowY !== 'scroll') return
    root.style.setProperty('--scrollbar-width', `${window.innerWidth - root.clientWidth}px`)
  }
  measure()
  window.addEventListener('resize', measure, { passive: true })
}
