export function normalizeEmail(email: string): string {
  // Trim and case-fold, nothing more: no `+`-alias stripping, no Gmail dot
  // folding. The attestation should be literal.
  return email.trim().toLowerCase();
}
