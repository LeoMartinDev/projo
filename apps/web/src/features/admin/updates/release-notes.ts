export type NotesBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string }

export const parseReleaseNotes = (notes: string): NotesBlock[] =>
  notes
    .replaceAll('\r\n', '\n')
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block): NotesBlock => {
      const lines = block.split('\n')
      if (lines.length === 1 && block.startsWith('## '))
        return { kind: 'heading', text: block.slice(3).trim() }
      if (lines.every((line) => line.startsWith('- ')))
        return { kind: 'list', items: lines.map((line) => line.slice(2).trim()) }
      return { kind: 'paragraph', text: lines.join(' ') }
    })

export type InlinePart =
  { kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'link'; href: string }

export const parseInline = (text: string): InlinePart[] =>
  text
    .split(/(`[^`]+`|https:\/\/[^\s)]+)/u)
    .filter((part) => part !== '')
    .map((part): InlinePart => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1)
        return { kind: 'code', text: part.slice(1, -1) }
      if (part.startsWith('https://')) return { kind: 'link', href: part }
      return { kind: 'text', text: part }
    })
