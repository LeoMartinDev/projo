import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native'

import city from '../../../../web/src/shared/backdrops/city.webp'
import dunes from '../../../../web/src/shared/backdrops/dunes.webp'
import forest from '../../../../web/src/shared/backdrops/forest.webp'
import ocean from '../../../../web/src/shared/backdrops/ocean.webp'

/** The web's illustrations (§26.5), same files; origin of the zoom as in `backdrops.css`. */
const images = {
  ocean: { source: ocean, origin: '70% 30%' },
  forest: { source: forest, origin: '75% 22%' },
  dunes: { source: dunes, origin: '62% 56%' },
  city: { source: city, origin: '50% 50%' },
} as const

export type BackdropImage = keyof typeof images

/** `prefers-reduced-motion` of iOS (Settings › Accessibility › Motion). */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => subscription.remove()
  }, [])
  return reduced
}

const still = 1.04

/**
 * A full-screen illustration behind an entry screen, darkened for the panel over it: the web's
 * `Backdrop` (narrow-screen shade), with its slow Ken Burns (32 s), still under reduced motion.
 */
export const Backdrop = ({ image }: { image: BackdropImage }) => {
  const reduced = useReducedMotion()
  const [scale] = useState(() => new Animated.Value(still))
  useEffect(() => {
    if (reduced) {
      scale.setValue(still)
      return
    }
    const zoom = Animated.timing(scale, {
      toValue: 1.14,
      duration: 32_000,
      easing: Easing.bezier(0, 0, 0.58, 1),
      useNativeDriver: true,
    })
    zoom.start()
    return () => zoom.stop()
  }, [reduced, scale])

  const { source, origin } = images[image]
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.fill}
    >
      <Animated.Image
        resizeMode="cover"
        source={source}
        style={[styles.fill, { transformOrigin: origin, transform: [{ scale }] }]}
      />
      <View style={[styles.fill, styles.shade]} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  shade: { backgroundColor: 'rgba(10, 10, 11, 0.5)' },
})
