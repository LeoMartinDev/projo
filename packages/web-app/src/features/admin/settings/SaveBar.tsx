import { useTranslation } from 'react-i18next'

import { useErrorMessage } from '../../../shared/i18n/errors.ts'
import type { Draft } from './settings-draft.ts'
import type { SettingsForm } from './use-settings-form.ts'
import './settings.css'

/**
 * The save bar of a Settings tab (§15): while its edits differ from the saved values, it sticks to
 * the bottom of the window, in the page's flow, so it never covers the end of the tab.
 */
export const SaveBar = <D extends Draft>({ form }: { form: SettingsForm<D> }) => {
  const { t } = useTranslation()
  const message = useErrorMessage()
  if (!form.dirty) return undefined
  return (
    <div className="save-bar" role="region" aria-label={t('admin.saveBar.unsaved')}>
      {form.error === undefined ? (
        <span className="save-bar__text">{t('admin.saveBar.unsaved')}</span>
      ) : (
        <span className="save-bar__text save-bar__text--error" role="alert">
          {message(form.error)}
        </span>
      )}
      <div className="save-bar__actions">
        <button type="button" className="button" disabled={form.pending} onClick={form.cancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={form.invalid.length > 0 || form.pending}
          onClick={form.save}
        >
          {form.pending ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
