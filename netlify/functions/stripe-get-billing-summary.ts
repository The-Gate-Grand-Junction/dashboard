import Stripe from 'stripe';
import { requireUser } from '../lib/auth';

interface BillingSummary {
  subscription: {
    id: string;
    status: string;
    planName: string;
    amount: number;
    currency: string;
    interval: string;
    nextBillingDate: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  pendingCharges: Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    description: string | null;
    created: number;
    dueDate: number | null;
    hostedInvoiceUrl: string | null;
    /**
     * Set when the Pipeline issued this invoice as one of several
     * alternatives for the same charges (metadata.pair_id): options, not
     * separate bills. Paying one voids the ones it makes redundant.
     */
    pairId: string | null;
    /** What the invoice covers, so the page can show more than a number. */
    lineItems: Array<{ description: string | null; amount: number }>;
  }>;
  recentPayments: Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    description: string | null;
    created: number;
    paidAt: number | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
    /** Marked paid outside Stripe (cash, check, Zelle). */
    paidOffline: boolean;
  }>;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  /** Credit on the Stripe balance, in cents (0 when none). Stripe applies it to the next invoice. */
  creditBalance: number;
}

export async function handler(event: { queryStringParameters: Record<string, string> | null; headers: Record<string, string> }) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;

  // The customer is fixed server-side. Taking it from the request let anyone
  // read (and with the portal, control) any customer in the Stripe account.
  const customerId = process.env.STRIPE_CUSTOMER_ID;
  if (!customerId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'STRIPE_CUSTOMER_ID is not set' }) };
  }

  const stripeConfig = process.env.STRIPE_CONFIG;
  if (!stripeConfig) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const { secretKey } = JSON.parse(stripeConfig);
    const stripe = new Stripe(secretKey);

    // Fetch customer with default payment method expanded
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });

    if (customer.deleted) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
    }

    // Fetch active subscriptions (expand limited to 3 levels)
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 1,
      expand: ['data.default_payment_method'],
    });

    let subscription: BillingSummary['subscription'] = null;
    const sub = subscriptions.data[0];
    if (sub) {
      const item = sub.items.data[0];
      // Fetch product name separately to avoid deep expand
      let productName = 'Subscription';
      if (item?.price?.product) {
        const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
        try {
          const product = await stripe.products.retrieve(productId);
          productName = product.name;
        } catch { /* fallback to default */ }
      }

      subscription = {
        id: sub.id,
        status: sub.status,
        planName: productName,
        amount: item?.price?.unit_amount || 0,
        currency: item?.price?.currency || 'usd',
        interval: item?.price?.recurring?.interval || 'month',
        // current_period_end moved from the subscription to its items in newer
        // Stripe API versions, so read both. A cancelled one never bills again.
        nextBillingDate:
          sub.status === 'canceled' ? null : ((item as any)?.current_period_end ?? (sub as any).current_period_end ?? null),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    }

    // Fetch open invoices (pending charges)
    const openInvoices = await stripe.invoices.list({
      customer: customerId,
      status: 'open',
      limit: 10,
    });

    const pendingCharges: BillingSummary['pendingCharges'] = openInvoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_due,
      currency: inv.currency,
      description: inv.description || inv.lines?.data?.[0]?.description || null,
      created: inv.created,
      dueDate: inv.due_date,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      pairId: inv.metadata?.pair_id || null,
      lineItems: (inv.lines?.data ?? []).map((l) => ({ description: l.description, amount: l.amount })),
    }));

    // Paid invoices from the primary customer plus any legacy records. The
    // client's billing moved to a new Stripe customer, so their earlier
    // payments live on the old one; STRIPE_LEGACY_CUSTOMER_IDS (comma
    // separated) folds that history in. Read-only: the subscription, payment
    // method and portal all stay on the primary customer.
    const legacyIds = (process.env.STRIPE_LEGACY_CUSTOMER_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id && id !== customerId);

    const paidInvoiceSets = await Promise.all(
      [customerId, ...legacyIds].map(id =>
        stripe.invoices
          // How each was settled: by card, or by a payment recorded by hand
          .list({ customer: id, status: 'paid', limit: 10, expand: ['data.payments'] })
          .catch(err => {
            console.warn(`Could not read invoices for ${id}:`, err instanceof Error ? err.message : err);
            return { data: [] as Stripe.Invoice[] };
          })
      )
    );

    const paidInvoices = {
      data: paidInvoiceSets
        .flatMap(set => set.data)
        .sort((a, b) => b.created - a.created)
        .slice(0, 10),
    };

    // Marked paid outside Stripe (cash, check, Zelle): settled by a payment
    // record rather than a card. Older API versions say paid_out_of_band.
    const paidOffline = (inv: Stripe.Invoice) => {
      if ((inv as any).paid_out_of_band) return true;
      const payments = ((inv as any).payments?.data ?? []) as Array<{ status?: string; payment?: { type?: string } }>;
      const byCard = payments.some((p) => p.status === 'paid' && p.payment?.type === 'payment_intent');
      const byRecord = payments.some((p) => p.status === 'paid' && p.payment?.type === 'payment_record');
      return byRecord && !byCard;
    };

    const recentPayments: BillingSummary['recentPayments'] = paidInvoices.data
      // A $0 invoice (a trial period) isn't a payment
      .filter((inv) => inv.amount_due > 0 || inv.amount_paid > 0)
      // Closed as paid for bookkeeping only (e.g. a failed charge paid on
      // another invoice): metadata hideFromClient = "true" keeps it off the list
      .filter((inv) => inv.metadata?.hideFromClient !== 'true')
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        // Stripe records $0 paid on an invoice paid outside it; show what it was for
        amount: paidOffline(inv) ? inv.amount_due : inv.amount_paid,
        currency: inv.currency,
        description: inv.description || inv.lines?.data?.[0]?.description || null,
        created: inv.created,
        paidAt: inv.status_transitions?.paid_at ?? null,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        invoicePdf: inv.invoice_pdf ?? null,
        paidOffline: paidOffline(inv),
      }));

    // Default payment method
    let paymentMethod: BillingSummary['paymentMethod'] = null;
    const defaultPM = customer.invoice_settings?.default_payment_method;
    if (defaultPM && typeof defaultPM === 'object' && 'card' in defaultPM && defaultPM.card) {
      paymentMethod = {
        brand: defaultPM.card.brand || 'unknown',
        last4: defaultPM.card.last4 || '****',
        expMonth: defaultPM.card.exp_month || 0,
        expYear: defaultPM.card.exp_year || 0,
      };
    }

    const summary: BillingSummary = {
      subscription,
      pendingCharges,
      recentPayments,
      paymentMethod,
      // Stripe keeps credit as a negative balance
      creditBalance: typeof customer.balance === 'number' && customer.balance < 0 ? -customer.balance : 0,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, ...summary }),
    };
  } catch (err) {
    // Stripe's message stays in the log; the client gets plain words
    console.error('Billing summary error:', err instanceof Error ? err.message : err);
    return { statusCode: 502, body: JSON.stringify({ error: 'Billing details are unavailable just now.' }) };
  }
}
