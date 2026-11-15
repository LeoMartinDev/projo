/**
 * A pairing code as typed (`abc 234`, `ABC-234`) in the form the server issued it (`ABC234`):
 * upper case, without spaces or dashes. The server judges whether it is one.
 */
export const normalizePairingCode = (input: string): string =>
  input.toUpperCase().replace(/[\s\-‐-―]/g, '')
