/** Generates identifiers: UUID v7 strings (time-sortable), §6. */
export type IdGenerator = {
  next: () => string
}
