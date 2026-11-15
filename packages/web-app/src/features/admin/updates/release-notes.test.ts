import { expect, test } from 'bun:test'

import { parseInline, parseReleaseNotes } from './release-notes.ts'

test('headings, lists and paragraphs of the generated notes', () => {
  const notes = [
    '## Corrections',
    '',
    '- web : Escape closes one dialog (review #21) (11756bb)',
    '- server : cap bodies (712fdec)',
    '',
    'Runtime minimal : 0.2.0.',
    '',
    'Changements : https://github.com/LeoMartinDev/projo/compare/v1.6.0...v1.6.1',
    '',
  ].join('\n')
  expect(parseReleaseNotes(notes)).toEqual([
    { kind: 'heading', text: 'Corrections' },
    {
      kind: 'list',
      items: [
        'web : Escape closes one dialog (review #21) (11756bb)',
        'server : cap bodies (712fdec)',
      ],
    },
    { kind: 'paragraph', text: 'Runtime minimal : 0.2.0.' },
    {
      kind: 'paragraph',
      text: 'Changements : https://github.com/LeoMartinDev/projo/compare/v1.6.0...v1.6.1',
    },
  ])
})

test('code spans and https links inside a line', () => {
  expect(parseInline('use `canAdminister` see https://github.com/x (done)')).toEqual([
    { kind: 'text', text: 'use ' },
    { kind: 'code', text: 'canAdminister' },
    { kind: 'text', text: ' see ' },
    { kind: 'link', href: 'https://github.com/x' },
    { kind: 'text', text: ' (done)' },
  ])
  expect(parseInline('javascript:alert(1) http://x')).toEqual([
    { kind: 'text', text: 'javascript:alert(1) http://x' },
  ])
})
