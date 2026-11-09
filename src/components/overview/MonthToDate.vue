<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { Activity, Loader2 } from 'lucide-vue-next';
import type { MonthToDate } from '@/composables/useOverview';
import config from '@/config/dashboard';
import { compare, formatDuration, AGAINST_SAME_DAYS } from '@/lib/trend';

/**
 * The live half of the overview: this month so far, set against the same days
 * of last month. Visits are Simple Analytics' visitor count, which already
 * leaves out bots (OVERVIEW-STANDARD 4.2).
 */
const props = defineProps<{
  month: MonthToDate | null;
  state: 'loading' | 'ready' | 'none';
  /** Submissions this month by kind, from the inbox (never from analytics). */
  thisMonth?: Record<string, number> | null;
}>();

/** The minimal (Sustain) dashboard has no Analytics page to link to. */
const hasAnalyticsPage = config.enabledWidgets.includes('siteAnalytics');

const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

const visits = computed(() => props.month?.current.visitors ?? 0);
const change = computed(() => compare(visits.value, props.month?.previous.visitors, AGAINST_SAME_DAYS));

/** Bar heights for the sparkline, scaled to the busiest day. */
const bars = computed(() => {
  const series = props.month?.series ?? [];
  const max = Math.max(1, ...series.map((p) => p.visitors));
  return series.map((p) => ({ key: p.key, visitors: p.visitors, height: Math.max(4, (p.visitors / max) * 100) }));
});
const busiest = computed(() => {
  const series = props.month?.series ?? [];
  if (!series.length) return '';
  const peak = series.reduce((a, b) => (b.visitors > a.visitors ? b : a));
  const day = new Date(`${peak.key}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return peak.visitors ? `Busiest day so far: ${day}, with ${peak.visitors} ${peak.visitors === 1 ? 'visit' : 'visits'}.` : '';
});

const stats = computed(() =>
  props.month
    ? [
        ...(props.thisMonth
          ? (config.submissionKinds ?? []).map((k) => {
              const n = props.thisMonth?.[k.kind] ?? 0;
              return { label: k.many.charAt(0).toUpperCase() + k.many.slice(1), value: n.toLocaleString() };
            })
          : []),
        { label: 'Pages viewed', value: props.month.current.pageviews.toLocaleString() },
        { label: 'Typical time on a page', value: formatDuration(props.month.current.secondsOnPage) },
      ]
    : []
);
</script>

<template>
  <section class="card mtd" aria-labelledby="mtd-title">
    <div class="card__head">
      <h2 id="mtd-title" class="card__title"><Activity :size="18" aria-hidden="true" /> {{ monthName }} so far</h2>
      <RouterLink v-if="hasAnalyticsPage" to="/analytics" class="card__link">Site analytics &rarr;</RouterLink>
    </div>

    <div v-if="state === 'loading'" class="card__empty mtd__loading" role="status">
      <Loader2 :size="16" class="mtd__spin" aria-hidden="true" /> Loading this month's figures…
    </div>

    <p v-else-if="!month" class="card__empty">Visitor figures appear here once analytics is connected.</p>

    <template v-else>
      <div class="mtd__body">
        <div class="mtd__headline">
          <span class="mtd__number">{{ visits.toLocaleString() }}</span>
          <span class="mtd__label">{{ visits === 1 ? 'visit' : 'visits' }}</span>
          <span v-if="change.text" class="mtd__change" :class="`mtd__change--${change.dir}`">{{ change.text }}</span>
        </div>

        <div v-if="bars.length" class="mtd__spark" aria-hidden="true">
          <span v-for="bar in bars" :key="bar.key" class="mtd__bar" :style="{ height: `${bar.height}%` }" :title="`${bar.key}: ${bar.visitors}`"></span>
        </div>
      </div>
      <p v-if="busiest" class="sr-only">{{ busiest }}</p>

      <dl class="mtd__stats">
        <div v-for="stat in stats" :key="stat.label" class="mtd__stat">
          <dt>{{ stat.label }}</dt>
          <dd>{{ stat.value }}</dd>
        </div>
      </dl>
    </template>
  </section>
</template>

<style scoped>
.mtd__loading { display: flex; align-items: center; gap: 0.5rem; }
.mtd__spin { animation: mtd-spin 1s linear infinite; }
@keyframes mtd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mtd__spin { animation: none; } }

.mtd__body { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); align-items: end; gap: 1.5rem; }
.mtd__headline { display: flex; flex-direction: column; }
.mtd__number { font-family: var(--font-heading); font-size: clamp(2.25rem, 1.8rem + 1.5vw, 3rem); font-weight: 700; line-height: 1; color: var(--color-text); }
.mtd__label { margin-top: 0.35rem; font-size: 0.875rem; color: var(--color-text-secondary); }
.mtd__change { margin-top: 0.35rem; font-size: 0.8125rem; font-weight: 600; color: var(--color-text-secondary); }
.mtd__change--up { color: var(--color-up); }
.mtd__change--down { color: var(--color-down); }

.mtd__spark { display: flex; align-items: flex-end; gap: 3px; height: 72px; }
.mtd__bar { flex: 1; min-width: 3px; max-width: 48px; border-radius: 3px 3px 1px 1px; background-color: var(--color-secondary); }
/* Today isn't over, so its bar is faded. */
.mtd__bar:last-child { opacity: 0.45; }

.mtd__stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem;
  margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--color-border);
}
.mtd__stat dt { font-size: 0.75rem; color: var(--color-text-secondary); }
.mtd__stat dd { margin-top: 0.15rem; font-family: var(--font-heading); font-size: 1.25rem; font-weight: 700; color: var(--color-text); }

@media (max-width: 560px) {
  .mtd__body { grid-template-columns: 1fr; }
}
</style>
