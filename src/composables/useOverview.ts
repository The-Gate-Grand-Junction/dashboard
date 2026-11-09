import { ref } from 'vue';
import { apiFetch } from '@/composables/useApi';
import { useAuthToken } from '@/composables/useAuthToken';
import config from '@/config/dashboard';
import type { LighthouseCheck } from '@/types/report';
import { hasInbox } from '@/lib/submissions';

export interface MonthToDate {
  configured: true;
  current: { visitors: number; pageviews: number; secondsOnPage: number };
  /** The same days of last month. */
  previous: { visitors: number };
  series: { key: string; visitors: number }[];
}

export interface SubmissionSummary {
  counts: { kind: string; status: string; n: number }[];
  /** This calendar month, by kind. */
  thisMonth: Record<string, number>;
  recent: { id: string; kind: string; name: string | null; email: string | null; status: string; createdAt: string }[];
}

export interface WebTeam {
  /** The latest published monthly note. */
  note: { month: string; summary: string; recommendations: string; publishedAt: string | null } | null;
  /** YYYY-MM-DD of the next maintenance day, if one is on the calendar. */
  nextVisit: string | null;
}

export interface PendingCharge {
  id: string;
  amount: number;
  currency: string;
  /** Unix seconds */
  dueDate: number | null;
  /** Alternatives for the same charges share one (metadata.pair_id). */
  pairId?: string | null;
}

/**
 * Everything the overview shows, fetched side by side. Each part loads, fails
 * and renders on its own: a slow Stripe call must not hold up the month's
 * figures, and analytics being down must not hide an unpaid invoice.
 */
export function useOverview() {
  const authToken = useAuthToken();

  const month = ref<MonthToDate | null>(null);
  const monthState = ref<'loading' | 'ready' | 'none'>('loading');
  const charges = ref<PendingCharge[]>([]);
  const chargesLoaded = ref(false);
  const lighthouse = ref<LighthouseCheck | null>(null);
  const healthLoaded = ref(false);
  const submissions = ref<SubmissionSummary | null>(null);
  const submissionsLoaded = ref(!hasInbox());
  const webTeam = ref<WebTeam | null>(null);
  /** 'none' = the Pipeline connection isn't set up, so the card is left out. */
  const webTeamState = ref<'loading' | 'ready' | 'error' | 'none'>('loading');

  async function loadCharges(token: string) {
    if (!config.billing?.enabled) return;
    // Stripe's open invoices plus offline (Zelle/check) invoices sent from the
    // Pipeline Dashboard.
    const [stripe, offline] = await Promise.all([
      apiFetch<any>('/.netlify/functions/stripe-get-billing-summary', { token }).catch(() => null),
      config.billing.showOfflineInvoices
        ? apiFetch<any>('/.netlify/functions/offline-invoices', { token }).catch(() => null)
        : null,
    ]);
    charges.value = [
      ...(stripe?.pendingCharges ?? []),
      ...(offline?.invoices ?? [])
        .filter((inv: any) => inv.status === 'sent' || inv.status === 'overdue')
        .map((inv: any) => ({ ...inv, currency: inv.currency ?? 'usd' })),
    ];
  }

  async function load() {
    let token: string;
    try {
      token = await authToken();
    } catch {
      monthState.value = 'none';
      chargesLoaded.value = true;
      healthLoaded.value = true;
      submissionsLoaded.value = true;
      webTeamState.value = 'error';
      return;
    }

    await Promise.allSettled([
      apiFetch<any>('/.netlify/functions/analytics-proxy?period=mtd', { token })
        .then((d) => {
          month.value = d?.configured ? d : null;
          monthState.value = month.value ? 'ready' : 'none';
        })
        .catch(() => (monthState.value = 'none')),
      loadCharges(token).finally(() => (chargesLoaded.value = true)),
      hasInbox()
        ? apiFetch<any>('/.netlify/functions/form-submissions?summary=1', { token })
            .then((d) => (submissions.value = d?.configured === false ? null : d))
            .catch(() => null)
            .finally(() => (submissionsLoaded.value = true))
        : Promise.resolve(),
      apiFetch<any>('/.netlify/functions/web-team', { token })
        .then((d) => {
          webTeam.value = d?.configured ? d : null;
          webTeamState.value = d?.configured ? 'ready' : 'none';
        })
        .catch(() => (webTeamState.value = 'error')),
      apiFetch<any>('/.netlify/functions/site-health', { token })
        .then((d) => (lighthouse.value = d?.lighthouse ?? null))
        .finally(() => (healthLoaded.value = true)),
    ]);
  }

  return {
    month, monthState, charges, chargesLoaded, lighthouse, healthLoaded, submissions, submissionsLoaded, webTeam, webTeamState, load,
  };
}
