import { type SFSymbol, SymbolView } from 'expo-symbols'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radii } from '../../shared/styles/tokens.ts'

export const PlayButton = ({
  label,
  size = 'regular',
}: {
  label: string
  size?: 'regular' | 'large' | 'block'
}) => (
  <View
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ disabled: true }}
    accessible
    style={[styles.play, size === 'large' && styles.playLarge, size === 'block' && styles.block]}
  >
    <SymbolView name="play.fill" size={15} tintColor={colors.onAccent} />
    <Text numberOfLines={1} style={styles.playLabel}>
      {label}
    </Text>
  </View>
)

export const GlassButton = ({
  label,
  icon,
  onPress,
  showLabel,
  selected,
  round = false,
}: {
  label: string
  icon: SFSymbol
  onPress: () => void
  showLabel: boolean
  selected?: boolean
  round?: boolean
}) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    {...(selected === undefined ? {} : { accessibilityState: { selected } })}
    onPress={onPress}
    style={({ pressed }) => [
      styles.glass,
      showLabel ? styles.glassWide : round ? styles.glassRound : styles.glassSquare,
      pressed && styles.pressed,
    ]}
  >
    <SymbolView name={icon} size={18} tintColor={colors.text} weight="semibold" />
    {showLabel ? (
      <Text numberOfLines={1} style={styles.glassLabel}>
        {label}
      </Text>
    ) : undefined}
  </Pressable>
)

export const ActionButton = ({
  label,
  icon,
  onPress,
  selected,
}: {
  label: string
  icon: SFSymbol
  onPress: () => void
  selected?: boolean
}) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    {...(selected === undefined ? {} : { accessibilityState: { selected } })}
    onPress={onPress}
    style={({ pressed }) => [styles.action, pressed && styles.pressed]}
  >
    <SymbolView name={icon} size={22} tintColor={colors.textMutedStrong} />
    <Text numberOfLines={1} style={styles.actionLabel}>
      {label}
    </Text>
  </Pressable>
)

const styles = StyleSheet.create({
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
  },
  playLarge: { height: 50, paddingLeft: 22, paddingRight: 28 },
  block: { height: 46, alignSelf: 'stretch' },
  playLabel: { color: colors.onAccent, fontFamily: fonts.semibold, fontSize: 15 },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  glassWide: { paddingHorizontal: 18 },
  glassSquare: { width: 48 },
  glassRound: { width: 50, height: 50, borderRadius: radii.pill },
  glassLabel: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10 },
  actionLabel: { color: colors.textMutedStrong, fontFamily: fonts.regular, fontSize: 12 },
})
