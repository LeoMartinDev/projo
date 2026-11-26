/** The admin's sections (§15): one sidebar entry each, their tabs being routes of their own. */
export const adminNavEntries = [
  'overview',
  'media',
  'files',
  'accounts',
  'activity',
  'settings',
] as const
export type AdminNavEntry = (typeof adminNavEntries)[number]

const sectionPaths: Record<Exclude<AdminNavEntry, 'overview'>, readonly string[]> = {
  media: ['/admin/libraries', '/admin/catalogue', '/admin/tv'],
  files: ['/admin/review', '/admin/pending', '/admin/missing', '/admin/hidden'],
  accounts: ['/admin/accounts'],
  activity: ['/admin/notifications', '/admin/jobs', '/admin/logs'],
  settings: ['/admin/settings', '/admin/server', '/admin/updates'],
}

const under = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`)

/** The sidebar entry that is current on `pathname`: the one any of whose tabs it is in. */
export const adminNavEntryOf = (pathname: string): AdminNavEntry | undefined => {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (path === '/admin') return 'overview'
  return adminNavEntries.find(
    (entry) => entry !== 'overview' && sectionPaths[entry].some((root) => under(path, root)),
  )
}
