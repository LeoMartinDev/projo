import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { passwordSchema, type SessionDto, sessionsResponseSchema } from '@projo/shared/api/auth'

import { requestApi } from '../../shared/api/client.ts'
import { failure, toFailure } from '../../shared/api/failure.ts'
import { formatRelative } from '../../shared/i18n/intl.ts'
import { colors, fonts } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { RevealButton } from '../../shared/ui/RevealButton.tsx'
import { Section, SettingsPage } from '../../shared/ui/Settings.tsx'
import { TextField } from '../../shared/ui/TextField.tsx'
import { unwrap } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'

const sessionsKey = ['session', 'devices'] as const

/** The session's client, or a failure if the server is gone meanwhile. */
const useApi = () => {
  const { api } = useSession()
  return () => {
    if (api === undefined) throw failure('unknown', 'no server')
    return api
  }
}

/** `POST /auth/password`: the server signs the other devices out (§14). */
const PasswordSection = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const api = useApi()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [shown, setShown] = useState(false)
  const change = useMutation({
    mutationFn: () =>
      unwrap(
        requestApi(() =>
          api().auth.password.$post({ json: { currentPassword: current, newPassword: next } }),
        ),
      ),
    onSuccess: async () => {
      setCurrent('')
      setNext('')
      setConfirmation('')
      await queryClient.invalidateQueries({ queryKey: sessionsKey })
    },
  })
  const valid = passwordSchema.safeParse(next).success
  const matches = confirmation.length > 0 && confirmation === next
  const mismatch = !matches && confirmation.length > 0 && confirmation.length >= next.length
  const ready = current.length > 0 && valid && matches
  const error = change.error ?? undefined

  return (
    <Section title={t('account.password.title')}>
      <View style={styles.form}>
        <TextField
          autoCapitalize="none"
          autoComplete="current-password"
          label={t('account.password.current')}
          onChangeText={setCurrent}
          secureTextEntry={!shown}
          textContentType="password"
          trail={<RevealButton onToggle={() => setShown(!shown)} shown={shown} />}
          value={current}
        />
        <TextField
          autoCapitalize="none"
          autoComplete="new-password"
          label={t('account.password.new')}
          onChangeText={setNext}
          secureTextEntry={!shown}
          textContentType="newPassword"
          value={next}
        />
        <TextField
          autoCapitalize="none"
          autoComplete="new-password"
          invalid={mismatch}
          label={t('account.password.confirmation')}
          onChangeText={setConfirmation}
          secureTextEntry={!shown}
          textContentType="newPassword"
          value={confirmation}
        />
        <Text style={[styles.hint, mismatch && styles.hintError]}>
          {mismatch ? t('setup.account.mismatch') : t('setup.account.passwordRule')}
        </Text>
        {change.isSuccess ? (
          <Text accessibilityLiveRegion="polite" style={styles.done}>
            {t('account.password.done')}
          </Text>
        ) : (
          <ErrorLine error={error === undefined ? undefined : toFailure(error)} />
        )}
        <Button
          busy={change.isPending}
          disabled={!ready}
          label={t('account.password.submit')}
          onPress={() => change.mutate()}
        />
      </View>
    </Section>
  )
}

const Device = ({
  session,
  revoking,
  onRevoke,
}: {
  session: SessionDto
  revoking: boolean
  onRevoke: () => void
}) => {
  const { t, i18n } = useTranslation()
  return (
    <View style={styles.device}>
      <View style={styles.deviceText}>
        <Text numberOfLines={1} style={styles.deviceName}>
          {session.deviceName}
        </Text>
        <Text numberOfLines={1} style={styles.deviceMeta}>
          {[
            session.current ? t('account.devices.current') : undefined,
            session.kind === 'bearer' ? t('account.devices.app') : undefined,
            t('account.devices.lastSeen', {
              when: formatRelative(session.lastSeenAt, i18n.language),
            }),
          ]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </Text>
      </View>
      {session.current ? undefined : (
        <Button
          accessibilityLabel={t('account.devices.revokeDevice', { name: session.deviceName })}
          busy={revoking}
          label={t('account.devices.revoke')}
          onPress={onRevoke}
          size="small"
          variant="danger"
        />
      )}
    </View>
  )
}

/** The account's browsers and devices (§14), most recent first, revocable one by one. */
const DevicesSection = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const api = useApi()
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: () => unwrap(requestApi(() => api().auth.sessions.$get(), sessionsResponseSchema)),
    // Not kept after the screen: another account signed in later never sees this list.
    gcTime: 0,
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      unwrap(requestApi(() => api().auth.sessions[':id'].$delete({ param: { id } }))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  })
  const error = sessions.error ?? revoke.error ?? undefined

  return (
    <Section title={t('account.devices.title')}>
      {sessions.data === undefined ? (
        <View style={styles.device}>
          {sessions.isError ? (
            <Button
              label={t('common.retry')}
              onPress={() => void sessions.refetch()}
              size="small"
              variant="secondary"
            />
          ) : (
            <Text style={styles.deviceMeta}>{t('common.loading')}</Text>
          )}
        </View>
      ) : (
        sessions.data.items.map((session) => (
          <Device
            key={session.id}
            onRevoke={() => revoke.mutate(session.id)}
            revoking={revoke.isPending && revoke.variables === session.id}
            session={session}
          />
        ))
      )}
      {error === undefined ? undefined : (
        <View style={styles.errorRow}>
          <ErrorLine error={toFailure(error)} />
        </View>
      )}
    </Section>
  )
}

/** `/settings/account`: password and devices, hidden from a restricted profile (§14). */
export const AccountScreen = () => (
  <SettingsPage>
    <PasswordSection />
    <DevicesSection />
  </SettingsPage>
)

const styles = StyleSheet.create({
  form: { gap: 12, padding: 16 },
  hint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 4 },
  hintError: { color: colors.errorSoft },
  done: {
    minHeight: 44,
    color: colors.success,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  deviceText: { flex: 1, gap: 3 },
  deviceName: { color: colors.text, fontFamily: fonts.medium, fontSize: 16 },
  deviceMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  errorRow: { paddingHorizontal: 16, paddingTop: 8 },
})
