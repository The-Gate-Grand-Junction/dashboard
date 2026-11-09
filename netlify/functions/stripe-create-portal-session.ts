import Stripe from 'stripe';
import { requireUser } from '../lib/auth';

interface RequestBody {
  returnUrl?: string;
}

/** Back to this dashboard only: the portal must not bounce the client to someone else's page. */
function safeReturnUrl(requested: string | undefined): string {
  const site = process.env.URL || 'http://localhost:8888';
  const fallback = `${site}/billing`;
  if (!requested) return fallback;
  try {
    const url = new URL(requested);
    const allowed = [site, process.env.DEPLOY_PRIME_URL].filter(Boolean).map((o) => new URL(o as string).origin);
    return allowed.includes(url.origin) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export async function handler(event: { body: string | null; headers: Record<string, string> }) {
  const auth = await requireUser(event);
  if ('statusCode' in auth) return auth;

  const stripeConfig = process.env.STRIPE_CONFIG;
  if (!stripeConfig) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const { secretKey } = JSON.parse(stripeConfig);
    const stripe = new Stripe(secretKey);
    const { returnUrl } = (JSON.parse(event.body || '{}') || {}) as RequestBody;

    // Server-side only: a portal session grants control of the customer's
    // billing, so the caller never gets to name the customer.
    const customerId = process.env.STRIPE_CUSTOMER_ID;
    if (!customerId) {
      return { statusCode: 500, body: JSON.stringify({ error: 'STRIPE_CUSTOMER_ID is not set' }) };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: safeReturnUrl(returnUrl),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, url: session.url }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Portal session error:', message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
