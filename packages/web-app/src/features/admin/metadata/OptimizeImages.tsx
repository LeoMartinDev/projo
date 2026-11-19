import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { CheckIcon, SyncIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { useOptimizeImages } from './queries.ts'
import './editing.css'

const queuedMs = 4000

const QueueJobButton = ({
  job,
  label,
  queuedLabel,
  ariaLabel,
  className,
  disabled = false,
  onClick,
}: {
  job: { isPending: boolean; isSuccess: boolean; error: unknown; reset: () => void }
  label: string
  queuedLabel: string
  ariaLabel?: string
  className: string
  disabled?: boolean
  onClick: () => void
}) => {
  const { isSuccess, reset } = job
  useEffect(() => {
    if (!isSuccess) return
    const timer = setTimeout(reset, queuedMs)
    return () => clearTimeout(timer)
  }, [isSuccess, reset])
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || job.isPending || isSuccess}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        onClick={onClick}
      >
        {job.isPending ? (
          <span className="spinner" aria-hidden="true" />
        ) : isSuccess ? (
          <CheckIcon size={16} />
        ) : (
          <SyncIcon />
        )}
        {isSuccess ? queuedLabel : label}
      </button>
      {job.error ? <ErrorAlert error={job.error} /> : undefined}
    </>
  )
}

export const OptimizeImagesSetting = () => {
  const { t } = useTranslation()
  const optimize = useOptimizeImages()
  return (
    <div className="settings-block optimize-images">
      <QueueJobButton
        job={optimize}
        label={t('admin.imageOptimize.action')}
        queuedLabel={t('admin.imageOptimize.queued')}
        className="button button--glass"
        onClick={() => optimize.mutate()}
      />
    </div>
  )
}
