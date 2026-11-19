import { describe, expect, test } from 'bun:test'

import { changedFields, draftOf, editsAfterSave, isDirty, sameValue } from './settings-draft.ts'

const saved = { name: 'projo', downmix: true, providers: ['introdb', 'skipdb'] }

describe('the save model of the Settings tabs (§15)', () => {
  test('the form shows the saved values, each replaced by its edit', () => {
    expect(draftOf(saved, {})).toEqual(saved)
    expect(draftOf(saved, { name: 'Salon' })).toEqual({ ...saved, name: 'Salon' })
  })

  test('only the edits that differ from the saved values are changes', () => {
    expect(changedFields(saved, { name: 'projo', downmix: false })).toEqual({ downmix: false })
    expect(changedFields(saved, { providers: ['skipdb', 'introdb'] })).toEqual({
      providers: ['skipdb', 'introdb'],
    })
    expect(changedFields(saved, { providers: ['introdb', 'skipdb'] })).toEqual({})
  })

  test('an edit put back to the saved value leaves nothing to save', () => {
    expect(isDirty(saved, {})).toBe(false)
    expect(isDirty(saved, { downmix: true, name: 'projo' })).toBe(false)
    expect(isDirty(saved, { name: 'Salon' })).toBe(true)
  })

  test('a save drops the edits it sent, not those made while it ran', () => {
    expect(editsAfterSave<typeof saved>({ name: 'Salon' }, { name: 'Salon' })).toEqual({})
    expect(
      editsAfterSave<typeof saved>({ name: 'Salon 2', downmix: false }, { name: 'Salon' }),
    ).toEqual({
      name: 'Salon 2',
      downmix: false,
    })
  })

  test('lists compare element by element, in order', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameValue(['a'], ['a', 'b'])).toBe(false)
    expect(sameValue('2', 2)).toBe(false)
  })
})
