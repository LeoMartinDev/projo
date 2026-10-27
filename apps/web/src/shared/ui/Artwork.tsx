import {
  type CSSProperties,
  type ReactNode,
  type RefCallback,
  type SyntheticEvent,
  useState,
} from 'react'

import { imageWidths } from '@projo/shared/api/catalog'

const reducedMotion = '(prefers-reduced-motion: reduce)'

/** Not loaded yet when mounted: `data-pending` keeps it transparent (base.css) until `reveal`. */
const holdUntilLoaded: RefCallback<HTMLImageElement> = (image) => {
  if (image && !image.complete) image.dataset['pending'] = ''
}

/** Fades a held image in; a cached one was never held and shows at once. */
const reveal = (event: SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget
  if (image.dataset['pending'] === undefined) return
  delete image.dataset['pending']
  if (window.matchMedia(reducedMotion).matches) return
  image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' })
}

/** Display width of the full-width heads (home hero, detail page): their preload uses it too. */
export const fullWidthSizes = '100vw'

/** Display width of a title logo (`max-width: min(480px, 100%)`). */
export const logoSizes = '480px'

/**
 * The `<img>` sources of an image: a catalog image (`/api/v1/images/:id`) lists its WebP variants
 * (§9.1) and the browser takes the smallest that covers `sizes` at the screen's density; other
 * URLs (timeline sheets) are taken as they are.
 */
export const artworkSources = (
  src: string,
  sizes: string,
): { srcSet?: string; sizes?: string; src: string } =>
  src.startsWith('/api/v1/images/')
    ? { srcSet: imageWidths.map((w) => `${src}?w=${w} ${w}w`).join(', '), sizes, src }
    : { src }

/**
 * An image of the catalog (`/api/v1/images/:id`) that never shows as broken: while it loads the
 * slot keeps its tone and the picture fades in when it arrives, and when it is missing or fails
 * `fallback` is drawn instead (§13.5, items without TMDB metadata). Decorative by default
 * (`alt=""`): the title is always in the text. `sizes` is its display width: `auto` measures it
 * on a lazy image (where the browser can), the length after it is the fallback and the only value
 * an eager image uses.
 */
export const Artwork = ({
  src,
  className,
  style,
  fallback,
  alt = '',
  eager = false,
  sizes = 'auto, 200px',
}: {
  src: string | undefined
  className: string
  style?: CSSProperties
  fallback?: ReactNode
  alt?: string
  eager?: boolean
  sizes?: string
}) => {
  const [failed, setFailed] = useState<string>()
  if (src === undefined || failed === src) return <>{fallback}</>
  return (
    <img
      key={src}
      ref={holdUntilLoaded}
      className={className}
      {...(style === undefined ? {} : { style })}
      {...artworkSources(src, sizes)}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={reveal}
      onError={() => setFailed(src)}
    />
  )
}
