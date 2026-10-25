import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AssignBody, TmdbSearchResult } from '@projo/shared/api/metadata'

import { toApiFailure } from '../../../shared/api/failure.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { CheckIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { SearchIcon } from '../admin-icons.tsx'
import { tmdbPosterUrl, tmdbSearchQuery } from './queries.ts'
import './identify.css'

/**
 * What the admin says the file is (§7.8): "it's a movie", "it's an episode of…" (series +
 * season + episode), or, to re-identify a whole series, another series.
 */
export type IdentifyMode = 'movie' | 'episode' | 'series'

export type IdentifyInitial = {
  mode: IdentifyMode
  query: string
  year?: number
  season?: number
  episode?: number
}

const parseYear = (value: string): number | undefined => {
  const year = Number(value)
  return /^\d{4}$/u.test(value.trim()) && year >= 1870 && year <= 2200 ? year : undefined
}

const parseNumber = (value: string): number | undefined =>
  /^\d{1,5}$/u.test(value.trim()) ? Number(value) : undefined

const useDebounced = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** Proxied poster; the initial on a tile when there is none or it does not load. */
const Poster = ({ result }: { result: TmdbSearchResult }) => {
  const [failed, setFailed] = useState(false)
  return result.posterPath === undefined || failed ? (
    <span className="identify__poster identify__poster--empty" aria-hidden="true">
      {(result.title.trim()[0] ?? '?').toLocaleUpperCase()}
    </span>
  ) : (
    <img
      className="identify__poster"
      src={tmdbPosterUrl(result.posterPath)}
      alt=""
      loading="lazy"
      decoding="async"
      width={46}
      height={69}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * TMDB search with posters and year, and the assignment it leads to. The submit button lives
 * outside (dialog footer), tied by `formId`. Fills the height it is given: only the result list
 * scrolls (AGENTS.md, stable size).
 */
export const IdentifyForm = ({
  formId,
  modes,
  initial,
  error,
  onSelect,
  onSubmit,
}: {
  formId: string
  modes: readonly IdentifyMode[]
  initial: IdentifyInitial
  error?: unknown
  /** Whether a TMDB result is picked (the submit button is enabled only then). */
  onSelect: (picked: boolean) => void
  onSubmit: (body: AssignBody) => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const [mode, setMode] = useState<IdentifyMode>(initial.mode)
  const [text, setText] = useState(initial.query)
  const [yearText, setYearText] = useState(initial.year === undefined ? '' : String(initial.year))
  const [seasonText, setSeasonText] = useState(
    initial.season === undefined ? '' : String(initial.season),
  )
  const [episodeText, setEpisodeText] = useState(
    initial.episode === undefined ? '' : String(initial.episode),
  )
  const [selected, setSelectedState] = useState<number>()
  const setSelected = (tmdbId: number | undefined) => {
    setSelectedState(tmdbId)
    onSelect(tmdbId !== undefined)
  }

  const query = useDebounced(text.trim(), 350)
  const year = parseYear(useDebounced(yearText, 350))
  const searchKind = mode === 'movie' ? 'movie' : 'series'
  const search = useQuery(tmdbSearchQuery(searchKind, query, year))
  const results = search.data?.items ?? []
  const picked = results.find((result) => result.tmdbId === selected)

  const pickMode = (next: IdentifyMode) => {
    setMode(next)
    setSelected(undefined)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (picked === undefined) return
    if (mode === 'movie') return onSubmit({ kind: 'movie', tmdbId: picked.tmdbId })
    if (mode === 'series') return onSubmit({ kind: 'series', tmdbId: picked.tmdbId })
    const seasonNumber = parseNumber(seasonText)
    const episodeNumber = parseNumber(episodeText)
    onSubmit({
      kind: 'episode',
      seriesTmdbId: picked.tmdbId,
      ...(seasonNumber === undefined ? {} : { seasonNumber }),
      ...(episodeNumber === undefined ? {} : { episodeNumber }),
    })
  }

  const keyMissing =
    search.isError && toApiFailure(search.error).code === 'metadata/tmdb_key_missing'

  return (
    <form id={formId} className="identify" onSubmit={submit} noValidate>
      {modes.length > 1 ? (
        <div
          className={modes.length === 3 ? 'seg seg--3 identify__modes' : 'seg identify__modes'}
          role="radiogroup"
          aria-label={t('admin.identify.modeLabel')}
          data-active={modes.indexOf(mode)}
        >
          <span className="seg__indicator" aria-hidden="true" />
          {modes.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="seg__option"
              aria-checked={mode === value}
              onClick={() => pickMode(value)}
            >
              {t(`admin.identify.mode.${value}`)}
            </button>
          ))}
        </div>
      ) : undefined}

      <div className="identify__search">
        <Field
          id={`${ids}-query`}
          label={
            mode === 'movie' ? t('admin.identify.movieTitle') : t('admin.identify.seriesTitle')
          }
          icon={<SearchIcon size={20} />}
        >
          <input
            id={`${ids}-query`}
            className="field__input"
            type="search"
            value={text}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value)
              setSelected(undefined)
            }}
          />
        </Field>
        <Field id={`${ids}-year`} label={t('admin.identify.year')}>
          <input
            id={`${ids}-year`}
            className="field__input"
            inputMode="numeric"
            maxLength={4}
            value={yearText}
            onChange={(event) => {
              setYearText(event.target.value.replace(/\D/gu, ''))
              setSelected(undefined)
            }}
          />
        </Field>
      </div>

      <div className="identify__results well" aria-busy={search.isFetching}>
        {query.length === 0 ? (
          <p className="identify__state">{t('admin.identify.prompt')}</p>
        ) : search.isError ? (
          <div className="identify__state identify__state--error">
            <ErrorAlert error={search.error} />
            {keyMissing ? (
              <Link to="/admin/settings" className="button button--glass button--small">
                {t('admin.identify.openSettings')}
              </Link>
            ) : undefined}
          </div>
        ) : search.isPending ? (
          <ul className="identify__list" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="identify__row identify__row--skeleton">
                <span className="skeleton identify__poster" />
                <span className="skeleton skeleton--line identify__skeleton-text" />
              </li>
            ))}
          </ul>
        ) : results.length === 0 ? (
          <p className="identify__state">{t('admin.identify.noResults')}</p>
        ) : (
          <ul className="identify__list" role="radiogroup" aria-label={t('admin.identify.results')}>
            {results.map((result) => (
              <li key={result.tmdbId}>
                <button
                  type="button"
                  role="radio"
                  className="identify__row"
                  aria-checked={selected === result.tmdbId}
                  onClick={() => setSelected(result.tmdbId)}
                >
                  <Poster result={result} />
                  <span className="identify__text">
                    <span className="identify__title">{result.title}</span>
                    <span className="identify__meta">
                      {[
                        result.year,
                        result.originalTitle !== undefined && result.originalTitle !== result.title
                          ? result.originalTitle
                          : undefined,
                      ]
                        .filter((part) => part !== undefined)
                        .join(' · ')}
                    </span>
                    {result.overview === undefined ? undefined : (
                      <span className="identify__overview">{result.overview}</span>
                    )}
                  </span>
                  <span className="identify__check" aria-hidden="true">
                    <CheckIcon size={13} stroke={3} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mode === 'episode' ? (
        <div className="identify__episode">
          <Field id={`${ids}-season`} label={t('admin.identify.season')}>
            <input
              id={`${ids}-season`}
              className="field__input"
              inputMode="numeric"
              maxLength={5}
              value={seasonText}
              onChange={(event) => setSeasonText(event.target.value.replace(/\D/gu, ''))}
            />
          </Field>
          <Field id={`${ids}-episode`} label={t('admin.identify.episode')}>
            <input
              id={`${ids}-episode`}
              className="field__input"
              inputMode="numeric"
              maxLength={5}
              value={episodeText}
              onChange={(event) => setEpisodeText(event.target.value.replace(/\D/gu, ''))}
            />
          </Field>
        </div>
      ) : undefined}

      {error === undefined ? undefined : <ErrorAlert error={error} />}
    </form>
  )
}

/** The submit button of an `IdentifyForm`, for a dialog footer. */
export const IdentifySubmit = ({
  formId,
  pending,
  ready,
}: {
  formId: string
  pending: boolean
  ready: boolean
}) => {
  const { t } = useTranslation()
  return (
    <button
      type="submit"
      form={formId}
      className="button button--primary"
      disabled={pending || !ready}
    >
      {pending ? <span className="spinner" aria-hidden="true" /> : undefined}
      {t('admin.identify.assign')}
    </button>
  )
}
