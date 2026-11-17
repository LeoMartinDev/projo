import { type DesktopDownloads } from './desktop.ts'

// The download page's platforms, rendered at build time (the page templates only fill strings).

export type DownloadLabels = {
  button: string
  unavailable: string
  windows: { requirement: string }
  macos: { requirement: string; firstLaunch: string }
  version: string
  notes: string
  empty: string
}

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const platform = ({
  name,
  requirement,
  url,
  note,
  labels,
}: {
  name: string
  requirement: string
  url: string | undefined
  note?: string
  labels: DownloadLabels
}) => `<section class="download panel">
<h2>${name}</h2>
<p class="download__requirement">${requirement}</p>
${
  url === undefined
    ? `<span class="button" aria-disabled="true">${labels.unavailable}</span>`
    : `<a class="button button--primary" href="${escapeHtml(url)}">${labels.button}</a>`
}${note === undefined || url === undefined ? '' : `\n<p class="download__note">${note}</p>`}
</section>`

export const renderDownloads = (
  desktop: DesktopDownloads | undefined,
  labels: DownloadLabels,
): string => {
  if (desktop === undefined)
    return `<p class="downloads__empty"><a href="https://github.com/LeoMartinDev/projo/releases">${labels.empty}</a></p>`
  return `<div class="downloads__platforms">
${platform({ name: 'Windows', requirement: labels.windows.requirement, url: desktop.windows, labels })}
${platform({
  name: 'macOS',
  requirement: labels.macos.requirement,
  url: desktop.macos,
  note: labels.macos.firstLaunch,
  labels,
})}
</div>
<p class="downloads__meta">${labels.version} ${escapeHtml(desktop.version)} · <a href="${escapeHtml(desktop.notes)}">${labels.notes}</a></p>`
}
