import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProfileDto } from '@projo/shared/api/profiles'

import { Dialog } from '../../shared/ui/Dialog.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { Avatar } from '../shell/Avatar.tsx'

const pinLength = 4

export const PinDialog = ({
  profile,
  open,
  title,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  profile: ProfileDto | undefined
  open: boolean
  title: string
  pending: boolean
  error: unknown
  onSubmit: (pin: string) => void
  onClose: () => void
}) => (
  <Dialog open={open} title={title} onClose={onClose}>
    {profile === undefined ? undefined : (
      <PinForm
        key={profile.id}
        profile={profile}
        pending={pending}
        error={error}
        onSubmit={onSubmit}
      />
    )}
  </Dialog>
)

const PinForm = ({
  profile,
  pending,
  error,
  onSubmit,
}: {
  profile: ProfileDto
  pending: boolean
  error: unknown
  onSubmit: (pin: string) => void
}) => {
  const { t } = useTranslation()
  const inputId = useId()
  const [pin, setPin] = useState('')
  const [input, inputRef] = useElement<HTMLInputElement>()
  useEffect(() => {
    if (input === undefined) return
    const frame = requestAnimationFrame(() => input.focus())
    return () => cancelAnimationFrame(frame)
  }, [input])
  const failed = Boolean(error) && !pending && pin.length === 0

  return (
    <div className="pin">
      <Avatar name={profile.name} color={profile.avatarColor} size="xlarge" />
      <label className="pin__label" htmlFor={inputId}>
        {t('profiles.pin.label', { name: profile.name })}
      </label>
      <div className="pin__boxes" data-error={failed}>
        <input
          ref={inputRef}
          id={inputId}
          className="pin__input"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={pinLength}
          readOnly={pending}
          value={pin}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, pinLength)
            if (digits.length === pinLength) {
              setPin('')
              onSubmit(digits)
            } else setPin(digits)
          }}
        />
        {Array.from({ length: pinLength }, (_, index) => (
          <span
            key={index}
            className="pin__box"
            data-filled={index < pin.length}
            data-current={index === pin.length}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="pin__feedback">
        {pending ? <span className="spinner" aria-hidden="true" /> : undefined}
        {failed ? <ErrorAlert error={error} /> : undefined}
      </div>
    </div>
  )
}
