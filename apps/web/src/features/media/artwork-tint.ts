/**
 * The colour a hover preview's panel takes from its artwork (artboard `Home`, the `tint` of each
 * item): the artwork's average colour, leaning towards its colourful pixels, darkened and muted
 * enough for the panel's text. Pure colour math, sampled by `use-artwork-tint.ts`.
 */

/** sRGB channels, 0–255. */
export type Rgb = { r: number; g: number; b: number }

type Oklab = { l: number; a: number; b: number }

/**
 * Lightness range of a tint (OKLab, the design's tints sit at 0.22–0.29): `#F4F4F5` keeps
 * ≥ 13:1, `#A1A1AA` ≥ 6:1 and `#8B8B94` ≥ 4.5:1 on it.
 */
const tintLightness = { min: 0.2, max: 0.26 }
/** Most chroma a tint keeps (OKLab): coloured, never loud. */
const maxTintChroma = 0.055
/** Share of the artwork's chroma a tint keeps before the cap. */
const tintChromaShare = 0.6
/** Weight of a grey pixel next to a colourful one (weight = this + chroma). */
const greyWeight = 0.02

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

const toLinear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const fromLinear = (value: number) => {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return c * 255
}

/** Björn Ottosson's OKLab (https://bottosson.github.io/posts/oklab/). */
export const rgbToOklab = ({ r, g, b }: Rgb): Oklab => {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** Linear sRGB, unclamped (out of gamut when a channel leaves 0–1). */
const oklabToLinear = ({ l: lightness, a, b }: Oklab) => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ] as const
}

const inGamut = (color: Oklab) => oklabToLinear(color).every((c) => c >= -1e-4 && c <= 1 + 1e-4)

const oklabToRgb = (color: Oklab): Rgb => {
  const [r, g, b] = oklabToLinear(color).map((c) => Math.round(fromLinear(clamp(c, 0, 1))))
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
}

/**
 * The average colour of RGBA pixels (a canvas' `ImageData.data`), in OKLab: lightness is the plain
 * mean, the hue leans towards colourful pixels (a red sign in a dark street gives a dark red, not
 * a brown). `undefined` when no pixel is opaque enough to count.
 */
export const averageColor = (pixels: ArrayLike<number>): Oklab | undefined => {
  let lightness = 0
  let opacity = 0
  let a = 0
  let b = 0
  let weight = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = (pixels[i + 3] ?? 0) / 255
    if (alpha < 0.5) continue
    const color = rgbToOklab({ r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0 })
    const w = alpha * (greyWeight + Math.hypot(color.a, color.b))
    lightness += alpha * color.l
    opacity += alpha
    a += w * color.a
    b += w * color.b
    weight += w
  }
  if (opacity === 0) return undefined
  return { l: lightness / opacity, a: a / weight, b: b / weight }
}

/**
 * The panel colour for an artwork of average colour `color`: same hue, lightness squeezed into
 * `tintLightness` (a brighter artwork gives a slightly lighter tint), chroma cut down and reduced
 * further until the colour fits in sRGB.
 */
export const darkTintOf = (color: Oklab): Rgb => {
  const l =
    tintLightness.min + (tintLightness.max - tintLightness.min) * clamp(color.l, 0, 1) ** 1.5
  const chroma = Math.hypot(color.a, color.b)
  const hue = Math.atan2(color.b, color.a)
  let c = Math.min(chroma * tintChromaShare, maxTintChroma)
  const at = (value: number): Oklab => ({ l, a: value * Math.cos(hue), b: value * Math.sin(hue) })
  while (c > 0.001 && !inGamut(at(c))) c *= 0.9
  return oklabToRgb(at(c))
}

const hex = (channel: number) => channel.toString(16).padStart(2, '0')

export const toHex = ({ r, g, b }: Rgb) => `#${hex(r)}${hex(g)}${hex(b)}`

/** The tint (`#rrggbb`) of an artwork sampled as RGBA pixels, `undefined` for a blank sample. */
export const artworkTint = (pixels: ArrayLike<number>): string | undefined => {
  const average = averageColor(pixels)
  return average === undefined ? undefined : toHex(darkTintOf(average))
}

/** WCAG 2 relative luminance. */
export const relativeLuminance = ({ r, g, b }: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** WCAG 2 contrast ratio, 1–21. */
export const contrastRatio = (one: Rgb, other: Rgb) => {
  const [light, dark] = [relativeLuminance(one), relativeLuminance(other)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}
