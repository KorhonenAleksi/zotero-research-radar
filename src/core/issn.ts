/**
 * Normalise an ISSN to "NNNN-NNNC" (C may be X). Returns null if the input is
 * not shaped like an ISSN. Does not check the check digit; see isValidIssn.
 */
export function normalizeIssn(input: string | null | undefined): string | null {
  if (!input) return null;
  const compact = input.toUpperCase().replace(/[^0-9X]/g, "");
  if (!/^\d{7}[\dX]$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** True when the ISSN is well-formed and its check digit is correct. */
export function isValidIssn(input: string | null | undefined): boolean {
  const issn = normalizeIssn(input);
  if (!issn) return false;
  const digits = issn.replace("-", "");
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(digits[i]) * (8 - i);
  const check = (11 - (sum % 11)) % 11;
  const expected = check === 10 ? "X" : String(check);
  return digits[7] === expected;
}
