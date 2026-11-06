// The two font packages scripts/fonts.ts uses ship no types: what it calls of them.
declare module 'subset-font' {
  const subsetFont: (
    font: Uint8Array,
    text: string,
    options?: {
      targetFormat?: 'woff2' | 'woff' | 'truetype'
      variationAxes?: Record<string, number | { min: number; max: number; default?: number }>
    },
  ) => Promise<Uint8Array>
  export default subsetFont
}

declare module 'fontverter' {
  const fontverter: {
    convert: (font: Uint8Array, format: 'woff2' | 'woff' | 'truetype') => Promise<Uint8Array>
  }
  export default fontverter
}
