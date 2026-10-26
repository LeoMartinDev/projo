import { StyleSheet, Text, View } from 'react-native'

import type { AvatarColor } from '@projo/shared/api/profiles'

import { avatarColors, titleTracking } from '../../shared/styles/tokens.ts'

/** Profile avatar (§13.6): the initial on a coloured tile, no image. */
export const Avatar = ({
  name,
  color,
  size,
  locked = false,
}: {
  name: string
  color: AvatarColor
  size: number
  /** A padlock on a PIN-protected profile (§13.6). */
  locked?: boolean
}) => (
  <View
    style={[
      styles.tile,
      {
        width: size,
        height: size,
        borderRadius: size * 0.23,
        backgroundColor: avatarColors[color],
      },
    ]}
  >
    <Text
      style={[styles.initial, { fontSize: size * 0.4, letterSpacing: titleTracking(size * 0.4) }]}
    >
      {(name.trim()[0] ?? '?').toLocaleUpperCase()}
    </Text>
    {locked ? (
      <View style={styles.lock}>
        <View style={styles.shackle} />
        <View style={styles.body} />
      </View>
    ) : undefined}
  </View>
)

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#ffffff', fontWeight: '600' },
  lock: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 10, 11, 0.4)',
  },
  shackle: {
    width: 8,
    height: 6,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: '#ffffff',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  body: { width: 12, height: 8, borderRadius: 2, backgroundColor: '#ffffff' },
})
