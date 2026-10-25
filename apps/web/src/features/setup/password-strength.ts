export type PasswordScore = 0 | 1 | 2 | 3 | 4

/**
 * Strength shown under the password (kit `Components`, artboard `OnbAccount`): one point each
 * for length ≥ 8, length ≥ 12 or a symbol, mixed case, a digit. Feedback only: the rule the
 * server enforces is `passwordSchema` (12 characters minimum).
 */
export const passwordScore = (password: string): PasswordScore => {
  if (password.length === 0) return 0
  const points = [
    password.length >= 8,
    password.length >= 12 || /[^A-Za-z0-9]/.test(password),
    /[A-Z]/.test(password) && /[a-z]/.test(password),
    /\d/.test(password),
  ].filter(Boolean).length
  return points as PasswordScore
}
