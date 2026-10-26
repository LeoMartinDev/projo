import { SymbolView } from 'expo-symbols'
import { StyleSheet, Text, View } from 'react-native'

import type { AvatarColor } from '@projo/shared/api/profiles'

import { avatarColors, fonts, titleTracking } from '../../shared/styles/tokens.ts'

/** Profile avatar (§13.6, `Main`): the initial on a coloured tile, no image. */
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
        <SymbolView name="lock.fill" size={13} tintColor="#ffffff" />
      </View>
    ) : undefined}
  </View>
)

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: '#ffffff', fontFamily: fonts.semibold },
  lock: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 10, 11, 0.4)',
  },
})
