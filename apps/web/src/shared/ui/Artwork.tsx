import {
  type CSSProperties,
  type ReactNode,
  type RefCallback,
  type SyntheticEvent,
  useState,
} from 'react'

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

/**
 * An image of the catalog (`/api/v1/images/:id`) that never shows as broken: while it loads the
 * slot keeps its tone and the picture fades in when it arrives, and when it is missing or fails
 * `fallback` is drawn instead (§13.5, items without TMDB metadata). Decorative by default
 * (`alt=""`): the title is always in the text.
 */
export const Artwork = ({
  src,
  className,
  style,
  fallback,
  alt = '',
  eager = false,
}: {
  src: string | undefined
  className: string
  style?: CSSProperties
  fallback?: ReactNode
  alt?: string
  eager?: boolean
}) => {
  const [failed, setFailed] = useState<string>()
  if (src === undefined || failed === src) return <>{fallback}</>
  return (
    <img
      key={src}
      ref={holdUntilLoaded}
      className={className}
      {...(style === undefined ? {} : { style })}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={reveal}
      onError={() => setFailed(src)}
    />
  )
}
