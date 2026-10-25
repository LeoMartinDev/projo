import { expect, test } from 'bun:test'

import { basename, nameFromFolder, parentOf } from './folder-paths.ts'

test('basename and parent of a path', () => {
  expect(basename('/media/films/')).toBe('films')
  expect(basename('/')).toBe('')
  expect(parentOf('/media/films')).toBe('/media')
  expect(parentOf('/media')).toBe('/')
})

test('the suggested name capitalizes the last folder', () => {
  expect(nameFromFolder('/mnt/nas/séries', 'fr')).toBe('Séries')
  expect(nameFromFolder('/', 'fr')).toBe('')
})
