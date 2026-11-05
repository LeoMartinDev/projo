import { expect, test } from 'bun:test'

import { parseReleaseNotes, toReleases } from './releases.ts'
import { formatReleaseDate, renderChangelog } from './render.ts'

const english = `## Features

- web: install the app from the account menu on phones and tablets (62d74da)

## Fixes

- web: overview textarea no longer overflows its field in the edit dialog (86df067)

Minimum runtime: 0.2.1.

Changes: https://github.com/LeoMartinDev/projo/compare/v1.11.0...v1.12.0
`

test('reads the sections, items and closing lines the release script writes', () => {
  expect(parseReleaseNotes(english)).toEqual({
    sections: [
      {
        title: 'Features',
        items: [
          {
            scope: 'web',
            text: 'install the app from the account menu on phones and tablets',
            hash: '62d74da',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            scope: 'web',
            text: 'overview textarea no longer overflows its field in the edit dialog',
            hash: '86df067',
          },
        ],
      },
    ],
    notes: ['Minimum runtime: 0.2.1.'],
  })
})

test('puts the notes generated in French back in English', () => {
  const notes = parseReleaseNotes(`## Nouveautés

- web : lecture des sous-titres (abc1234)

## Autres changements

- ci: cache (def5678)

Nouvelle image runtime ghcr.io/leomartindev/projo:0.2.0 : mettre à jour le conteneur (docker compose pull puis docker compose up -d).

Runtime minimal : 0.2.0.

Changements : https://github.com/LeoMartinDev/projo/compare/v1.6.2...v1.6.3`)
  expect(notes.sections.map((section) => section.title)).toEqual(['Features', 'Other changes'])
  expect(notes.sections[0]?.items[0]).toEqual({
    scope: 'web',
    text: 'lecture des sous-titres',
    hash: 'abc1234',
  })
  expect(notes.notes).toEqual([
    'New runtime image ghcr.io/leomartindev/projo:0.2.0: update the container (docker compose pull, then docker compose up -d).',
    'Minimum runtime: 0.2.0.',
  ])
})

test('keeps published releases only, newest first', () => {
  const release = (tag: string, publishedAt: string | undefined, draft = false) => ({
    tag_name: tag,
    published_at: publishedAt ?? JSON.parse('null'),
    draft,
    prerelease: false,
    body: '',
  })
  const releases = toReleases([
    release('v1.0.0', '2026-10-25T10:00:00Z'),
    release('v1.2.0', undefined, true),
    release('v1.1.0', '2026-10-26T10:00:00Z'),
  ])
  expect(releases.map((r) => r.version)).toEqual(['1.1.0', '1.0.0'])
})

test('renders each release with its date in the page language, escaping the notes', () => {
  const [release] = toReleases([
    {
      tag_name: 'v1.12.0',
      published_at: '2026-11-05T17:12:32Z',
      draft: false,
      prerelease: false,
      body: '## Fixes\n\n- web: <script> no longer runs (86df067)',
    },
  ])
  if (release === undefined) throw new Error('no release')
  const labels = { latest: 'Dernière', github: 'Voir sur GitHub', empty: '' }
  const html = renderChangelog([release], { locale: 'fr', labels })
  expect(html).toContain('id="v1.12.0"')
  expect(html).toContain(formatReleaseDate(release.publishedAt, 'fr'))
  expect(formatReleaseDate(release.publishedAt, 'fr')).toBe('5 novembre 2026')
  expect(formatReleaseDate(release.publishedAt, 'en')).toBe('November 5, 2026')
  expect(html).toContain('&lt;script&gt; no longer runs')
  expect(html).not.toContain('<script>')
  expect(html).toContain('Dernière')
})
