import './styles/site.css'

import { preferredLocale } from './i18n/preferred.ts'
import { wallImages } from './images.ts'
import { renderWall, wallColumns } from './poster-wall.ts'

// Language: the switch remembers the visitor's pick; a visitor landing on the other language
// (a French browser on the English root, an old link…) is sent to the same page in theirs.
const languageKey = 'projo-www-language'
const readChoice = () => {
  try {
    return localStorage.getItem(languageKey) ?? undefined
  } catch {
    return undefined
  }
}
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-lang]'))
  link.addEventListener('click', () => {
    try {
      localStorage.setItem(languageKey, link.dataset['lang'] ?? '')
    } catch {
      // Storage unavailable (private mode): the pick lasts for this page only.
    }
  })
const preferred = preferredLocale({ chosen: readChoice(), languages: navigator.languages })
const counterpart = document.querySelector<HTMLAnchorElement>(`a[data-lang="${preferred}"]`)
if (preferred !== document.documentElement.lang && counterpart)
  location.replace(counterpart.href + location.hash)

// Homepage: the drifting wall of artwork behind the title (decorative, aria-hidden), started once
// the page itself has loaded so its tiles never hold back the title and the preview.
const wall = document.querySelector<HTMLElement>('[data-wall]')
const startWall = () => {
  if (wall) renderWall(wall, wallColumns({ images: wallImages, columns: 7, rows: 5 }))
}
if (document.readyState === 'complete') startWall()
else addEventListener('load', startWall, { once: true })

// Phone navigation: a native modal dialog (Escape and the backdrop close it).
const menu = document.querySelector<HTMLDialogElement>('[data-menu]')
if (menu) {
  for (const button of document.querySelectorAll('[data-menu-open]'))
    button.addEventListener('click', () => menu.showModal())
  for (const element of menu.querySelectorAll('[data-menu-close], a'))
    element.addEventListener('click', () => menu.close())
  menu.addEventListener('click', (event) => {
    if (event.target === menu) menu.close()
  })
}

// Installation: Linux / Synology variants of docker-compose.yml, picked with the app's
// segmented control (.seg: its indicator follows data-active, like in the admin).
for (const choice of document.querySelectorAll<HTMLElement>('[data-choice]')) {
  const buttons = [...choice.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const select = (selected: HTMLButtonElement) => {
    choice.dataset['active'] = String(buttons.indexOf(selected))
    for (const button of buttons) {
      const active = button === selected
      button.setAttribute('aria-checked', String(active))
      button.tabIndex = active ? 0 : -1
      const panel = document.getElementById(button.getAttribute('aria-controls') ?? '')
      if (panel) panel.hidden = !active
    }
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(button))
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (step === 0) return
      const next = buttons[(index + step + buttons.length) % buttons.length]
      if (next) {
        select(next)
        next.focus()
      }
    })
  })
}
