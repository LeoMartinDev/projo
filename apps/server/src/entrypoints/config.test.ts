import { describe, expect, test } from 'bun:test'

import { loadConfig } from './config.ts'

describe('loadConfig', () => {
  test('applies the §5.4 defaults', () => {
    expect(loadConfig({})).toEqual({
      ok: true,
      value: { port: 8080, dataDir: '/data', trustProxy: false, logLevel: 'info' },
    })
  })

  test('reads the four variables', () => {
    const config = loadConfig({
      PORT: '9000',
      DATA_DIR: '/tmp/projo',
      TRUST_PROXY: 'TRUE',
      LOG_LEVEL: 'debug',
    })
    expect(config).toEqual({
      ok: true,
      value: { port: 9000, dataDir: '/tmp/projo', trustProxy: true, logLevel: 'debug' },
    })
  })

  test('rejects invalid values with config/invalid', () => {
    const config = loadConfig({ PORT: 'abc', TRUST_PROXY: 'yes' })
    expect(config.ok).toBe(false)
    if (!config.ok) {
      expect(config.error.code).toBe('config/invalid')
      expect(Object.keys(config.error.context?.['issues'] as object)).toEqual([
        'PORT',
        'TRUST_PROXY',
      ])
    }
  })
})
