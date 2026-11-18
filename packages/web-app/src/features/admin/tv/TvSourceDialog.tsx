import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminTvChannelDto, AdminTvGroupDto, AdminTvSourceDto } from '@projo/shared/api/tv'

import { formatNumber } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog.tsx'
import { Field, Switch } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { BackIcon, CheckIcon, ChevronRightIcon } from '../../../shared/ui/icons.tsx'
import { Segmented } from '../../../shared/ui/Segmented.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { SearchIcon } from '../admin-icons.tsx'
import {
  tvChannelsQuery,
  tvGuideChannelsQuery,
  tvLogoUrl,
  tvSourceQuery,
  useDeleteTvSource,
  useRefreshTvSource,
  useSetTvChannelEnabled,
  useSetTvChannelGuideChannel,
  useSetTvGroupEnabled,
  useUpdateTvSource,
} from './queries.ts'
import {
  invalidSourceFields,
  isEmptyPatch,
  type SourceForm,
  sourceFormOf,
  toPatchBody,
} from './source-form.ts'
import { SourceFields } from './SourceFields.tsx'

const tabs = ['channels', 'settings'] as const
type Tab = (typeof tabs)[number]

/** How far below the end of a list the next page starts loading. */
const aheadPx = 400

const useDebounced = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

const SkeletonList = () => (
  <div aria-hidden="true">
    {[0, 1, 2, 3, 4, 5].map((index) => (
      <div key={index} className="tv-row tv-row--skeleton">
        <span className="skeleton skeleton--line" />
      </div>
    ))}
  </div>
)

const Count = ({ enabled, total }: { enabled: number; total: number }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <span className="tv-row__count">
      {t('admin.tv.enabledOf', {
        enabled: formatNumber(enabled, locale),
        total: formatNumber(total, locale),
      })}
    </span>
  )
}

const groupName = (t: TFunction, group: AdminTvGroupDto): string =>
  group.name === '' ? t('admin.tv.otherChannels') : group.name

const GroupRow = ({
  sourceId,
  group,
  onOpen,
  onError,
}: {
  sourceId: string
  group: AdminTvGroupDto
  onOpen: () => void
  onError: (error: unknown) => void
}) => {
  const { t } = useTranslation()
  const labelId = useId()
  const toggle = useSetTvGroupEnabled(sourceId)
  const name = groupName(t, group)
  return (
    <li className="tv-row">
      <Switch
        checked={toggle.isPending ? toggle.variables.enabled : group.enabled}
        labelId={labelId}
        disabled={toggle.isPending}
        onChange={(enabled) => toggle.mutate({ groupId: group.id, enabled }, { onError })}
      />
      <button
        type="button"
        className="tv-row__open"
        aria-label={t('admin.tv.openGroup', { name })}
        onClick={onOpen}
      >
        <span id={labelId} className="tv-row__name">
          {name}
        </span>
      </button>
      <Count enabled={group.enabledChannelCount} total={group.channelCount} />
      <span className="tv-row__chevron" aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </li>
  )
}

/** The guide channel a channel's programmes come from, as its row shows it (§29.6). */
const guideLabel = (t: TFunction, channel: AdminTvChannelDto): string => {
  const { guideChannel, guideMatched } = channel
  if (guideChannel !== undefined) {
    const name = guideChannel.name ?? guideChannel.id
    return guideChannel.manual ? `${name} · ${t('admin.tv.guideManual')}` : name
  }
  return guideMatched === false ? t('admin.tv.guideNone') : t('admin.tv.guideAutomatic')
}

/**
 * Picks a channel's guide channel (§29.6): "Automatic", then the guide channels of the source's
 * last read, searched and paged as they scroll; a choice is saved at once.
 */
const GuideChannelPicker = ({
  sourceId,
  channel,
  onClose,
}: {
  sourceId: string
  channel: AdminTvChannelDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const searchId = useId()
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 300)
  const [scroller, scrollerRef] = useElement<HTMLDivElement>()
  const [sentinel, sentinelRef] = useElement<HTMLSpanElement>()
  const list = useInfiniteQuery(tvGuideChannelsQuery(sourceId, q))
  const choose = useSetTvChannelGuideChannel(sourceId)
  const current = channel.guideChannel?.manual === true ? channel.guideChannel.id : ''
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list

  useEffect(() => {
    if (sentinel === undefined || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
      },
      {
        ...(scroller === undefined ? {} : { root: scroller }),
        rootMargin: `0px 0px ${aheadPx}px 0px`,
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel, scroller, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const pick = (guideChannel: string) => {
    if (guideChannel === current) return onClose()
    choose.mutate({ channelId: channel.id, guideChannel }, { onSuccess: onClose })
  }
  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  const option = (value: string, label: string, detail?: string) => (
    <li key={value === '' ? '\u0000' : value} className="tv-row">
      <button
        type="button"
        className="tv-row__open tv-guide__option"
        aria-pressed={value === current}
        disabled={choose.isPending}
        onClick={() => pick(value)}
      >
        <span className="tv-row__name">{label}</span>
        {detail === undefined ? undefined : <span className="tv-guide__id">{detail}</span>}
      </button>
      <span className="tv-guide__check" aria-hidden="true">
        {value === current ? <CheckIcon /> : undefined}
      </span>
    </li>
  )
  return (
    <Dialog
      open
      fill
      title={t('admin.tv.guideChannelOf', { name: channel.name })}
      onClose={onClose}
      footer={
        <button type="button" className="button" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="tv-pane">
        <Field
          id={searchId}
          label={t('admin.tv.guideSearch')}
          compact
          icon={<SearchIcon size={16} />}
        >
          <input
            id={searchId}
            className="field__input"
            type="search"
            value={text}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('admin.tv.guideSearch')}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {choose.isError ? <ErrorAlert error={choose.error} /> : undefined}
        <div ref={scrollerRef} className="tv-pane__scroll">
          <ul className="tv-list">
            {q === '' ? option('', t('admin.tv.guideAutomatic')) : undefined}
            {items.map((item) => option(item.id, item.names[0] ?? item.id, item.id))}
          </ul>
          {list.isPending ? (
            <SkeletonList />
          ) : list.isError && list.data === undefined ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : items.length === 0 && q !== '' ? (
            <EmptyState title={t('admin.tv.guideNoMatch')} />
          ) : undefined}
          <span ref={sentinelRef} className="tv-list__end">
            {isFetchingNextPage ? <span className="spinner" aria-hidden="true" /> : undefined}
          </span>
        </div>
      </div>
    </Dialog>
  )
}

const ChannelRow = ({
  sourceId,
  channel,
  onError,
}: {
  sourceId: string
  channel: AdminTvChannelDto
  onError: (error: unknown) => void
}) => {
  const { t } = useTranslation()
  const labelId = useId()
  const toggle = useSetTvChannelEnabled(sourceId)
  const [picking, setPicking] = useState(false)
  const guide = guideLabel(t, channel)
  return (
    <li className="tv-row">
      <Switch
        checked={toggle.isPending ? toggle.variables.enabled : channel.enabled}
        labelId={labelId}
        disabled={toggle.isPending}
        onChange={(enabled) => toggle.mutate({ channelId: channel.id, enabled }, { onError })}
      />
      <span className="tv-row__logo" aria-hidden="true">
        {channel.hasLogo ? (
          <img src={tvLogoUrl(channel.id)} alt="" loading="lazy" decoding="async" />
        ) : undefined}
      </span>
      <span className="tv-row__number">{channel.number ?? ''}</span>
      <span id={labelId} className="tv-row__name">
        {channel.name}
      </span>
      <button
        type="button"
        className={`tv-row__guide${channel.guideMatched === false && channel.guideChannel === undefined ? ' tv-row__guide--none' : ''}`}
        aria-label={`${t('admin.tv.guideChannel')} · ${channel.name} · ${guide}`}
        title={guide}
        onClick={() => setPicking(true)}
      >
        {guide}
      </button>
      {picking ? (
        <GuideChannelPicker
          sourceId={sourceId}
          channel={channel}
          onClose={() => setPicking(false)}
        />
      ) : undefined}
    </li>
  )
}

const ChannelList = ({
  sourceId,
  filter,
  scroller,
  onError,
}: {
  sourceId: string
  filter: { q: string } | { groupId: string }
  scroller: HTMLElement | undefined
  onError: (error: unknown) => void
}) => {
  const { t } = useTranslation()
  const channels = useInfiniteQuery(tvChannelsQuery(sourceId, filter))
  const [sentinel, sentinelRef] = useElement<HTMLSpanElement>()
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = channels

  useEffect(() => {
    if (sentinel === undefined || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
      },
      {
        ...(scroller === undefined ? {} : { root: scroller }),
        rootMargin: `0px 0px ${aheadPx}px 0px`,
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel, scroller, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  if (channels.isPending) return <SkeletonList />
  if (channels.isError && channels.data === undefined)
    return <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
  const items = channels.data.pages.flatMap((page) => page.items)
  if (items.length === 0)
    return <EmptyState title={'q' in filter ? t('admin.tv.noMatch') : t('admin.tv.noChannels')} />
  return (
    <>
      <ul className="tv-list">
        {items.map((channel) => (
          <ChannelRow key={channel.id} sourceId={sourceId} channel={channel} onError={onError} />
        ))}
      </ul>
      <span ref={sentinelRef} className="tv-list__end">
        {isFetchingNextPage ? <span className="spinner" aria-hidden="true" /> : undefined}
      </span>
      {isFetchNextPageError ? (
        <button
          type="button"
          className="button button--glass button--small tv-list__retry"
          onClick={() => void fetchNextPage()}
        >
          {t('common.retry')}
        </button>
      ) : undefined}
    </>
  )
}

const ChannelsTab = ({ source }: { source: AdminTvSourceDto }) => {
  const { t } = useTranslation()
  const searchId = useId()
  const detail = useQuery(tvSourceQuery(source.id))
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 300)
  const [groupId, setGroupId] = useState<string>()
  const [failure, setFailure] = useState<{ view: string; error: unknown }>()
  const [scroller, scrollerRef] = useElement<HTMLDivElement>()
  const groups = detail.data?.groups ?? []
  const group = groups.find((candidate) => candidate.id === groupId)
  const searching = text.trim() !== ''
  const view = searching ? `q:${q}` : (group?.id ?? '')
  const onError = (error: unknown) => setFailure({ view, error })

  useEffect(() => {
    scroller?.scrollTo({ top: 0 })
  }, [scroller, view])

  return (
    <div className="tv-pane">
      <Field id={searchId} label={t('admin.tv.search')} compact icon={<SearchIcon size={16} />}>
        <input
          id={searchId}
          className="field__input"
          type="search"
          value={text}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('admin.tv.search')}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      {!searching && group !== undefined ? (
        <div className="tv-pane__group">
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.back')}
            onClick={() => setGroupId(undefined)}
          >
            <BackIcon />
          </button>
          <span className="tv-pane__group-name">{groupName(t, group)}</span>
          <Count enabled={group.enabledChannelCount} total={group.channelCount} />
        </div>
      ) : undefined}
      {failure === undefined || failure.view !== view ? undefined : (
        <ErrorAlert error={failure.error} />
      )}
      <div ref={scrollerRef} className="tv-pane__scroll">
        {searching ? (
          q === '' ? (
            <SkeletonList />
          ) : (
            <ChannelList
              key={view}
              sourceId={source.id}
              filter={{ q }}
              scroller={scroller}
              onError={onError}
            />
          )
        ) : group !== undefined ? (
          <ChannelList
            key={view}
            sourceId={source.id}
            filter={{ groupId: group.id }}
            scroller={scroller}
            onError={onError}
          />
        ) : detail.isPending ? (
          <SkeletonList />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState title={t('admin.tv.noChannels')} />
        ) : (
          <ul className="tv-list" aria-label={t('admin.tv.groups')}>
            {groups.map((candidate) => (
              <GroupRow
                key={candidate.id}
                sourceId={source.id}
                group={candidate}
                onOpen={() => setGroupId(candidate.id)}
                onError={onError}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const DeleteSourceDialog = ({
  source,
  onClose,
  onDeleted,
}: {
  source: AdminTvSourceDto
  onClose: () => void
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const remove = useDeleteTvSource(source.id)
  return (
    <ConfirmDialog
      title={t('admin.tv.deleteTitle', { name: source.name })}
      text={t('admin.tv.deleteText')}
      confirmLabel={t('admin.tv.delete')}
      tone="danger"
      pending={remove.isPending}
      {...(remove.isError ? { error: remove.error } : {})}
      onConfirm={() => remove.mutate(undefined, { onSuccess: onDeleted })}
      onClose={onClose}
    />
  )
}

/**
 * A source's dialog (§29.6): its groups and channels, and its settings, as two tabs of a fixed
 * height. Both tabs stay mounted, so the search and an unsaved form survive a switch.
 */
export const TvSourceDialog = ({
  source,
  onClose,
}: {
  source: AdminTvSourceDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const formId = useId()
  const [tab, setTab] = useState<Tab>('channels')
  const [deleting, setDeleting] = useState(false)
  const refresh = useRefreshTvSource(source.id)
  const update = useUpdateTvSource(source.id)
  const [form, setForm] = useState<SourceForm>(() => sourceFormOf(source))
  const [submitted, setSubmitted] = useState(false)
  const invalid = invalidSourceFields(form, { creating: false })
  const patch = toPatchBody(source, form)
  const refreshing = source.state === 'refreshing' || refresh.isPending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (invalid.size > 0 || update.isPending || isEmptyPatch(patch)) return
    update.mutate(patch, {
      onSuccess: (saved) => {
        setForm(sourceFormOf(saved))
        setSubmitted(false)
      },
    })
  }

  return (
    <>
      <Dialog
        open
        fill
        title={source.name}
        onClose={onClose}
        footer={
          tab === 'channels' ? (
            <button type="button" className="button" onClick={onClose}>
              {t('common.close')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button--danger tv-dialog__delete"
                onClick={() => setDeleting(true)}
              >
                {t('admin.tv.delete')}
              </button>
              <button
                type="button"
                className="button"
                disabled={refreshing}
                onClick={() => refresh.mutate()}
              >
                {refreshing ? <span className="spinner" aria-hidden="true" /> : undefined}
                {t('admin.tv.refresh')}
              </button>
              <button
                type="submit"
                form={formId}
                className="button button--primary"
                disabled={update.isPending || isEmptyPatch(patch)}
              >
                {update.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
                {t('common.save')}
              </button>
            </>
          )
        }
      >
        <div className="tv-dialog">
          <Segmented
            role="tab"
            className="tv-dialog__tabs"
            label={source.name}
            options={tabs.map((value) => ({ value, label: t(`admin.tv.tabs.${value}`) }))}
            value={tab}
            onChange={setTab}
          />
          <div className="tv-dialog__panel" role="tabpanel" hidden={tab !== 'channels'}>
            <ChannelsTab source={source} />
          </div>
          <div className="tv-dialog__panel" role="tabpanel" hidden={tab !== 'settings'}>
            <div className="tv-pane__scroll">
              <form id={formId} className="tv-form" onSubmit={submit} noValidate>
                <SourceFields
                  idPrefix={formId}
                  form={form}
                  stored={source}
                  invalid={submitted ? invalid : new Set()}
                  onChange={(change) => {
                    setForm((current) => ({ ...current, ...change }))
                    if (update.isError) update.reset()
                  }}
                />
                {update.isError ? <ErrorAlert error={update.error} /> : undefined}
                {refresh.isError ? <ErrorAlert error={refresh.error} /> : undefined}
              </form>
            </div>
          </div>
        </div>
      </Dialog>
      {deleting ? (
        <DeleteSourceDialog
          source={source}
          onClose={() => setDeleting(false)}
          onDeleted={onClose}
        />
      ) : undefined}
    </>
  )
}
