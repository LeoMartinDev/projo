// macOS: WebKit's own right-click menu ("Reload", "Back"…) would make the app a browser, and a
// reload stops the picture (§28.4). Windows turns it off natively (webview_settings.rs); here the
// page refuses it, but on a text field (spelling and edit items) or on selected text (copy).

type Target = { closest: (selector: string) => unknown }

const editable = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

/** Whether a right click on `target` keeps the system's menu. */
export const keepsContextMenu = (target: Target | undefined, selectedText: string): boolean =>
  (target !== undefined && (target.closest(editable) ?? undefined) !== undefined) ||
  selectedText.trim() !== ''

export const refuseBrowserMenu = (document: Document) => {
  document.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof Element ? event.target : undefined
    if (!keepsContextMenu(target, document.getSelection()?.toString() ?? '')) event.preventDefault()
  })
}
