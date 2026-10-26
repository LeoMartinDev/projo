import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native'

import type { Failure } from '../../shared/api/failure.ts'
import { colors, radii } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { EntryScreen } from '../../shared/ui/EntryScreen.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { textStyles } from '../../shared/ui/text.ts'
import { useSession } from '../session/Session.tsx'
import { parsePairingLink } from './pairing-input.ts'

/**
 * Scans the QR code of "Connect a device" (§14): its origin becomes the server, its code is
 * claimed. A code that failed is not retried until another one is in view (the claim is limited
 * to 10 attempts per 15 minutes).
 */
export const ScanScreen = () => {
  const { t } = useTranslation()
  const { pair } = useSession()
  const [permission, requestPermission] = useCameraPermissions({ request: true })
  const [invalid, setInvalid] = useState<Failure>()
  const lastScanned = useRef<string | undefined>(undefined)

  const scanned = ({ data }: BarcodeScanningResult) => {
    if (pair.pending || data === lastScanned.current) return
    lastScanned.current = data
    const parsed = parsePairingLink(data)
    if (!parsed.ok) {
      pair.reset()
      setInvalid(parsed.error)
      return
    }
    setInvalid(undefined)
    pair.run(parsed.value)
  }

  const granted = permission?.granted === true
  const blocked = permission?.granted === false && !permission.canAskAgain

  return (
    <EntryScreen image="forest" pushed title={t('mobile.scan.title')}>
      {/* Fixed square: the same frame before, during and after the permission (AGENTS.md). */}
      <View style={styles.frame}>
        {granted ? (
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            facing="back"
            onBarcodeScanned={scanned}
            style={StyleSheet.absoluteFill}
          />
        ) : blocked ? (
          <Text style={[textStyles.body, styles.message]}>{t('mobile.scan.denied')}</Text>
        ) : undefined}
        {pair.pending ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.text} size="large" />
          </View>
        ) : undefined}
      </View>
      <ErrorLine error={invalid ?? pair.error} />
      {granted ? undefined : blocked ? (
        <Button
          label={t('mobile.scan.openSettings')}
          onPress={() => void Linking.openSettings()}
          size="large"
        />
      ) : (
        <Button
          label={t('mobile.scan.allow')}
          onPress={() => void requestPermission()}
          size="large"
        />
      )}
    </EntryScreen>
  )
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.well,
    overflow: 'hidden',
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { textAlign: 'center', paddingHorizontal: 24 },
  busy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 10, 11, 0.6)',
  },
})
