export const trackScrollbarWidth = (): void => {
  const root = document.documentElement
  const measure = () => {
    if (window.getComputedStyle(root).overflowY !== 'scroll') return
    root.style.setProperty('--scrollbar-width', `${window.innerWidth - root.clientWidth}px`)
  }
  measure()
  window.addEventListener('resize', measure, { passive: true })
}
