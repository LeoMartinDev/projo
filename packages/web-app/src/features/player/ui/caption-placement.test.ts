import { describe, expect, test } from 'bun:test'

import { pictureBottomInset } from './caption-placement.ts'

describe('caption placement', () => {
  test('an upright phone puts the captions at the bottom of the picture', () => {
    // iPhone held upright, 16:9 picture: 219 px tall in the middle of 844 px.
    expect(
      pictureBottomInset({ boxWidth: 390, boxHeight: 844, videoWidth: 1920, videoHeight: 1080 }),
    ).toBe(312)
  })

  test('a scope film leaves taller bars', () => {
    expect(
      pictureBottomInset({ boxWidth: 400, boxHeight: 800, videoWidth: 1920, videoHeight: 800 }),
    ).toBe(316)
  })

  test('a landscape player keeps the captions near the bottom of the screen', () => {
    expect(
      pictureBottomInset({ boxWidth: 844, boxHeight: 390, videoWidth: 1920, videoHeight: 1080 }),
    ).toBeUndefined()
    expect(
      pictureBottomInset({ boxWidth: 1600, boxHeight: 1000, videoWidth: 1920, videoHeight: 800 }),
    ).toBeUndefined()
  })

  test('a picture that fills the height leaves no bar', () => {
    expect(
      pictureBottomInset({ boxWidth: 600, boxHeight: 800, videoWidth: 720, videoHeight: 1280 }),
    ).toBeUndefined()
  })

  test('unknown sizes keep the default place', () => {
    expect(
      pictureBottomInset({ boxWidth: 390, boxHeight: 844, videoWidth: 0, videoHeight: 0 }),
    ).toBeUndefined()
    expect(
      pictureBottomInset({ boxWidth: 0, boxHeight: 0, videoWidth: 1920, videoHeight: 1080 }),
    ).toBeUndefined()
  })
})
