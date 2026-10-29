import { describe, expect, test } from 'bun:test'

import { subtitleRenditionNames } from './playback.ts'

describe('subtitleRenditionNames (§10.4)', () => {
  test('the title, else the language, unique and without quotes', () => {
    expect(
      subtitleRenditionNames([
        { title: 'Français', language: 'fr' },
        { language: 'fr' },
        { language: 'fr' },
        { title: 'Le "vrai"' },
        {},
        { title: '  ' },
      ]),
    ).toEqual(['Français', 'fr', 'fr (2)', 'Le vrai', 'Subtitles', 'Subtitles (2)'])
  })
})
