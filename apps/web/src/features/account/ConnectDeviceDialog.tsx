import { useMutation } from '@tanstack/react-query'
import { type ReactNode, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { type CreatePairingResponse, pairingUrl } from '@projo/shared/api/auth'

import { api, request } from '../../shared/api/client.ts'
import { useServerEvent } from '../../shared/events/events.ts'
import { Dialog } from '../../shared/ui/Dialog.tsx'
import { AlertIcon, CheckIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { isLocalHostname } from './local-address.ts'
import { QrCode } from './QrCode.tsx'

const formatCountdown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const spaced = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`

const currentSecond = () => Math.floor(Date.now() / 1000) * 1000

let tick = currentSecond()
const tickListeners = new Set<() => void>()
let tickTimer: ReturnType<typeof setInterval> | undefined

const subscribeTicks = (listener: () => void) => {
  tickListeners.add(listener)
  if (tickTimer === undefined) {
    tick = currentSecond()
    tickTimer = setInterval(() => {
      tick = currentSecond()
      for (const notify of tickListeners) notify()
    }, 1000)
  }
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size === 0) {
      clearInterval(tickTimer)
      tickTimer = undefined
    }
  }
}

const tickSnapshot = () => (tickTimer === undefined ? currentSecond() : tick)

const Countdown = ({ expiresAt, renew }: { expiresAt: string; renew: ReactNode }) => {
  const { t } = useTranslation()
  const now = useSyncExternalStore(subscribeTicks, tickSnapshot)
  const remainingSeconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
  return remainingSeconds === 0 ? (
    <>
      <span className="pairing__expired">{t('account.pairing.expired')}</span>
      {renew}
    </>
  ) : (
    <span className="pairing__countdown">
      {t('account.pairing.expiresIn', { time: formatCountdown(remainingSeconds) })}
    </span>
  )
}

export const ConnectDeviceDialog = ({
  open,
  onClose,
  onDevicesChanged,
}: {
  open: boolean
  onClose: () => void
  onDevicesChanged: () => void
}) => {
  const { t } = useTranslation()
  const [pairing, setPairing] = useState<CreatePairingResponse>()
  const [claimedBy, setClaimedBy] = useState<string>()
  const create = useMutation({
    mutationFn: () => request(() => api.auth.pairings.$post()),
    onSuccess: (created) => {
      setPairing(created)
      setClaimedBy(undefined)
    },
  })

  const onOpen = useEffectEvent(() => {
    const live =
      pairing !== undefined &&
      claimedBy === undefined &&
      new Date(pairing.expiresAt).getTime() > Date.now()
    if (!live && !create.isPending) create.mutate()
  })
  useEffect(() => {
    if (open) onOpen()
  }, [open])

  useServerEvent(
    'pairing.claimed',
    (event) => {
      if (event.pairingId !== pairing?.id) return
      setClaimedBy(event.deviceName)
      onDevicesChanged()
    },
    open,
  )

  const origin = window.location.origin
  const local = isLocalHostname(window.location.hostname)
  const newCode = (
    <button
      type="button"
      className="button button--glass button--small"
      disabled={create.isPending}
      onClick={() => create.mutate()}
    >
      {t('account.pairing.newCode')}
    </button>
  )

  return (
    <Dialog
      open={open}
      title={t('account.pairing.title')}
      onClose={() => {
        onClose()
        onDevicesChanged()
      }}
    >
      <div className="pairing">
        <div className="pairing__tile">
          {claimedBy !== undefined ? (
            <span className="pairing__done" aria-hidden="true">
              <CheckIcon size={56} />
            </span>
          ) : pairing === undefined || create.isPending ? (
            <span className="skeleton pairing__skeleton" />
          ) : (
            <QrCode
              value={pairingUrl({ origin, code: pairing.code })}
              label={t('account.pairing.qr', { origin })}
            />
          )}
        </div>
        <div className="pairing__info">
          <span className="pairing__scan">{t('account.pairing.scan')}</span>
          <span className="pairing__code mono" aria-live="polite">
            {pairing === undefined || create.isPending ? ' ' : spaced(pairing.code)}
          </span>
          <span className="pairing__origin mono" title={origin}>
            {origin}
          </span>
          <div className="pairing__status" aria-live="polite">
            {create.isError ? (
              <>
                <ErrorAlert error={create.error} />
                {newCode}
              </>
            ) : claimedBy !== undefined ? (
              <span className="pairing__claimed">
                {t('account.pairing.claimed', { name: claimedBy })}
              </span>
            ) : pairing !== undefined && !create.isPending ? (
              <Countdown expiresAt={pairing.expiresAt} renew={newCode} />
            ) : undefined}
          </div>
        </div>
      </div>
      {local ? (
        <p className="alert alert--warning">
          <AlertIcon />
          <span>{t('account.pairing.localWarning')}</span>
        </p>
      ) : undefined}
    </Dialog>
  )
}
