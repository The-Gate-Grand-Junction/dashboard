/**
 * A US phone number as (970) 555-0142.
 *
 * Forms store whatever was typed, so the same number arrives as 9705550142,
 * 970-555-0142 or +1 970 555 0142. Ten digits, or eleven starting with the
 * country code 1, are shown in one readable form; anything else (an
 * extension, a foreign number, a typo) is left exactly as typed rather than
 * guessed at. Display only: the stored value is never changed.
 */
export function formatPhone(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!/^[\d\s()+.-]+$/.test(text)) return text;
  let digits = text.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return text;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
