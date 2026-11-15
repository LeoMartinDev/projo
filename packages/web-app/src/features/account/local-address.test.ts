import { describe, expect, test } from 'bun:test'

import { isLocalHostname } from './local-address.ts'

describe('isLocalHostname', () => {
  test('local: localhost, loopback, private and link-local IPs, .local names', () => {
    for (const host of [
      'localhost',
      'projo.localhost',
      '127.0.0.1',
      '127.8.9.10',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.20',
      '169.254.10.1',
      'nas.local',
      'NAS.LOCAL.',
      '[::1]',
      '[fd12:3456::1]',
      '[fc00::1]',
      '[fe80::1]',
      '[::ffff:192.168.1.2]',
      '[::ffff:c0a8:102]',
    ]) {
      expect(isLocalHostname(host)).toBe(true)
    }
  })

  test('public: domain names and public IPs', () => {
    for (const host of [
      'projo.example.com',
      'local.example.com',
      'localhost.example.com',
      '8.8.8.8',
      '172.32.0.1',
      '172.15.0.1',
      '192.169.1.1',
      '[2001:db8::1]',
      '[::ffff:808:808]',
    ]) {
      expect(isLocalHostname(host)).toBe(false)
    }
  })
})
