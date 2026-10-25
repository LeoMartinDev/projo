export const catalogErrorCodes = ['catalog/invalid_cursor', 'catalog/image_not_found'] as const

export type CatalogErrorCode = (typeof catalogErrorCodes)[number]
