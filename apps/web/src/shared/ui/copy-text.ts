/** Selects the field and runs the `copy` command: works over plain HTTP on a LAN. */
const copyBySelection = (input: HTMLInputElement | undefined): boolean => {
  if (input === undefined) return false
  input.select()
  return document.execCommand('copy')
}

/** Clipboard API where available (HTTPS, localhost), the selection otherwise or when refused. */
export const copyText = async (
  text: string,
  input: HTMLInputElement | undefined,
): Promise<boolean> => {
  if (!window.isSecureContext || navigator.clipboard === undefined) return copyBySelection(input)
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => copyBySelection(input),
  )
}
