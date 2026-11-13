// The bundled first-launch page: asks for the projo server, which the app checks (`/health`),
// stores and opens (command `connect_server`). With a stored server it connects at once, and stays
// here with the error when the server does not answer. `?change=1` (Ctrl+Shift+U) shows the form
// with the stored address instead.
import { errorMessage, messagesFor, pickLocale } from './messages.ts'

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
declare global {
  interface Window {
    __TAURI__: { core: { invoke: Invoke } }
  }
}

const invoke: Invoke = (command, args) => window.__TAURI__.core.invoke(command, args)
const locale = pickLocale(navigator.languages)
const messages = messagesFor(locale)

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`#${id} missing`)
  return found
}
const form = element('form', HTMLFormElement)
const input = element('url', HTMLInputElement)
const message = element('message', HTMLParagraphElement)
const submit = element('submit', HTMLButtonElement)

document.documentElement.lang = locale
element('url-label', HTMLLabelElement).textContent = messages.label
submit.textContent = messages.connect

const setBusy = (busy: boolean) => {
  input.disabled = busy
  submit.disabled = busy
}

const showMessage = (text: string, kind: 'info' | 'error') => {
  message.textContent = text
  message.dataset['kind'] = kind
}

// On success the window navigates to the server: nothing more to do here.
const connect = (url: string) => {
  input.value = url
  setBusy(true)
  showMessage(messages.connecting(url), 'info')
  invoke('connect_server', { url }).catch((failure: unknown) => {
    setBusy(false)
    showMessage(errorMessage(messages, failure), 'error')
    input.focus()
  })
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  connect(input.value.trim())
})

const changing = new URLSearchParams(location.search).has('change')
invoke<{ serverUrl?: string }>('get_setup').then(
  ({ serverUrl }) => {
    if (serverUrl !== undefined && !changing) return connect(serverUrl)
    input.value = serverUrl ?? ''
    input.focus()
  },
  (failure: unknown) => showMessage(errorMessage(messages, failure), 'error'),
)
