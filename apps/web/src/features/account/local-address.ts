const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

const isLocalIpv4 = (host: string): boolean => {
  const match = ipv4Pattern.exec(host)
  if (!match) return false
  const [a = 0, b = 0] = match.slice(1).map(Number)
  return (
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // link-local
  )
}

const isLocalIpv6 = (host: string): boolean => {
  const address = host.toLowerCase()
  if (address === '::1') return true
  // IPv4-mapped (`::ffff:192.168.1.2`, or the hex form URL parsing gives: `::ffff:c0a8:102`).
  const mapped = /^::ffff:(.+)$/.exec(address)?.[1]
  if (mapped !== undefined) {
    if (isLocalIpv4(mapped)) return true
    const [, highWord, lowWord] = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped) ?? []
    if (highWord === undefined || lowWord === undefined) return false
    const high = Number.parseInt(highWord, 16)
    const low = Number.parseInt(lowWord, 16)
    return isLocalIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  // fc00::/7 unique local (private), fe80::/10 link-local.
  return /^f[cd][0-9a-f]{0,2}:/.test(address) || /^fe[89ab][0-9a-f]?:/.test(address)
}

/**
 * §14: an address a device only reaches from home — `localhost`, a loopback, private or
 * link-local IP, a `.local` name. `hostname` as `URL.hostname` gives it (IPv6 in brackets).
 */
export const isLocalHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host.startsWith('[') && host.endsWith(']')) return isLocalIpv6(host.slice(1, -1))
  return isLocalIpv4(host)
}
