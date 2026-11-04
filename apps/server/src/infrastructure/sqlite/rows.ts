import type { z } from 'zod'

type Simplify<T> = { [K in keyof T]: T[K] } & {}

export type StripNulls<T> = Simplify<
  { [K in keyof T as null extends T[K] ? never : K]: T[K] } & {
    [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>
  }
>

export const stripNulls = <T extends Record<string, unknown>>(row: T): StripNulls<T> =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as StripNulls<T>

export const toNullable = <T>(value: T | undefined): T | null =>
  value === undefined ? null : value

export const toIso = (date: Date): string => date.toISOString()
export const fromIso = (value: string): Date => new Date(value)
export const fromIsoNullable = (value: string | null): Date | undefined =>
  value === null ? undefined : new Date(value)

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

export const chunks = <T>(values: readonly T[], size = 500): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
  return result
}
