import { expect, test } from 'bun:test'

import { keepsContextMenu } from './context-menu.ts'

const element = (isEditable: boolean) => ({ closest: () => (isEditable ? {} : undefined) })

test('a text field keeps its menu, selected text too', () => {
  expect(keepsContextMenu(element(true), '')).toBe(true)
  expect(keepsContextMenu(element(false), 'Parasite')).toBe(true)
})

test('anywhere else, no menu', () => {
  expect(keepsContextMenu(element(false), '')).toBe(false)
  expect(keepsContextMenu(element(false), '  \n')).toBe(false)
  expect(keepsContextMenu(undefined, '')).toBe(false)
})
