import { requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';

/**
 * Offline invoices — the ones billed from the Pipeline Dashboard and paid by
 * Zelle or check, which never touch Stripe. Without these the Billing page
 * shows only Stripe history and looks like the client stopped paying.
 *
 * Read through the Pipeline's get-offline-invoices endpoint with this client's
 * dashboard key. The Pipeline checks the key against PIPELINE_CLIENT_ID and
 * refuses any other client, so this dashboard holds no database credential at
 * all. (It used to read Turso directly; a Turso token is per-database, so even
 * a read-only one could see every client's billing.)
 *
 * Env:
 *   PIPELINE_FUNCTIONS_URL  https://<pipeline>/.netlify/functions
 *   PIPELINE_DASHBOARD_KEY  this client's key (pkd_…), issued on its ClientDetail page
 *   PIPELINE_CLIENT_ID      this client's row id in the Pipeline database
 *
 * Unconfigured, it returns an empty list rather than an error, so Billing keeps
 * working on Stripe data alone.
 */

export interface OfflineInvoice {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  description: string | null;
  created: number;
  dueDate: number | null;
  paidAt: number | null;
  status: string;
  paymentMethod: string | null;
  source: 'offline';
}

/** Drafts aren't sent yet and cancelled ones aren't owed; neither belongs on Billing. */
const HIDDEN_STATUSES = new Set(['draft', 'cancelled']);
const MAX_INVOICES = 24;

const toEpoch = (value: unknown): number | null => {
  if (!value) return null;
  // The Pipeline stores ISO-ish strings ("2026-08-11" or "2026-08-11 14:02:00").
  const ms = Date.parse(String(value).replace(' ', 'T'));
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

const normalize = (row: Record<string, any>): OfflineInvoice => ({
  id: String(row.id ?? row.invoiceNumber ?? row.invoice_number),
  number: row.invoice_number ?? row.invoiceNumber ?? null,
  // Cents, same as Stripe.
  amount: Number(row.amount ?? 0),
  currency: 'usd',
  description: row.product_description ?? row.productDescription ?? null,
  created: toEpoch(row.created_at ?? row.createdAt) ?? 0,
  dueDate: toEpoch(row.due_date ?? row.dueDate),
  paidAt: toEpoch(row.paid_date ?? row.paidDate),
  status: String(row.status ?? 'sent'),
  paymentMethod: row.payment_method ?? row.paymentMethod ?? null,
  source: 'offline',
});

async function fromPipeline(clientId: string) {
  const data = await pipeline<{ invoices?: Record<string, any>[] }>(
    `get-offline-invoices?clientId=${encodeURIComponent(clientId)}`,
  );
  return (data.invoices || [])
    .filter(row => !HIDDEN_STATUSES.has(String(row.status)))
    .map(normalize)
    .sort((a, b) => (b.paidAt ?? b.dueDate ?? b.created) - (a.paidAt ?? a.dueDate ?? a.created))
    .slice(0, MAX_INVOICES);
}

export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;

  const clientId = process.env.PIPELINE_CLIENT_ID;

  if (!pipelineConfigured() || !clientId) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, invoices: [], configured: false }),
    };
  }

  try {
    const invoices = await fromPipeline(clientId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, invoices, configured: true }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Offline invoice lookup failed:', message);
    return {
      statusCode: 502,
      body: JSON.stringify({ success: false, error: 'Could not load offline invoices' }),
    };
  }
}
