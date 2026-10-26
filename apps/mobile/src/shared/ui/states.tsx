import { useNetworkState } from 'expo-network'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { type DimensionValue, StyleSheet, Text, View, type ViewStyle } from 'react-native'

import { toFailure } from '../api/failure.ts'
import { errorKey } from '../i18n/errors.ts'
import { colors, fonts, radii } from '../styles/tokens.ts'
import { Button } from './Button.tsx'
import { textStyles } from './text.ts'

/** A screen or a section with nothing to show (§19 "empty"). */
export const EmptyState = ({
  title,
  text,
  action,
}: {
  title: string
  text?: string | undefined
  action?: ReactNode
}) => (
  <View style={styles.state}>
    <Text style={styles.title}>{title}</Text>
    {text === undefined ? undefined : <Text style={[textStyles.body, styles.text]}>{text}</Text>}
    {action}
  </View>
)

/** A load that failed (§19 "error"): the message translated from its code, and a retry. */
export const ErrorState = ({ error, onRetry }: { error: unknown; onRetry: () => void }) => {
  const { t } = useTranslation()
  return (
    <EmptyState
      action={
        <Button label={t('common.retry')} onPress={onRetry} size="small" variant="secondary" />
      }
      text={t(errorKey(toFailure(error).code))}
      title={t('common.errorTitle')}
    />
  )
}

/** A grey box in place of what loads (§19 "loading"), the size of what comes. */
export const Skeleton = ({
  width,
  height,
  radius = radii.card,
  style,
}: {
  width?: DimensionValue
  height?: DimensionValue
  radius?: number
  style?: ViewStyle
}) => (
  <View
    style={[
      styles.skeleton,
      {
        borderRadius: radius,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
      },
      style,
    ]}
  />
)

/**
 * §19 "offline": a banner while the device has no network. The screens keep what they loaded;
 * coming back, the queries refetch (§26.5).
 */
export const OfflineBanner = () => {
  const { t } = useTranslation()
  const network = useNetworkState()
  if (network.isConnected !== false && network.isInternetReachable !== false) return undefined
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.bannerText}>{t('mobile.offline')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingVertical: 48 },
  title: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 18,
    textAlign: 'center',
  },
  text: { textAlign: 'center', marginBottom: 8 },
  skeleton: { backgroundColor: colors.glass },
  banner: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.errorTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.errorBorder,
  },
  bannerText: { color: colors.errorSoft, fontFamily: fonts.medium, fontSize: 13 },
})
