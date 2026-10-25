import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InvitationDto } from '@projo/shared/api/invitations'

import { api, request } from '../../../shared/api/client.ts'
import { formatDate } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { CheckIcon, CloseIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { CopyIcon, LinkIcon } from '../admin-icons.tsx'
import { invitationLink, invitationsQuery, invitationsQueryKey } from './queries.ts'

/** Selects the field and runs the `copy` command: works over plain HTTP on a LAN. */
const copyBySelection = (input: HTMLInputElement | undefined): boolean => {
  if (input === undefined) return false
  input.select()
  return document.execCommand('copy')
}

/** Clipboard API where available (HTTPS, localhost), the selection otherwise or when refused. */
const copyText = async (text: string, input: HTMLInputElement | undefined): Promise<boolean> => {
  if (!window.isSecureContext || navigator.clipboard === undefined) return copyBySelection(input)
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => copyBySelection(input),
  )
}

/** The link of a new invitation, shown this once (§14: only its hash is stored). */
export const InvitationCreatedDialog = ({
  token,
  onClose,
}: {
  token: string
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const [input, inputRef] = useElement<HTMLInputElement>()
  const [copied, setCopied] = useState<boolean>()
  const link = invitationLink(token)
  return (
    <Dialog
      open
      title={t('admin.accounts.invitations.createdTitle')}
      onClose={onClose}
      footer={
        <button type="button" className="button button--primary" onClick={onClose}>
          {t('admin.accounts.invitations.done')}
        </button>
      }
    >
      <p className="dialog__text">{t('admin.accounts.invitations.createdText')}</p>
      <div className="invite-link">
        <Field id={`${id}-link`} label={t('admin.accounts.invitations.link')} icon={<LinkIcon />}>
          <input
            ref={inputRef}
            id={`${id}-link`}
            className="field__input mono"
            readOnly
            value={link}
            onFocus={(event) => event.target.select()}
          />
        </Field>
        <button
          type="button"
          className="button button--glass"
          onClick={() => {
            void copyText(link, input).then(setCopied)
          }}
        >
          {copied === true ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied === true
            ? t('admin.accounts.invitations.copied')
            : t('admin.accounts.invitations.copy')}
        </button>
      </div>
      {copied === false ? (
        <p className="hint hint--error">{t('admin.accounts.invitations.copyFailed')}</p>
      ) : undefined}
    </Dialog>
  )
}

/** `POST /admin/invitations`: the caller shows the returned token once. */
export const useCreateInvitation = (onCreated: (token: string) => void) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request(() => api.admin.invitations.$post()),
    onSuccess: async ({ token }) => {
      onCreated(token)
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey })
    },
  })
}

const InvitationRow = ({ invitation }: { invitation: InvitationDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: () =>
      request(() => api.admin.invitations[':id'].$delete({ param: { id: invitation.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsQueryKey }),
  })
  return (
    <li className="invite-row">
      <span className="invite-row__icon" aria-hidden="true">
        <LinkIcon size={16} />
      </span>
      <span className="invite-row__text">
        {invitation.createdBy === undefined
          ? t('admin.accounts.invitations.rowNoCreator', {
              date: formatDate(invitation.expiresAt, locale),
            })
          : t('admin.accounts.invitations.row', {
              username: invitation.createdBy.username,
              date: formatDate(invitation.expiresAt, locale),
            })}
      </span>
      {revoke.isError ? <ErrorAlert error={revoke.error} /> : undefined}
      <button
        type="button"
        className="icon-button"
        aria-label={t('admin.accounts.invitations.revoke')}
        disabled={revoke.isPending}
        onClick={() => revoke.mutate()}
      >
        <CloseIcon size={16} />
      </button>
    </li>
  )
}

/** Pending invitations (§15 Comptes: "invitations en cours"), withdrawable. */
export const Invitations = () => {
  const { t } = useTranslation()
  const invitations = useQuery(invitationsQuery)
  const pending = invitations.data?.items.filter((item) => item.state === 'pending') ?? []
  return (
    <section className="invites" aria-labelledby="invites-title">
      <h2 id="invites-title" className="admin-section__title">
        {t('admin.accounts.invitations.title')}
      </h2>
      {invitations.isError ? (
        <ErrorAlert error={invitations.error} />
      ) : invitations.isPending ? (
        <span className="skeleton invites__skeleton" aria-hidden="true" />
      ) : pending.length === 0 ? (
        <p className="invites__empty">{t('admin.accounts.invitations.empty')}</p>
      ) : (
        <ul className="invites__list">
          {pending.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} />
          ))}
        </ul>
      )}
    </section>
  )
}
