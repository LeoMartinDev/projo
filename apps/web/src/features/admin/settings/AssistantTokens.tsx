import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AssistantTokenDto,
  assistantTokenNameSchema,
  type CreatedAssistantToken,
} from '@projo/shared/api/assistants'

import { formatDate, formatDateTime, formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { copyText } from '../../../shared/ui/copy-text.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { AlertIcon, CheckIcon, PlusIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { useNow } from '../../../shared/ui/use-now.ts'
import { isLocalHostname } from '../../account/local-address.ts'
import { CopyIcon, KeyIcon } from '../admin-icons.tsx'
import { claudeCodeCommand, claudeDesktopConfig } from './assistant-config.ts'
import {
  assistantTokensQuery,
  useCreateAssistantToken,
  useRevokeAssistantToken,
} from './queries.ts'

const CopyBlock = ({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline: boolean
}) => {
  const { t } = useTranslation()
  const id = useId()
  const [field, fieldRef] = useElement<HTMLTextAreaElement>()
  const [copied, setCopied] = useState<boolean>()
  return (
    <div className={multiline ? 'assistant-copy assistant-copy--grow' : 'assistant-copy'}>
      <label className="assistant-copy__label" htmlFor={id}>
        {label}
      </label>
      <div className="assistant-copy__box">
        <textarea
          ref={fieldRef}
          id={id}
          className="assistant-copy__value"
          readOnly
          wrap="off"
          rows={multiline ? undefined : 1}
          spellCheck={false}
          value={value}
        />
        <button
          type="button"
          className="icon-button assistant-copy__button"
          aria-label={
            copied === true
              ? t('admin.server.assistants.copied')
              : t('admin.server.assistants.copy')
          }
          title={
            copied === true
              ? t('admin.server.assistants.copied')
              : t('admin.server.assistants.copy')
          }
          onClick={() => {
            void copyText(value, field).then(setCopied)
          }}
        >
          {copied === true ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {copied === false ? (
        <p className="hint hint--error">{t('admin.server.assistants.copyFailed')}</p>
      ) : undefined}
    </div>
  )
}

const AssistantSetup = ({ token }: { token: string }) => {
  const { t } = useTranslation()
  const origin = window.location.origin
  return (
    <>
      <p className="dialog__text">{t('admin.server.assistants.shownOnce')}</p>
      {isLocalHostname(window.location.hostname) ? (
        <p className="alert alert--warning">
          <AlertIcon />
          <span>{t('admin.server.assistants.localWarning')}</span>
        </p>
      ) : undefined}
      <CopyBlock
        label={t('admin.server.assistants.claudeCode')}
        value={claudeCodeCommand({ origin, token })}
        multiline={false}
      />
      <CopyBlock
        label={t('admin.server.assistants.claudeDesktop')}
        value={claudeDesktopConfig({ origin, token })}
        multiline
      />
    </>
  )
}

const AddAssistantDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const id = useId()
  const create = useCreateAssistantToken()
  const [name, setName] = useState('Claude')
  const [created, setCreated] = useState<CreatedAssistantToken>()
  const parsed = assistantTokenNameSchema.safeParse(name)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!parsed.success || create.isPending) return
    create.mutate({ name: parsed.data }, { onSuccess: setCreated })
  }

  return (
    <Dialog
      open
      title={created === undefined ? t('admin.server.assistants.addTitle') : created.assistant.name}
      onClose={onClose}
      footer={
        created === undefined ? (
          <>
            <button type="button" className="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form={`${id}-form`}
              className="button button--primary"
              disabled={!parsed.success || create.isPending}
            >
              {create.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('admin.server.assistants.create')}
            </button>
          </>
        ) : (
          <button type="button" className="button button--primary" onClick={onClose}>
            {t('admin.server.assistants.done')}
          </button>
        )
      }
    >
      <div className="assistant-dialog">
        {created === undefined ? (
          <form id={`${id}-form`} className="assistant-dialog__form" onSubmit={submit} noValidate>
            <Field
              id={`${id}-name`}
              label={t('admin.server.assistants.name')}
              icon={<KeyIcon size={20} />}
              invalid={!parsed.success}
            >
              <input
                id={`${id}-name`}
                className="field__input"
                value={name}
                maxLength={64}
                autoComplete="off"
                autoFocus
                aria-invalid={!parsed.success}
                onChange={(event) => {
                  setName(event.target.value)
                  if (create.isError) create.reset()
                }}
              />
            </Field>
            {create.isError ? <ErrorAlert error={create.error} /> : undefined}
          </form>
        ) : (
          <AssistantSetup token={created.token} />
        )}
      </div>
    </Dialog>
  )
}

const RevokeAssistantDialog = ({
  assistant,
  onClose,
}: {
  assistant: AssistantTokenDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const revoke = useRevokeAssistantToken()
  return (
    <Dialog
      open
      title={t('admin.server.assistants.revokeTitle', { name: assistant.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(assistant.id, { onSuccess: onClose })}
          >
            {revoke.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.server.assistants.revoke')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.server.assistants.revokeText')}</p>
      {revoke.isError ? <ErrorAlert error={revoke.error} /> : undefined}
    </Dialog>
  )
}

const AssistantRow = ({
  assistant,
  onRevoke,
}: {
  assistant: AssistantTokenDto
  onRevoke: () => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  return (
    <div className="adm-tr assistant-tr" role="row">
      <span className="adm-cell" role="cell">
        <span className="adm-strong" title={assistant.name}>
          {assistant.name}
        </span>
        <span className="adm-muted">{t(`admin.server.assistants.kind.${assistant.kind}`)}</span>
      </span>
      <span
        className="adm-muted adm-optional"
        role="cell"
        title={formatDateTime(assistant.createdAt, locale)}
      >
        {formatDate(assistant.createdAt, locale)}
      </span>
      <span
        className="adm-muted"
        role="cell"
        title={
          assistant.lastUsedAt === undefined
            ? undefined
            : formatDateTime(assistant.lastUsedAt, locale)
        }
      >
        {assistant.lastUsedAt === undefined
          ? t('admin.server.assistants.never')
          : formatRelative(assistant.lastUsedAt, locale, now)}
      </span>
      <div className="adm-actions" role="cell">
        <button
          type="button"
          className="button button--glass button--small"
          aria-label={t('admin.server.assistants.revokeNamed', { name: assistant.name })}
          onClick={onRevoke}
        >
          {t('admin.server.assistants.revoke')}
        </button>
      </div>
    </div>
  )
}

export const AssistantTokens = () => {
  const { t } = useTranslation()
  const tokens = useQuery(assistantTokensQuery)
  const [adding, setAdding] = useState(false)
  const [revoking, setRevoking] = useState<AssistantTokenDto>()
  const items = tokens.data?.items ?? []

  return (
    <section className="settings-section" aria-labelledby="server-assistants">
      <div className="assistants__head">
        <h2 id="server-assistants" className="admin-section__title">
          {t('admin.server.assistants.title')}
        </h2>
        <button
          type="button"
          className="button button--glass button--small"
          onClick={() => setAdding(true)}
        >
          <PlusIcon />
          {t('admin.server.assistants.add')}
        </button>
      </div>

      <div
        className="adm-table assistants"
        role="table"
        aria-label={t('admin.server.assistants.title')}
      >
        <div className="adm-tr assistant-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.server.assistants.columns.name')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.server.assistants.columns.created')}
          </span>
          <span role="columnheader">{t('admin.server.assistants.columns.lastUsed')}</span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {tokens.isPending
            ? [0, 1].map((index) => (
                <div key={index} className="adm-tr adm-tr--skeleton" aria-hidden="true">
                  <span className="skeleton skeleton--line" />
                </div>
              ))
            : undefined}
          {tokens.isError && items.length === 0 ? (
            <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
          ) : undefined}
          {tokens.isSuccess && items.length === 0 ? (
            <EmptyState title={t('admin.server.assistants.empty')} />
          ) : undefined}
          {items.map((assistant) => (
            <AssistantRow
              key={assistant.id}
              assistant={assistant}
              onRevoke={() => setRevoking(assistant)}
            />
          ))}
        </div>
      </div>

      {adding ? <AddAssistantDialog onClose={() => setAdding(false)} /> : undefined}
      {revoking === undefined ? undefined : (
        <RevokeAssistantDialog
          key={revoking.id}
          assistant={revoking}
          onClose={() => setRevoking(undefined)}
        />
      )}
    </section>
  )
}
