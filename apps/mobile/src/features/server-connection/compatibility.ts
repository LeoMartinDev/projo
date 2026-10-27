/**
 * Oldest projo server this app works with (§26.4). Raised whenever the app starts relying on
 * something a server added; an older server gets the blocking "Update your projo server" screen.
 * 1.5.0: sign-in returning a bearer token and device pairing (M6 slice 1).
 * 1.6.0: "Continue watching" frames as stills of their own (`resumeFrame.url`, §13.3).
 */
export const minimumServerVersion = '1.6.0'
