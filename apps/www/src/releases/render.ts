import { REPOSITORY, type Release } from './releases.ts'

// The changelog list, rendered to HTML at build time (the page templates only fill strings).
// Release notes are third-party text from GitHub: everything is escaped.

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export const releaseAnchor = (version: string) => `v${version}`

export type ChangelogLabels = { latest: string; github: string; empty: string }

export const formatReleaseDate = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date)

export const renderChangelog = (
  releases: readonly Release[],
  { locale, labels }: { locale: string; labels: ChangelogLabels },
): string => {
  if (releases.length === 0)
    return `<p class="changelog__empty"><a href="https://github.com/${REPOSITORY}/releases">${labels.empty}</a></p>`
  return releases
    .map((release, index) => {
      const id = releaseAnchor(release.version)
      const sections = release.sections
        .filter((section) => section.items.length > 0)
        .map(
          (section) => `<section class="changelog__section">
<h3>${escapeHtml(section.title)}</h3>
<ul>${section.items
            .map(
              (item) =>
                `<li>${item.scope === undefined ? '' : `<span class="changelog__scope">${escapeHtml(item.scope)}</span>`}<span>${escapeHtml(item.text)}</span>${
                  item.hash === undefined
                    ? ''
                    : ` <a class="changelog__hash" href="https://github.com/${REPOSITORY}/commit/${escapeHtml(item.hash)}">${escapeHtml(item.hash.slice(0, 7))}</a>`
                }</li>`,
            )
            .join('')}</ul>
</section>`,
        )
        .join('')
      const notes = release.notes
        .map((note) => `<p class="changelog__note">${escapeHtml(note)}</p>`)
        .join('')
      return `<article class="changelog__release" id="${id}" lang="en">
<header class="changelog__head">
<h2><a href="#${id}">${escapeHtml(release.version)}</a></h2>
<p class="changelog__meta"><time datetime="${release.publishedAt.toISOString()}" lang="${locale}">${formatReleaseDate(release.publishedAt, locale)}</time>${
        index === 0 ? ` <span class="tag" lang="${locale}">${labels.latest}</span>` : ''
      }</p>
<a class="changelog__github" lang="${locale}" href="https://github.com/${REPOSITORY}/releases/tag/${id}">${labels.github}</a>
</header>
<div class="changelog__body">${sections}${notes}</div>
</article>`
    })
    .join('\n')
}
