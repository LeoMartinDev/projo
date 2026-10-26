import { useMemo } from 'react'
import { encode } from 'uqr'

/** A QR code as one SVG path (no markup injected: the CSP stays strict). Quiet zone: the tile's padding. */
export const QrCode = ({ value, label }: { value: string; label: string }) => {
  const { size, path } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 0 })
    return {
      size: data.length,
      path: data
        .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
        .join(''),
    }
  }, [value])
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}
