import { SymbolView } from 'expo-symbols'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet } from 'react-native'

import { colors, sizes } from '../styles/tokens.ts'

/** Show / hide toggle at the end of a password field (kit v2 "peek"). */
export const RevealButton = ({ shown, onToggle }: { shown: boolean; onToggle: () => void }) => {
  const { t } = useTranslation()
  return (
    <Pressable
      accessibilityLabel={shown ? t('common.hidePassword') : t('common.showPassword')}
      accessibilityRole="button"
      accessibilityState={{ selected: shown }}
      hitSlop={4}
      onPress={onToggle}
      style={styles.button}
    >
      <SymbolView name={shown ? 'eye.slash' : 'eye'} size={20} tintColor={colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
