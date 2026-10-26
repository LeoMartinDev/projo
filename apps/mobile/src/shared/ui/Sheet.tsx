import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { colors, fonts, sizes } from '../styles/tokens.ts'

/**
 * A native iOS sheet (page sheet, swipe down to close) with a title and a close button: what the
 * web shows in a dialog (PIN, profile editor, pickers).
 */
export const Sheet = ({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) => {
  const { t } = useTranslation()
  return (
    <Modal
      allowSwipeDismissal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={open}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.close}>
            <Text style={styles.closeLabel}>{t('common.close')}</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView behavior="padding" style={styles.fill}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.surface },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: 20,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 17 },
  close: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  closeLabel: { color: colors.textSoft, fontFamily: fonts.medium, fontSize: 16 },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
})
