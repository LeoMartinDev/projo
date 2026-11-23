import { useQuery } from '@tanstack/react-query'
import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminAccountDto } from '@projo/shared/api/accounts'

import { ChevronRightIcon, PlusIcon } from '../../../shared/ui/icons.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { librariesQuery } from '../queries.ts'
import { AdminAvatar, useSummaryLabels } from './parts.tsx'
import { ProfileForm, type ProfileFormStatus } from './ProfileForm.tsx'
import { profileSummary } from './summary.ts'

/** An account has at most 5 profiles (§14). */
const maxProfiles = 5

const rowIdOf = (ids: string, key: string) => `${ids}-row-${key}`

/**
 * What the Profiles tab shows: the list (`focus`: the row to focus on coming back to it, a profile
 * id or `new`), one profile's settings, or a new profile's.
 */
export type ProfileView =
  { kind: 'list'; focus?: string } | { kind: 'profile'; id: string } | { kind: 'new' }

/** The profile `view` opens, when it still exists (`undefined`: the list, or a new profile). */
export const openedProfile = (account: AdminAccountDto, view: ProfileView) =>
  view.kind === 'profile' ? account.profiles.find((profile) => profile.id === view.id) : undefined

/** Whether `view` shows a profile's form (one deleted meanwhile falls back to the list). */
export const showsProfileForm = (account: AdminAccountDto, view: ProfileView): boolean =>
  view.kind === 'new' || openedProfile(account, view) !== undefined

/**
 * The Profiles tab of an account's dialog (§15): its profiles as a list (avatar, name, what it
 * reaches), then "Add a profile" while it has fewer than 5. A row opens the profile's settings in
 * place, with a back button to the list; the dialog's footer saves them (`formId`). Focus follows:
 * the back button (or a new profile's name) on opening, the row it came from on coming back.
 */
export const AccountProfiles = ({
  account,
  view,
  formId,
  onView,
  onStatusChange,
}: {
  account: AdminAccountDto
  view: ProfileView
  formId: string
  onView: (view: ProfileView) => void
  onStatusChange: (status: ProfileFormStatus) => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const libraries = useQuery(librariesQuery)
  const labels = useSummaryLabels()
  const [root, rootRef] = useElement<HTMLDivElement>()
  const rowId = (key: string) => rowIdOf(ids, key)
  const backId = `${ids}-back`
  const profile = openedProfile(account, view)
  const full = account.profiles.length >= maxProfiles

  // Each view starts at its top, focus on its first control (or back on the row it came from).
  useEffect(() => {
    if (root === undefined) return
    root.closest('.dialog__body')?.scrollTo({ top: 0 })
    const target =
      view.kind === 'new'
        ? `${formId}-name`
        : view.kind === 'profile'
          ? `${ids}-back`
          : view.focus === undefined
            ? undefined
            : rowIdOf(ids, view.focus)
    if (target !== undefined) document.getElementById(target)?.focus()
  }, [root, view, formId, ids])

  const back = () => onView({ kind: 'list', focus: view.kind === 'profile' ? view.id : view.kind })

  return (
    <div ref={rootRef} className="acc-profiles">
      {view.kind === 'new' || profile !== undefined ? (
        <ProfileForm
          key={profile?.id ?? 'new'}
          account={account}
          {...(profile === undefined ? {} : { profile })}
          libraries={libraries.data?.items ?? []}
          formId={formId}
          backId={backId}
          onStatusChange={onStatusChange}
          onBack={back}
          onSaved={(id) => onView({ kind: 'list', focus: id })}
          onDeleted={() => {
            const next = account.profiles.find((other) => other.id !== profile?.id)
            onView(next === undefined ? { kind: 'list' } : { kind: 'list', focus: next.id })
          }}
        />
      ) : (
        <ul
          className="acc-profiles__list"
          aria-label={t('admin.accounts.profilesOf', { username: account.username })}
        >
          {account.profiles.map((candidate) => (
            <li key={candidate.id}>
              <button
                id={rowId(candidate.id)}
                type="button"
                className="acc-profile-row"
                onClick={() => onView({ kind: 'profile', id: candidate.id })}
              >
                <AdminAvatar name={candidate.name} color={candidate.avatarColor} />
                <span className="acc-profile-row__text">
                  <span className="acc-profile-row__name">{candidate.name}</span>
                  <span className="acc-profile-row__facts">
                    {profileSummary(candidate, libraries.data?.items ?? [], labels)}
                  </span>
                </span>
                {candidate.playing ? (
                  <span className="acc-activity__when">
                    <span className="dot dot--ok" aria-hidden="true" />
                    {t('admin.accounts.playing')}
                  </span>
                ) : undefined}
                <span className="acc-profile-row__chevron" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              id={rowId('new')}
              type="button"
              className="acc-profile-row acc-profile-row--add"
              disabled={full}
              onClick={() => onView({ kind: 'new' })}
            >
              <span className="acc-avatar acc-avatar--add" aria-hidden="true">
                <PlusIcon />
              </span>
              <span className="acc-profile-row__text">
                <span className="acc-profile-row__name">{t('admin.accounts.addProfile')}</span>
                {full ? (
                  <span className="acc-profile-row__facts">
                    {t('admin.accounts.profileLimit', { count: maxProfiles })}
                  </span>
                ) : undefined}
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
