import { useEffect } from 'react'

// Distance from the bottom of the player to the top of the timeline row, as
// --player-controls-inset on the player: the captions rise just above it
// while the controls are shown.
export const useControlsInset = (
  player: HTMLElement | undefined,
  bottom: HTMLElement | undefined,
): void => {
  useEffect(() => {
    const bar = bottom?.firstElementChild
    if (player === undefined || bottom === undefined || !(bar instanceof HTMLElement)) return
    const update = () =>
      player.style.setProperty(
        '--player-controls-inset',
        `${bottom.offsetHeight - bar.offsetTop}px`,
      )
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bottom)
    return () => {
      observer.disconnect()
      player.style.removeProperty('--player-controls-inset')
    }
  }, [player, bottom])
}
