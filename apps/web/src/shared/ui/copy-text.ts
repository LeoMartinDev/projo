const copyBySelection = (input: HTMLInputElement | HTMLTextAreaElement | undefined): boolean => {
  if (input === undefined) return false
  input.select()
  return document.execCommand('copy')
}

export const copyText = async (
  text: string,
  input: HTMLInputElement | HTMLTextAreaElement | undefined,
): Promise<boolean> => {
  if (!window.isSecureContext || navigator.clipboard === undefined) return copyBySelection(input)
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => copyBySelection(input),
  )
}
