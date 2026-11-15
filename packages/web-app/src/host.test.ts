import { expect, test } from 'bun:test'

import { serverAddress } from './host.ts'

test("the server's address is the page's origin when the page is the server's", () => {
  expect(serverAddress('', 'http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
})

test("the server's address is the host's server origin otherwise", () => {
  expect(serverAddress('http://nas.local:8080', 'http://tauri.localhost')).toBe(
    'http://nas.local:8080',
  )
})
