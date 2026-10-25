import fr from '../../apps/web/src/shared/i18n/fr.json' with { type: 'json' }

/** The UI runs in French (`locale: 'fr-FR'`): every label is read from `fr.json`. */
export { fr }

/** `{{name}}` placeholders of an i18n string. */
export const tr = (template: string, values: Record<string, string | number> = {}): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''))

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Text before the first placeholder: "Reprendre à {{time}}" → /^Reprendre à/. */
export const startsWith = (template: string) =>
  new RegExp(`^${escapeRegExp(template.split('{{')[0] ?? template)}`)

/** The whole string, any value in its placeholders: "{{seen}} fichiers vus" → /.+ fichiers vus/. */
export const matching = (template: string) =>
  new RegExp(
    template
      .split(/\{\{\w+\}\}/)
      .map(escapeRegExp)
      .join('.+'),
  )
