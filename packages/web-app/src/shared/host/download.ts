/**
 * Saving a file from the page, for the hosts' `download` (`AppHost.download`): the browser clicks
 * a link to the server's URL (its cookie goes along), the desktop fetches with the bearer and
 * saves the blob. The file name is the server's `Content-Disposition` either way.
 */

/** Clicks a hidden `<a download>` to `href`. */
export const clickDownload = (href: string, filename: string): void => {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
}

/** Saves `blob` as `filename`; its object URL lives a minute, long enough for the save to start. */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  clickDownload(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
