import { describe, expect, test } from 'bun:test'

import { adminNavEntryOf } from './admin-nav.ts'

describe('admin navigation (§15)', () => {
  test('an entry is current on any of its tabs and their sub-pages', () => {
    expect(adminNavEntryOf('/admin')).toBe('overview')
    expect(adminNavEntryOf('/admin/')).toBe('overview')
    expect(adminNavEntryOf('/admin/libraries')).toBe('media')
    expect(adminNavEntryOf('/admin/libraries/new')).toBe('media')
    expect(adminNavEntryOf('/admin/tv')).toBe('media')
    expect(adminNavEntryOf('/admin/review')).toBe('files')
    expect(adminNavEntryOf('/admin/hidden')).toBe('files')
    expect(adminNavEntryOf('/admin/accounts/abc')).toBe('accounts')
    expect(adminNavEntryOf('/admin/jobs')).toBe('activity')
    expect(adminNavEntryOf('/admin/logs')).toBe('activity')
    expect(adminNavEntryOf('/admin/settings/general')).toBe('settings')
    expect(adminNavEntryOf('/admin/settings/segments')).toBe('settings')
    expect(adminNavEntryOf('/admin/settings/updates')).toBe('settings')
    expect(adminNavEntryOf('/admin/server')).toBe('settings')
    expect(adminNavEntryOf('/admin/updates')).toBe('settings')
  })

  test('nothing is current elsewhere', () => {
    expect(adminNavEntryOf('/admin/reviewers')).toBeUndefined()
    expect(adminNavEntryOf('/movies')).toBeUndefined()
  })
})
