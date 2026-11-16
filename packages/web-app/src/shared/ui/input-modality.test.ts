import { describe, expect, test } from 'bun:test'

import { modalityAfterKey } from './input-modality.ts'

const key = (value: string, more: Partial<{ ctrlKey: boolean; editing: boolean }> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  editing: false,
  ...more,
})

describe('modalityAfterKey', () => {
  test('a key that moves or acts makes the keyboard drive', () => {
    expect(modalityAfterKey('pointer', key('Tab'))).toBe('keyboard')
    expect(modalityAfterKey('pointer', key(' '))).toBe('keyboard')
    expect(modalityAfterKey('pointer', key('/'))).toBe('keyboard')
    expect(modalityAfterKey('pointer', key('Escape', { editing: true }))).toBe('keyboard')
    expect(modalityAfterKey('pointer', key('ArrowDown', { editing: true }))).toBe('keyboard')
  })

  test('modifiers, shortcuts and typing into a field keep the modality', () => {
    expect(modalityAfterKey('pointer', key('Shift'))).toBe('pointer')
    expect(modalityAfterKey('pointer', key('c', { ctrlKey: true }))).toBe('pointer')
    expect(modalityAfterKey('pointer', key('b', { editing: true }))).toBe('pointer')
    expect(modalityAfterKey('pointer', key('Backspace', { editing: true }))).toBe('pointer')
    expect(modalityAfterKey('keyboard', key('b', { editing: true }))).toBe('keyboard')
  })
})
