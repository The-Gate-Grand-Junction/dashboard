import config from '@/config/dashboard';

/**
 * Submission kinds come from the dashboard config (OVERVIEW-STANDARD 3.2):
 * each has a singular and plural label, e.g. contact → "inquiry" / "inquiries".
 * Kinds that aren't configured are shown as "Other".
 */
export function kindLabel(kind: string, plural = false): string {
  const found = config.submissionKinds?.find((k) => k.kind === kind);
  const text = found ? (plural ? found.many : found.one) : plural ? 'other messages' : 'other';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether this dashboard has a submissions inbox at all. */
export const hasInbox = () => (config.submissionKinds?.length ?? 0) > 0;
