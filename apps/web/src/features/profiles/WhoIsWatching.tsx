import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MeResponse } from '@projo/shared/api/auth'
import type { ProfileDto } from '@projo/shared/api/profiles'

import { PlusIcon } from '../../shared/ui/icons.tsx'
import { LockSmallIcon, PencilIcon } from '../../shared/ui/media-icons.tsx'
import { canManageAccount } from '../../shared/session/active-profile.ts'
import { safeRedirect } from '../../shared/session/safe-redirect.ts'
import { ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { Avatar } from '../shell/Avatar.tsx'
import { Logo } from '../shell/Logo.tsx'
import { PinDialog } from './PinDialog.tsx'
import { type EditorTarget, ProfileEditor } from './ProfileEditor.tsx'
import { profilesQuery, useSelectProfile, useVerifyPin } from './queries.ts'
import './profiles.css'

const maxProfiles = 5

/**
 * "Who's watching?" (§13.6, artboard `Main`): one tile per profile, a lock on the protected ones
 * (PIN asked at each switch), "Add" up to five, "Manage profiles" to rename, recolour,
 * protect or delete them.
 */
export const WhoIsWatching = ({
  me,
  manage: manageRequested,
  redirectTo,
}: {
  me: MeResponse
  manage: boolean
  redirectTo?: string
}) => {
  const { t } = useTranslation()
  // §14: a restricted profile (or, before choosing, an account with one) only switches profile.
  const canManage = canManageAccount(me)
  const manage = manageRequested && canManage
  const navigate = useNavigate()
  const profiles = useQuery({ ...profilesQuery, initialData: { items: me.profiles } })
  const select = useSelectProfile()
  const verify = useVerifyPin()
  const [pinFor, setPinFor] = useState<{ profile: ProfileDto; purpose: 'select' | 'edit' }>()
  const [editor, setEditor] = useState<EditorTarget>()
  const items = profiles.data.items

  const choose = (profile: ProfileDto, pin?: string) =>
    select.mutate(
      { id: profile.id, ...(pin === undefined ? {} : { pin }) },
      {
        onSuccess: () => {
          setPinFor(undefined)
          void navigate({ href: safeRedirect(redirectTo), replace: true })
        },
      },
    )

  const open = (profile: ProfileDto) => {
    if (manage) {
      // Changing a protected profile other than the active one needs its PIN (§14).
      if (profile.hasPin && profile.id !== me.activeProfileId) {
        verify.reset()
        setPinFor({ profile, purpose: 'edit' })
      } else setEditor({ mode: 'edit', profile })
      return
    }
    if (profile.hasPin) {
      select.reset()
      setPinFor({ profile, purpose: 'select' })
    } else choose(profile)
  }

  const submitPin = (pin: string) => {
    if (pinFor === undefined) return
    if (pinFor.purpose === 'select') {
      choose(pinFor.profile, pin)
      return
    }
    const profile = pinFor.profile
    verify.mutate(
      { id: profile.id, pin },
      {
        onSuccess: () => {
          setPinFor(undefined)
          setEditor({ mode: 'edit', profile, currentPin: pin })
        },
      },
    )
  }

  const pinMutation = pinFor?.purpose === 'edit' ? verify : select

  return (
    <div className="who">
      <div className="who__ambient" aria-hidden="true" />
      <header className="who__header">
        <Logo />
      </header>
      <main className="who__main">
        <h1 className="who__title rise">
          {manage ? t('profiles.manageTitle') : t('profiles.whoTitle')}
        </h1>
        {profiles.isError ? <ErrorState error={profiles.error} /> : undefined}
        {select.isError && pinFor === undefined ? <ErrorAlert error={select.error} /> : undefined}
        <ul className="who__profiles" aria-label={t('profiles.list')}>
          {items.map((profile, index) => (
            <li key={profile.id} className={`rise r${Math.min(index + 1, 5)}`}>
              <button
                type="button"
                className="who__profile"
                aria-label={
                  manage
                    ? t('profiles.editProfile', { name: profile.name })
                    : profile.hasPin
                      ? t('profiles.lockedProfile', { name: profile.name })
                      : profile.name
                }
                disabled={select.isPending}
                onClick={() => open(profile)}
              >
                <span className="who__avatar">
                  <Avatar name={profile.name} color={profile.avatarColor} size="tile" />
                  {profile.hasPin && !manage ? (
                    <span className="who__lock" aria-hidden="true">
                      <LockSmallIcon />
                    </span>
                  ) : undefined}
                  {manage ? (
                    <span className="who__edit" aria-hidden="true">
                      <PencilIcon size={26} />
                    </span>
                  ) : undefined}
                </span>
                <span className="who__name" aria-hidden="true">
                  {profile.name}
                </span>
              </button>
            </li>
          ))}
          {canManage && items.length < maxProfiles ? (
            <li className={`rise r${Math.min(items.length + 1, 5)}`}>
              <button
                type="button"
                className="who__profile"
                onClick={() => setEditor({ mode: 'create' })}
              >
                <span className="who__avatar who__avatar--add" aria-hidden="true">
                  <PlusIcon size={32} />
                </span>
                <span className="who__name">{t('profiles.add')}</span>
              </button>
            </li>
          ) : undefined}
        </ul>
        {manage ? (
          <button
            type="button"
            className="who__ghost button--primary-ghost rise r6"
            onClick={() =>
              void navigate({
                to: '/profiles',
                search: redirectTo === undefined ? {} : { redirect: redirectTo },
                replace: true,
              })
            }
          >
            {t('profiles.done')}
          </button>
        ) : canManage ? (
          <button
            type="button"
            className="who__ghost rise r6"
            onClick={() =>
              void navigate({
                to: '/profiles',
                search: {
                  manage: true,
                  ...(redirectTo === undefined ? {} : { redirect: redirectTo }),
                },
                replace: true,
              })
            }
          >
            {t('profiles.manage')}
          </button>
        ) : undefined}
      </main>

      <PinDialog
        profile={pinFor?.profile}
        open={pinFor !== undefined}
        title={pinFor?.profile.name ?? ''}
        pending={pinMutation.isPending}
        error={pinMutation.error}
        onSubmit={submitPin}
        onClose={() => setPinFor(undefined)}
      />
      <ProfileEditor
        target={editor}
        canDelete={items.length > 1}
        onClose={() => setEditor(undefined)}
      />
    </div>
  )
}
