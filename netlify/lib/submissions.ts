import config from '../../src/config/dashboard';
import { pipeline } from './pipeline';
import { localMidnightUtc, monthBounds, shiftMonth } from './time';

/**
 * The website form inbox, stored in the agency database through the Pipeline
 * (client-form-submissions). Kinds come from config.submissionKinds.
 */

export const inboxEnabled = () => (config.submissionKinds?.length ?? 0) > 0;

/** Which kind a form belongs to, from its slug and title; 'other' when nothing matches. */
export function kindOf(slug: string, title: string): string {
  const text = `${slug} ${title}`.toLowerCase();
  for (const k of config.submissionKinds ?? []) {
    if (k.match && new RegExp(k.match, 'i').test(text)) return k.kind;
  }
  // A site with a single kind (usually contact) files everything there.
  return config.submissionKinds?.length === 1 ? config.submissionKinds[0]!.kind : 'other';
}

/** Counts by kind for a calendar month (client's timezone), and how many of them are still new. */
export async function monthCounts(month: string) {
  const from = localMidnightUtc(monthBounds(month).start);
  const to = localMidnightUtc(monthBounds(shiftMonth(month, 1)).start);
  const { counts } = await pipeline<{ counts: { kind: string; status: string; n: number }[] }>(
    `client-form-submissions?counts=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  const byKind: Record<string, number> = {};
  let stillNew = 0;
  for (const c of counts) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + c.n;
    if (c.status === 'new') stillNew += c.n;
  }
  return { byKind, stillNew };
}
