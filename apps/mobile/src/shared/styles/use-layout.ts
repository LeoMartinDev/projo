import { useState } from 'react'
import { type LayoutChangeEvent, useWindowDimensions } from 'react-native'

import { gridOf, metricsOf, sizeClassOf } from './layout.ts'

/**
 * The layout of a browsing screen from the width it actually gets (an iPad's sidebar takes its
 * share): pass `onLayout` to the screen's root view.
 */
export const useScreenLayout = () => {
  const window = useWindowDimensions()
  const [width, setWidth] = useState(window.width)
  const sizeClass = sizeClassOf(width)
  return {
    width,
    regular: sizeClass === 'regular',
    ...metricsOf(sizeClass),
    grid: gridOf(width),
    onLayout: (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width)),
  }
}
