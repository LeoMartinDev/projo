/** The player's own route: nothing reloads nor shows a banner over it. */
export const isPlayerPath = (pathname: string): boolean => pathname.startsWith('/watch/')
