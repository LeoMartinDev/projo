export const safeRedirect = (target: string | undefined): string =>
  target !== undefined && target.startsWith('/') && !target.startsWith('//') ? target : '/'
