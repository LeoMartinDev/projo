import {
  type CSSProperties,
  type ReactNode,
  type RefCallback,
  type SyntheticEvent,
  useState,
} from 'react'

import { imageWidths } from '@projo/shared/api/catalog'

import { reducedMotion } from '../styles/media.ts'

const holdUntilLoaded: RefCallback<HTMLImageElement> = (image) => {
  if (image && !image.complete) image.dataset['pending'] = ''
}

const reveal = (event: SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget
  if (image.dataset['pending'] === undefined) return
  delete image.dataset['pending']
  if (window.matchMedia(reducedMotion).matches) return
  image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' })
}

export const fullWidthSizes = '100vw'

export const logoSizes = '480px'

export const artworkSources = (
  src: string,
  sizes: string,
): { srcSet?: string; sizes?: string; src: string } =>
  src.startsWith('/api/v1/images/')
    ? { srcSet: imageWidths.map((w) => `${src}?w=${w} ${w}w`).join(', '), sizes, src }
    : { src }

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
