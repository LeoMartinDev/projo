export type Rgb = { r: number; g: number; b: number }

type Oklab = { l: number; a: number; b: number }

const tintLightness = { min: 0.2, max: 0.26 }
const maxTintChroma = 0.055
const tintChromaShare = 0.6
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

export const artworkTint = (pixels: ArrayLike<number>): string | undefined => {
  const average = averageColor(pixels)
  return average === undefined ? undefined : toHex(darkTintOf(average))
}

export const relativeLuminance = ({ r, g, b }: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

export const contrastRatio = (one: Rgb, other: Rgb) => {
  const [light, dark] = [relativeLuminance(one), relativeLuminance(other)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}
