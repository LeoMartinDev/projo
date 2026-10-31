import type { z } from 'zod'

// The only place where SQLite NULL meets the codebase: convert at the repository boundary.

type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** Nullable columns become optional properties (compatible with `exactOptionalPropertyTypes`). */
export type StripNulls<T> = Simplify<
  { [K in keyof T as null extends T[K] ? never : K]: T[K] } & {
    [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>
  }
>

/** Row read from Drizzle → object without `null` values. Shallow. */
export const stripNulls = <T extends Record<string, unknown>>(row: T): StripNulls<T> =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as StripNulls<T>

/** `undefined` → `NULL` for inserts/updates (Drizzle ignores `undefined` in `set`). */
export const toNullable = <T>(value: T | undefined): T | null =>
  value === undefined ? null : value

/** Single value read from SQLite → `undefined` instead of `null`. */
export const fromNullable = <T>(value: T | null): T | undefined =>
  value === null ? undefined : value

export const toIso = (date: Date): string => date.toISOString()
export const fromIso = (value: string): Date => new Date(value)
export const fromIsoNullable = (value: string | null): Date | undefined =>
  value === null ? undefined : new Date(value)

/**
 * Validates a `json` column (§6). A row that does not match its schema is corrupted data:
 * it is a bug, so this throws instead of returning a Result.
 */
export const parseJsonColumn = <S extends z.ZodType>(
  schema: S,
  value: unknown,
  column: string,
): z.infer<S> => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`invalid JSON in column ${column}: ${parsed.error.message}`)
  }
  return parsed.data
}

/** Chunked `IN (…)`: SQLite caps bound parameters, and short lists keep the plans simple. */
export const chunks = <T>(values: readonly T[], size = 500): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
  return result
}
