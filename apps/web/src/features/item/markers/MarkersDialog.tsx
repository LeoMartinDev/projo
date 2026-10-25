import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  ApplyToSeasonResponse,
  ItemSegmentsDto,
  PutSegmentBody,
  SegmentLookupDto,
  SegmentTypeDto,
} from '@projo/shared/api/segments'

import { api, request } from '../../../shared/api/client.ts'
import { formatDateTime, formatPercent } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { TrashIcon } from '../../../shared/ui/media-icons.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import {
  type CheckedDraft,
  checkDraft,
  type Draft,
  draftOf,
  hasManualMarkers,
  isDirty,
  type MarkerState,
  markerStateOf,
  segmentTypes,
  spanGeometry,
  timelineLengthOf,
} from './markers.ts'
import { segmentsQueryKey, segmentsQuery } from './queries.ts'
import { formatTimecode } from './timecode.ts'
import './markers.css'

type Drafts = Partial<Record<SegmentTypeDto, Draft>>

/** The segments drawn over the duration: the drafts being typed, else the stored markers. */
const Timeline = ({
  spans,
  lengthMs,
}: {
  spans: readonly { type: SegmentTypeDto; startMs: number; endMs: number }[]
  lengthMs: number | undefined
}) => {
  const { t } = useTranslation()
  return (
    <div className="markers__timeline">
      <div className="markers__bar" role="img" aria-label={t('item.markers.timeline')}>
        {lengthMs === undefined
          ? undefined
          : spans.map((span) => {
              const { left, width } = spanGeometry(span, lengthMs)
              return (
                <span
                  key={span.type}
                  className={`markers__span markers__span--${span.type}`}
                  style={{ left: `${left}%`, width: `max(${width}%, 3px)` }}
                  title={`${t(`item.markers.types.${span.type}`)} · ${formatTimecode(span.startMs)} – ${formatTimecode(span.endMs)}`}
                />
              )
            })}
      </div>
      <div className="markers__scale" aria-hidden="true">
        <span>0:00</span>
        <span>{lengthMs === undefined ? '' : formatTimecode(lengthMs)}</span>
      </div>
    </div>
  )
}

/** What the chain asked (admin diagnosis, §12.2): one chip per source. */
const Lookups = ({ lookups }: { lookups: readonly SegmentLookupDto[] }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  if (lookups.length === 0) return undefined
  return (
    <div className="markers__lookups">
      <span className="markers__lookups-label">{t('item.markers.lookups')}</span>
      <ul className="markers__lookup-list">
        {lookups.map((lookup) => (
          <li
            key={lookup.source}
            className="markers__lookup"
            data-outcome={lookup.outcome}
            title={formatDateTime(lookup.checkedAt, locale)}
          >
            {t(`item.markers.sources.${lookup.source}`)} ·{' '}
            {t(`item.markers.outcomes.${lookup.outcome}`)}
          </li>
        ))}
      </ul>
    </div>
  )
}

const Origin = ({ state }: { state: MarkerState }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  if (state.kind !== 'segment') return <span className="markers__origin">—</span>
  const { origin, confidence } = state.segment
  const label = t(`item.markers.sources.${origin}`)
  return (
    <span className="markers__origin" data-origin={origin}>
      {confidence === undefined || origin === 'manual'
        ? label
        : t('item.markers.withConfidence', {
            origin: label,
            confidence: formatPercent(confidence, locale),
          })}
    </span>
  )
}

const MarkerRow = ({
  type,
  state,
  draft,
  checked,
  busy,
  onDraft,
  onAbsent,
  onRemove,
}: {
  type: SegmentTypeDto
  state: MarkerState
  draft: Draft
  checked: CheckedDraft
  busy: boolean
  onDraft: (draft: Draft) => void
  onAbsent: (absent: boolean) => void
  onRemove: () => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const typeLabel = t(`item.markers.types.${type}`)
  const absent = state.kind === 'absent'
  const error = checked.ok || checked.error === 'incomplete' ? undefined : checked.error
  const startInvalid = error === 'start_invalid'
  const endInvalid = error !== undefined && error !== 'start_invalid'
  return (
    <div className="markers__row" data-absent={absent}>
      <div className="markers__type">
        <span className={`markers__swatch markers__span--${type}`} aria-hidden="true" />
        <span className="markers__type-text">
          <span id={`${id}-type`} className="markers__type-label">
            {typeLabel}
          </span>
          {error === undefined ? (
            <Origin state={state} />
          ) : (
            <span id={`${id}-error`} className="markers__error" role="alert">
              {t(`item.markers.errors.${error}`)}
            </span>
          )}
        </span>
      </div>
      {(['start', 'end'] as const).map((edge) => (
        <Field
          key={edge}
          id={`${id}-${edge}`}
          label={t(edge === 'start' ? 'item.markers.startOf' : 'item.markers.endOf', {
            type: typeLabel,
          })}
          compact
          invalid={edge === 'start' ? startInvalid : endInvalid}
        >
          <input
            id={`${id}-${edge}`}
            className="field__input mono markers__input"
            value={absent ? '' : draft[edge]}
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            disabled={absent}
            aria-invalid={edge === 'start' ? startInvalid : endInvalid}
            {...(error === undefined ? {} : { 'aria-describedby': `${id}-error` })}
            onChange={(event) => onDraft({ ...draft, [edge]: event.target.value })}
          />
        </Field>
      ))}
      <div className="markers__actions">
        <button
          type="button"
          className="button button--glass button--small markers__absent"
          aria-pressed={absent}
          disabled={busy}
          onClick={() => onAbsent(!absent)}
        >
          {t(`item.markers.absent.${type}`)}
        </button>
        <button
          type="button"
          className="icon-button markers__remove"
          aria-label={t('item.markers.remove', { type: typeLabel })}
          title={t('item.markers.remove', { type: typeLabel })}
          disabled={busy || state.kind !== 'segment'}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

const ApplyToSeasonDialog = ({
  itemId,
  open,
  onClose,
}: {
  itemId: string
  open: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const apply = useMutation({
    mutationFn: (): Promise<ApplyToSeasonResponse> =>
      request(() =>
        api.admin.items[':id'].segments['apply-to-season'].$post({
          param: { id: itemId },
          json: {},
        }),
      ),
    // The other episodes of the season changed.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog', 'segments'] }),
  })
  const close = () => {
    onClose()
    apply.reset()
  }
  return (
    <Dialog
      open={open}
      title={t('item.markers.applyTitle')}
      onClose={close}
      footer={
        apply.isSuccess ? (
          <button type="button" className="button button--primary" onClick={close}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={close}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('item.markers.apply')}
            </button>
          </>
        )
      }
    >
      {apply.isSuccess ? (
        <p className="dialog__text" role="status">
          {t('item.markers.appliedUpdated', { count: apply.data.updated })}
          {apply.data.skipped > 0
            ? ` · ${t('item.markers.appliedSkipped', { count: apply.data.skipped })}`
            : ''}
        </p>
      ) : (
        <p className="dialog__text">{t('item.markers.applyText')}</p>
      )}
      {apply.isError ? <ErrorAlert error={apply.error} /> : undefined}
    </Dialog>
  )
}

type RowAction = { type: SegmentTypeDto; action: 'absent' | 'present' | 'remove' }

/**
 * "Markers" (§12.5, admin ⋮ menu of a movie or an episode): per type, two time fields, the
 * origin, "Pas d'intro" (negative marker) and delete; the timeline previews the drafts.
 * "Enregistrer" stores the edited rows as manual markers; an episode can copy its manual markers
 * onto its season.
 */
export const MarkersDialog = ({
  itemId,
  name,
  episode,
  durationMs: fallbackDurationMs,
  open,
  onClose,
}: {
  itemId: string
  /** Episode code (`S1 · E3`), in the title. */
  name?: string
  episode: boolean
  durationMs?: number
  open: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const segments = useQuery({ ...segmentsQuery(itemId), enabled: open })
  const [drafts, setDrafts] = useState<Drafts>({})
  const [confirmApply, setConfirmApply] = useState(false)

  const store = (dto: ItemSegmentsDto, type: SegmentTypeDto) => {
    queryClient.setQueryData(segmentsQueryKey(itemId), dto)
    setDrafts((current) => {
      const { [type]: _saved, ...rest } = current
      return rest
    })
  }

  const paramOf = (type: SegmentTypeDto) => ({ id: itemId, type })

  const put = (type: SegmentTypeDto, json: PutSegmentBody) =>
    request(() => api.admin.items[':id'].segments[':type'].$put({ param: paramOf(type), json }))

  const save = useMutation({
    mutationFn: async (
      rows: readonly { type: SegmentTypeDto; startMs: number; endMs: number }[],
    ) => {
      for (const { type, startMs, endMs } of rows) store(await put(type, { startMs, endMs }), type)
    },
  })

  const rowAction = useMutation({
    mutationFn: ({ type, action }: RowAction) =>
      action === 'absent'
        ? put(type, { absent: true })
        : request(() => api.admin.items[':id'].segments[':type'].$delete({ param: paramOf(type) })),
    onSuccess: (dto, { type }) => store(dto, type),
  })

  const close = () => {
    onClose()
    setDrafts({})
    save.reset()
    rowAction.reset()
  }

  const dto = segments.data
  const durationMs = dto?.durationMs ?? fallbackDurationMs
  const rows = segmentTypes.map((type) => {
    const state: MarkerState = dto === undefined ? { kind: 'empty' } : markerStateOf(dto, type)
    const draft = drafts[type] ?? draftOf(state)
    const checked = checkDraft(draft, durationMs)
    return {
      type,
      state,
      draft,
      checked,
      dirty: state.kind !== 'absent' && isDirty(state, checked),
    }
  })
  const spans = rows.flatMap(({ type, state, checked }) =>
    checked.ok
      ? [{ type, startMs: checked.startMs, endMs: checked.endMs }]
      : state.kind === 'segment'
        ? [{ type, startMs: state.segment.startMs, endMs: state.segment.endMs }]
        : [],
  )
  const dirty = rows.flatMap((row) =>
    row.dirty && row.checked.ok
      ? [{ type: row.type, startMs: row.checked.startMs, endMs: row.checked.endMs }]
      : [],
  )
  const invalid = rows.some((row) => !row.checked.ok && row.checked.error !== 'incomplete')
  const busy = save.isPending || rowAction.isPending
  const error = save.error ?? rowAction.error

  return (
    <>
      <Dialog
        open={open}
        title={name === undefined ? t('item.markers.title') : t('item.markers.titleOf', { name })}
        onClose={close}
        fill
        footer={
          <>
            {episode ? (
              <button
                type="button"
                className="button markers__season"
                disabled={dto === undefined || !hasManualMarkers(dto) || dirty.length > 0 || busy}
                onClick={() => setConfirmApply(true)}
              >
                {t('item.markers.applyToSeason')}
              </button>
            ) : undefined}
            <button type="button" className="button" onClick={close}>
              {t('common.close')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={dirty.length === 0 || invalid || busy}
              onClick={() => save.mutate(dirty)}
            >
              {save.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('common.save')}
            </button>
          </>
        }
      >
        <div className="markers">
          {segments.isError ? (
            <ErrorState error={segments.error} onRetry={() => void segments.refetch()} />
          ) : (
            <>
              <Timeline spans={spans} lengthMs={timelineLengthOf(durationMs, spans)} />
              <div className="markers__table" aria-busy={segments.isPending}>
                <div className="markers__row markers__row--head" aria-hidden="true">
                  <span>{t('item.markers.type')}</span>
                  <span>{t('item.markers.start')}</span>
                  <span>{t('item.markers.end')}</span>
                  <span />
                </div>
                {rows.map((row) => (
                  <MarkerRow
                    key={row.type}
                    type={row.type}
                    state={row.state}
                    draft={row.draft}
                    checked={row.checked}
                    busy={busy || dto === undefined}
                    onDraft={(draft) => setDrafts((current) => ({ ...current, [row.type]: draft }))}
                    onAbsent={(absent) =>
                      rowAction.mutate({ type: row.type, action: absent ? 'absent' : 'present' })
                    }
                    onRemove={() => rowAction.mutate({ type: row.type, action: 'remove' })}
                  />
                ))}
              </div>
              {error ? <ErrorAlert error={error} /> : undefined}
              <Lookups lookups={dto?.lookups ?? []} />
            </>
          )}
        </div>
      </Dialog>
      {/* A sibling, not a child: React would bubble its close and cancel events to this dialog. */}
      {episode ? (
        <ApplyToSeasonDialog
          itemId={itemId}
          open={confirmApply}
          onClose={() => setConfirmApply(false)}
        />
      ) : undefined}
    </>
  )
}
