import fr from '../../packages/i18n/fr.json' with { type: 'json' }

export { fr }

export const tr = (template: string, values: Record<string, string | number> = {}): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''))

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const startsWith = (template: string) =>
  new RegExp(`^${escapeRegExp(template.split('{{')[0] ?? template)}`)

export const matching = (template: string) =>
  new RegExp(
    template
      .split(/\{\{\w+\}\}/)
      .map(escapeRegExp)
      .join('.+'),
  )
