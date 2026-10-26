const CEP_PATTERN = /^(\d{5})-?(\d{3})$/;

/** Returns the 8-digit CEP, or null when the input is not a valid CEP. */
export function normalizeCep(input: string): string | null {
  const match = CEP_PATTERN.exec(input);
  return match ? `${match[1]}${match[2]}` : null;
}
