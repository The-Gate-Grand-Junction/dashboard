<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAuthToken } from '@/composables/useAuthToken';
import { apiFetch } from '@/composables/useApi';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  CreditCard,
  Clock,
  Receipt,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-vue-next';
import config from '@/config/dashboard';

const authToken = useAuthToken();

const billing = config.billing;
const loading = ref(true);
const error = ref<string | null>(null);

interface Subscription {
  id: string;
  status: string;
  planName: string;
  amount: number;
  currency: string;
  interval: string;
  nextBillingDate: number | null;
  cancelAtPeriodEnd: boolean;
}

interface Invoice {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  description: string | null;
  created: number;
  dueDate?: number | null;
  paidAt?: number | null;
  hostedInvoiceUrl: string | null;
  invoicePdf?: string | null;
  /** Paid outside Stripe (Zelle/check), billed from the Pipeline Dashboard */
  paymentMethod?: string | null;
  source?: 'stripe' | 'offline';
  /** Offline rows carry their own status: sent | paid | overdue | cancelled */
  status?: string;
  /** Pending charges: invoices sharing a pairId are alternative ways to pay the same charges */
  pairId?: string | null;
  lineItems?: Array<{ description: string | null; amount: number }>;
  /** Recent payments: a Stripe invoice marked paid outside Stripe (cash, check, Zelle) */
  paidOffline?: boolean;
}

interface PaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

const subscription = ref<Subscription | null>(null);
const pendingCharges = ref<Invoice[]>([]);
const recentPayments = ref<Invoice[]>([]);
const paymentMethod = ref<PaymentMethod | null>(null);
/** Credit on the Stripe balance, in cents; Stripe takes it off the next invoice. */
const creditBalance = ref(0);
const portalLoading = ref(false);
const offlineError = ref<string | null>(null);

function formatCurrency(amount: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function capitalizeFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function fetchBillingSummary() {
  loading.value = true;
  error.value = null;

  try {
    const token = await authToken();
    // Stripe plus the invoices billed from the Pipeline Dashboard and paid by
    // Zelle/check. For a client who pays offline, leaving these out makes the
    // page look like payments had stopped.
    const [data, offline] = await Promise.all([
      apiFetch<any>('/.netlify/functions/stripe-get-billing-summary', { token }),
      apiFetch<any>('/.netlify/functions/offline-invoices', { token }).catch(err => {
        // Stripe data still renders; say so rather than quietly dropping history.
        offlineError.value = 'Could not load invoices paid by Zelle or check.';
        console.error('Offline invoices unavailable:', err);
        return null;
      }),
    ]);
    if (!data.success) throw new Error(data.error || 'Unknown error');

    const offlineInvoices: Invoice[] = (offline?.invoices || []).map((inv: any) => ({
      ...inv,
      hostedInvoiceUrl: null,
      source: 'offline' as const,
    }));
    const newestFirst = (a: Invoice, b: Invoice) =>
      (b.paidAt || b.created) - (a.paidAt || a.created);

    subscription.value = data.subscription;
    paymentMethod.value = data.paymentMethod;
    creditBalance.value = data.creditBalance || 0;

    pendingCharges.value = [
      ...(data.pendingCharges || []),
      ...offlineInvoices.filter(inv => inv.status === 'sent' || inv.status === 'overdue'),
    ].sort(newestFirst);

    recentPayments.value = [
      ...(data.recentPayments || []),
      ...offlineInvoices.filter(inv => inv.status === 'paid'),
    ].sort(newestFirst);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load billing data';
  } finally {
    loading.value = false;
  }
}

/**
 * Pending charges grouped for display. Invoices sharing a pairId (issued that
 * way by the Pipeline) are alternative ways to pay the same charges, so they
 * show as ONE amount due: the invoice covering everything (the largest) is the
 * main action, the partial ones quiet "pay separately" links. A pair with one
 * open invoice left is just a normal charge.
 */
const pendingChargeGroups = computed(() => {
  const members = new Map<string, Invoice[]>();
  for (const charge of pendingCharges.value) {
    const key = charge.pairId || charge.id;
    members.set(key, [...(members.get(key) ?? []), charge]);
  }
  return [...members].map(([key, charges]) => {
    const [primary, ...alternatives] = [...charges].sort((a, b) => b.amount - a.amount);
    return { key, primary: primary!, alternatives };
  });
});

/** What an invoice is for, in words: Pipeline-issued invoices often leave the description empty. */
function chargeLabel(charge: Invoice) {
  return charge.description || charge.lineItems?.[0]?.description || charge.number || 'Invoice';
}

/** The subscription's next invoice once the credit is taken off; null when it doesn't apply. */
const nextChargeAfterCredit = computed(() => {
  const sub = subscription.value;
  if (!creditBalance.value || !sub || sub.status !== 'active' || !sub.nextBillingDate) return null;
  return Math.max(0, sub.amount - creditBalance.value);
});

function paidLabel(payment: Invoice) {
  if (payment.paymentMethod) return `Paid · ${capitalizeFirst(payment.paymentMethod)}`;
  return payment.paidOffline ? 'Paid offline' : 'Paid';
}

async function openPortal() {
  portalLoading.value = true;
  try {
    const token = await authToken();
    const data = await apiFetch<any>('/.netlify/functions/stripe-create-portal-session', {
      method: 'POST',
      token,
      body: JSON.stringify({ returnUrl: window.location.href }),
    });

    if (data.success && data.url) {
      window.open(data.url, '_blank');
    } else {
      throw new Error(data.error || 'Could not create portal session');
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to open billing portal';
  } finally {
    portalLoading.value = false;
  }
}

onMounted(fetchBillingSummary);
</script>

<template>
  <DashboardLayout page-title="Billing">
    <!-- Not configured -->
    <div v-if="!billing?.enabled" class="billing-placeholder">
      <CreditCard :size="48" class="billing-placeholder__icon" />
      <h2>Billing Not Configured</h2>
      <p>Billing has not been set up for this dashboard yet. Contact your web administrator for assistance.</p>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="billing-loading">
      <Loader2 :size="32" class="billing-loading__spinner" />
      <p>Loading billing information...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="billing-error">
      <AlertCircle :size="20" />
      <span>{{ error }}</span>
      <button class="billing-btn billing-btn--secondary" @click="fetchBillingSummary">
        <RefreshCw :size="16" />
        Retry
      </button>
    </div>

    <!-- Billing Content -->
    <div v-else class="billing-grid">
      <!-- Subscription Card -->
      <div class="billing-card">
        <div class="billing-card__header">
          <CreditCard :size="20" />
          <h3>Subscription</h3>
        </div>

        <div v-if="subscription" class="billing-card__body">
          <div class="billing-detail">
            <span class="billing-detail__label">Plan</span>
            <span class="billing-detail__value">{{ subscription.planName }}</span>
          </div>
          <div class="billing-detail">
            <span class="billing-detail__label">Status</span>
            <span class="billing-badge" :class="`billing-badge--${subscription.status}`">
              <CheckCircle v-if="subscription.status === 'active'" :size="14" />
              <AlertCircle v-else-if="subscription.status === 'past_due'" :size="14" />
              <XCircle v-else-if="subscription.status === 'canceled'" :size="14" />
              {{ capitalizeFirst(subscription.status.replace('_', ' ')) }}
            </span>
          </div>
          <div class="billing-detail">
            <span class="billing-detail__label">Amount</span>
            <span class="billing-detail__value">
              {{ formatCurrency(subscription.amount, subscription.currency) }}/{{ subscription.interval }}
            </span>
          </div>
          <div v-if="subscription.nextBillingDate" class="billing-detail">
            <span class="billing-detail__label">Next Billing</span>
            <span class="billing-detail__value">{{ formatDate(subscription.nextBillingDate) }}</span>
          </div>
          <div v-if="nextChargeAfterCredit !== null" class="billing-detail">
            <span class="billing-detail__label">After your credit</span>
            <span class="billing-detail__value billing-detail__value--credit">
              {{ formatCurrency(nextChargeAfterCredit, subscription.currency) }}
            </span>
          </div>
          <div v-if="subscription.cancelAtPeriodEnd" class="billing-notice billing-notice--warning">
            Subscription will cancel at end of current period
          </div>

          <button class="billing-btn billing-btn--primary" :disabled="portalLoading" @click="openPortal">
            <Loader2 v-if="portalLoading" :size="16" class="billing-loading__spinner" />
            <ExternalLink v-else :size="16" />
            Manage Subscription
          </button>
        </div>

        <div v-else class="billing-card__empty">
          <p>No active subscription</p>
        </div>
      </div>

      <!-- Pending Charges Card -->
      <div v-if="billing.showPendingCharges" class="billing-card">
        <div class="billing-card__header">
          <Clock :size="20" />
          <h3>Pending Charges</h3>
        </div>

        <!-- Credit first: money in their favour, before anything they owe -->
        <div v-if="creditBalance > 0" class="billing-credit" role="note">
          <div class="billing-credit__row">
            <span class="billing-credit__label">Credit on account</span>
            <span class="billing-credit__amount">{{ formatCurrency(creditBalance) }}</span>
          </div>
          <p v-if="subscription && nextChargeAfterCredit !== null && subscription.nextBillingDate" class="billing-credit__note">
            Applied automatically to your next invoice on {{ formatDate(subscription.nextBillingDate) }},
            which drops from {{ formatCurrency(subscription.amount, subscription.currency) }}
            to {{ formatCurrency(nextChargeAfterCredit, subscription.currency) }}.
          </p>
          <p v-else class="billing-credit__note">Applied automatically to your next invoice.</p>
        </div>

        <div v-if="pendingCharges.length > 0" class="billing-card__body">
          <div v-for="group in pendingChargeGroups" :key="group.key" class="billing-due">
            <div class="billing-due__total">
              <span class="billing-due__label">
                {{ (group.primary.lineItems?.length ?? 0) > 1 ? 'Total due' : chargeLabel(group.primary) }}
              </span>
              <span class="billing-due__amount">{{ formatCurrency(group.primary.amount, group.primary.currency) }}</span>
            </div>

            <!-- Breakdown only when the invoice covers more than one thing -->
            <ul v-if="(group.primary.lineItems?.length ?? 0) > 1" class="billing-due__lines">
              <li v-for="(line, i) in group.primary.lineItems" :key="i">
                <span>{{ line.description || 'Item' }}</span>
                <span>{{ formatCurrency(line.amount, group.primary.currency) }}</span>
              </li>
            </ul>

            <span class="billing-invoice-row__date">
              {{ group.primary.dueDate ? `Due ${formatDate(group.primary.dueDate)}` : formatDate(group.primary.created) }}
            </span>

            <a
              v-if="group.primary.hostedInvoiceUrl"
              :href="group.primary.hostedInvoiceUrl"
              target="_blank"
              rel="noopener"
              class="billing-btn billing-btn--primary billing-btn--full"
            >
              Pay {{ formatCurrency(group.primary.amount, group.primary.currency) }}
              <ExternalLink :size="14" aria-hidden="true" />
              <span class="sr-only">(opens in a new tab)</span>
            </a>

            <!-- Paired invoices: the same charges, payable one item at a time -->
            <div v-if="group.alternatives.length > 0" class="billing-due__alt">
              <p>Prefer to pay one item at a time? Use a link below instead; you'll only be billed for what's left.</p>
              <template v-for="alt in group.alternatives" :key="alt.id">
                <a v-if="alt.hostedInvoiceUrl" :href="alt.hostedInvoiceUrl" target="_blank" rel="noopener" class="billing-due__alt-link">
                  Pay only {{ chargeLabel(alt) }}: {{ formatCurrency(alt.amount, alt.currency) }}
                  <ExternalLink :size="12" aria-hidden="true" />
                  <span class="sr-only">(opens in a new tab)</span>
                </a>
              </template>
            </div>
          </div>
        </div>

        <div v-else class="billing-card__empty">
          <p>No pending charges</p>
        </div>
      </div>

      <!-- Recent Payments Card -->
      <div class="billing-card">
        <div class="billing-card__header">
          <Receipt :size="20" />
          <h3>Recent Payments</h3>
        </div>

        <div v-if="recentPayments.length > 0" class="billing-card__body">
          <div v-for="payment in recentPayments" :key="payment.id" class="billing-invoice-row">
            <div class="billing-invoice-row__info">
              <span class="billing-invoice-row__amount">{{ formatCurrency(payment.amount, payment.currency) }}</span>
              <span class="billing-invoice-row__desc">{{ payment.description || payment.number || 'Payment' }}</span>
              <span class="billing-invoice-row__date">
                {{ payment.paidAt ? formatDate(payment.paidAt) : formatDate(payment.created) }}
              </span>
            </div>
            <div class="billing-invoice-row__actions">
              <span class="billing-badge billing-badge--active">{{ paidLabel(payment) }}</span>
              <a
                v-if="payment.invoicePdf"
                :href="payment.invoicePdf"
                target="_blank"
                rel="noopener"
                class="billing-icon-btn"
                title="Download PDF"
              >
                <Receipt :size="16" />
              </a>
            </div>
          </div>

          <button class="billing-btn billing-btn--secondary billing-btn--full" @click="openPortal">
            <ExternalLink :size="16" />
            View All Invoices
          </button>
        </div>

        <div v-else class="billing-card__empty">
          <p>No payments yet</p>
        </div>

        <p v-if="offlineError" class="billing-offline-error" role="alert">
          {{ offlineError }}
        </p>
      </div>

      <!-- Payment Method Card -->
      <div class="billing-card">
        <div class="billing-card__header">
          <CreditCard :size="20" />
          <h3>Payment Method</h3>
        </div>

        <div v-if="paymentMethod" class="billing-card__body">
          <div class="billing-payment-method">
            <div class="billing-payment-method__card">
              <CreditCard :size="24" />
              <div>
                <span class="billing-payment-method__brand">{{ capitalizeFirst(paymentMethod.brand) }}</span>
                <span class="billing-payment-method__number">&bull;&bull;&bull;&bull; {{ paymentMethod.last4 }}</span>
              </div>
            </div>
            <span class="billing-payment-method__exp">
              Expires {{ String(paymentMethod.expMonth).padStart(2, '0') }}/{{ paymentMethod.expYear }}
            </span>
          </div>

          <button class="billing-btn billing-btn--secondary" @click="openPortal">
            <ExternalLink :size="16" />
            Update Payment Method
          </button>
        </div>

        <div v-else class="billing-card__empty">
          <p>No payment method on file</p>
          <button class="billing-btn billing-btn--primary" @click="openPortal">
            <CreditCard :size="16" />
            Add Payment Method
          </button>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.billing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 1.25rem;
}

.billing-card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.billing-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.billing-card__header h3 {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.billing-card__body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.billing-offline-error {
  margin: 0.75rem 1.25rem 1rem;
  font-size: 0.8125rem;
  color: var(--color-danger);
}

.billing-card__empty {
  padding: 2rem 1.25rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.billing-card__empty p {
  margin: 0;
}

/* Pending charges: each block is one amount due. A paired set collapses
   into one block (one total, one button, quiet pay-separately links) so the
   card never reads as a stack of separate bills. */
.billing-due {
  display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem;
  border-radius: var(--border-radius); background-color: var(--color-bg);
}
.billing-due__total { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
.billing-due__label { font-size: 0.875rem; color: var(--color-text); }
.billing-due__amount { font-size: 1.25rem; font-weight: 600; color: var(--color-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.billing-due__lines {
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem;
  font-size: 0.8125rem; color: var(--color-text-secondary);
}
.billing-due__lines li { display: flex; justify-content: space-between; gap: 1rem; font-variant-numeric: tabular-nums; }
.billing-due__lines li span:last-child { white-space: nowrap; }
.billing-due__alt {
  display: flex; flex-direction: column; gap: 0.375rem; margin-top: 0.25rem; padding-top: 0.75rem;
  border-top: 1px solid var(--color-border); font-size: 0.8125rem; color: var(--color-text-secondary);
}
.billing-due__alt p { margin: 0; line-height: 1.5; }
.billing-due__alt-link { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--color-link, var(--color-primary)); font-weight: 500; text-decoration: none; }
.billing-due__alt-link:hover { text-decoration: underline; }

/* Credit on account: green like the Paid badge, since it's in their favour */
.billing-credit {
  margin: 1.25rem 1.25rem 0; padding: 0.75rem 0.9rem; border-radius: var(--border-radius);
  border: 1px solid color-mix(in srgb, #059669 30%, transparent); background-color: color-mix(in srgb, #059669 8%, transparent);
}
.billing-credit + .billing-card__empty { padding-top: 1.25rem; }
.billing-credit__row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
.billing-credit__label { font-size: 0.875rem; font-weight: 600; color: var(--color-text); }
.billing-credit__amount { font-size: 1.125rem; font-weight: 700; color: var(--color-up, #059669); font-variant-numeric: tabular-nums; }
.billing-credit__note { margin: 0.3rem 0 0; font-size: 0.8125rem; line-height: 1.5; color: var(--color-text-secondary); }
.billing-detail__value--credit { color: var(--color-up, #059669); }

/* Details */
.billing-detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.billing-detail__label {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
}

.billing-detail__value {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

/* Badges */
.billing-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
}

.billing-badge--active {
  background-color: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.billing-badge--past_due {
  background-color: rgba(245, 158, 11, 0.12);
  color: #d97706;
}

.billing-badge--canceled,
.billing-badge--incomplete_expired {
  background-color: rgba(239, 68, 68, 0.12);
  color: var(--color-danger);
}

.billing-badge--trialing {
  background-color: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
}

/* Invoice rows */
.billing-invoice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: var(--border-radius);
  background-color: var(--color-bg);
}

.billing-invoice-row__info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.billing-invoice-row__amount {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-text);
}

.billing-invoice-row__desc {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.billing-invoice-row__date {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.billing-invoice-row__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Payment method */
.billing-payment-method {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-radius: var(--border-radius);
  background-color: var(--color-bg);
}

.billing-payment-method__card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-text);
}

.billing-payment-method__card > div {
  display: flex;
  flex-direction: column;
}

.billing-payment-method__brand {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}

.billing-payment-method__number {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  letter-spacing: 0.05em;
}

.billing-payment-method__exp {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Buttons */
.billing-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
  text-decoration: none;
}

.billing-btn:hover {
  opacity: 0.85;
}

.billing-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.billing-btn--primary {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.billing-btn--secondary {
  background-color: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.billing-btn--sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
}

.billing-btn--full {
  width: 100%;
}

.billing-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border-radius: var(--border-radius);
  color: var(--color-text-secondary);
  transition: background-color 0.15s ease;
}

.billing-icon-btn:hover {
  background-color: var(--color-border);
}

/* Notice */
.billing-notice {
  font-size: 0.8125rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--border-radius);
}

.billing-notice--warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: #d97706;
}

/* States */
.billing-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.billing-placeholder__icon {
  opacity: 0.3;
}

.billing-placeholder h2 {
  font-family: var(--font-heading);
  color: var(--color-text);
  margin: 0;
}

.billing-placeholder p {
  max-width: 400px;
  line-height: 1.5;
}

.billing-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  color: var(--color-text-secondary);
}

.billing-loading__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.billing-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: var(--border-radius);
  background-color: rgba(239, 68, 68, 0.08);
  color: var(--color-danger);
  font-size: 0.875rem;
}
</style>
