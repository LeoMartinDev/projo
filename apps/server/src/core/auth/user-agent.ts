const browsers: [RegExp, string][] = [
  // TRANSITIONAL (§28.1): desktop apps older than 0.5.0 load the server's page in WebView2 and
  // append this token to its Edge user agent (newer ones send `deviceName`). Removed together
  // with apps/web/src/desktop-compat/, once those apps are gone.
  [/projo-desktop\//, 'projo desktop'],
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const systems: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

const firstMatch = (table: [RegExp, string][], userAgent: string): string | undefined =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1]

export const describeUserAgent = (userAgent: string): string => {
  const parts = [firstMatch(browsers, userAgent), firstMatch(systems, userAgent)].filter(
    (part): part is string => part !== undefined,
  )
  return parts.length === 0 ? 'Unknown device' : parts.join(' · ')
}
