import { useTranslation } from 'react-i18next'
import { StyleSheet, Text } from 'react-native'

import type { Failure } from '../api/failure.ts'
import { errorKey } from '../i18n/errors.ts'
import { textStyles } from './text.ts'

/**
 * The translated error of a form, on a reserved line: the form does not jump when it shows
 * (AGENTS.md).
 */
export const ErrorLine = ({ error }: { error: Failure | undefined }) => {
  const { t } = useTranslation()
  return (
    <Text accessibilityLiveRegion="polite" style={[textStyles.error, styles.line]}>
      {error === undefined ? '' : t(errorKey(error.code))}
    </Text>
  )
}

const styles = StyleSheet.create({ line: { minHeight: 44 } })
