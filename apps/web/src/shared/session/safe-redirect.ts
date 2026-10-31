/** Only same-app paths are followed after signing in or choosing a profile (no open redirect). */
export const safeRedirect = (target: string | undefined): string =>
  target !== undefined && target.startsWith('/') && !target.startsWith('//') ? target : '/'
