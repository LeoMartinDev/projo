const browsers: [RegExp, string][] = [
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

/** Default device name of a cookie session: "Firefox · macOS" (§14 "nom, navigateur"). */
export const describeUserAgent = (userAgent: string): string => {
  const parts = [firstMatch(browsers, userAgent), firstMatch(systems, userAgent)].filter(
    (part): part is string => part !== undefined,
  )
  return parts.length === 0 ? 'Unknown device' : parts.join(' · ')
}
