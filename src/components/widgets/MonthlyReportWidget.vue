<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { FileBarChart, Loader2 } from 'lucide-vue-next';
import { useReports, monthName, nextReportDate } from '@/composables/useReports';
import { compare, formatDuration, AGAINST_MONTH_BEFORE, type Direction } from '@/lib/trend';

/**
 * Last month at a glance (OVERVIEW-STANDARD 3.4). The month-so-far card
 * answers "what is happening"; this answers "how did last month go", and stays
 * the same all month so it can be read, shared and referred back to.
 */
const { state, report, load } = useReports();

interface Tile { label: string; value: string; note: string; dir: Direction }

/**
 * Visits, then (with no submission kinds yet) the fallbacks in order: phone
 * speed score, then time on a page, then pages viewed.
 */
const tiles = computed<Tile[]>(() => {
  const r = report.value;
  if (!r) return [];
  const t = r.traffic;
  const out: Tile[] = [];
  if (t) {
    const change = compare(t.visits, t.prevVisits, AGAINST_MONTH_BEFORE);
    out.push({ label: 'Visits', value: t.visits.toLocaleString(), note: change.text, dir: change.dir });
  }
  // Then one tile per submission kind (standard 3.4).
  for (const k of r.inquiries?.kinds ?? []) {
    const vs = compare(k.count, k.prev, AGAINST_MONTH_BEFORE);
    out.push({ label: k.many.charAt(0).toUpperCase() + k.many.slice(1), value: k.count.toLocaleString(), note: vs.text, dir: vs.dir });
  }
  const speed = r.lighthouse?.mobile?.scores.performance;
  if (speed !== undefined) {
    out.push({
      label: 'Phone speed score',
      value: `${speed}/100`,
      note: speed >= 90 ? 'Good' : speed >= 50 ? 'Needs work' : 'Poor',
      dir: speed >= 90 ? 'up' : speed >= 50 ? 'flat' : 'down',
    });
  }
  if (t) {
    out.push({ label: 'Time on a page', value: formatDuration(t.secondsOnPage), note: 'typical', dir: 'flat' });
    if (out.length < 3) out.push({ label: 'Pages viewed', value: t.pageviews.toLocaleString(), note: '', dir: 'flat' });
  }
  return out;
});

onMounted(() => load());
</script>

<template>
  <section class="card report-card" aria-labelledby="report-card-title">
    <div class="card__head">
      <h2 id="report-card-title" class="card__title">
        <FileBarChart :size="18" aria-hidden="true" />
        <template v-if="report">{{ monthName(report.month) }} report</template>
        <template v-else>Monthly report</template>
      </h2>
      <RouterLink v-if="report" to="/reports" class="card__link">Full report &rarr;</RouterLink>
    </div>

    <p v-if="state === 'loading'" class="card__empty report-card__status" role="status">
      <Loader2 :size="16" class="report-card__spin" aria-hidden="true" /> Loading…
    </p>
    <p v-else-if="state === 'empty'" class="card__empty">Your first monthly report will appear here early next month.</p>
    <p v-else-if="state === 'error'" class="card__empty" role="alert">The report could not be loaded just now.</p>

    <template v-else-if="report">
      <div class="report-card__tiles">
        <div v-for="tile in tiles" :key="tile.label" class="report-card__tile">
          <span class="report-card__tile-label">{{ tile.label }}</span>
          <span class="report-card__tile-value">{{ tile.value }}</span>
          <span v-if="tile.note" class="report-card__tile-note" :class="`report-card__tile-note--${tile.dir}`">{{ tile.note }}</span>
        </div>
      </div>

      <ul class="report-card__highlights">
        <li v-for="line in report.highlights" :key="line">{{ line }}</li>
      </ul>

      <p class="report-card__foot">Next report: {{ nextReportDate(report.month) }}</p>
    </template>
  </section>
</template>

<style scoped>
.report-card { border-top: 3px solid var(--color-secondary); }
.report-card__status { display: flex; align-items: center; gap: 0.5rem; }
.report-card__spin { animation: report-spin 1s linear infinite; }
@keyframes report-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .report-card__spin { animation: none; } }

.report-card__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
.report-card__tile {
  display: flex; flex-direction: column; gap: 0.15rem; padding: 0.875rem 1rem;
  background-color: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius);
}
.report-card__tile-label { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary); }
.report-card__tile-value { font-size: 1.625rem; font-weight: 700; font-family: var(--font-heading); color: var(--color-text); }
.report-card__tile-note { font-size: 0.75rem; color: var(--color-text-secondary); }
.report-card__tile-note--up { color: var(--color-up); }
.report-card__tile-note--down { color: var(--color-down); }

.report-card__highlights { list-style: none; display: flex; flex-direction: column; gap: 0.4rem; max-width: 90ch; }
.report-card__highlights li { position: relative; padding-left: 1.1rem; font-size: 0.9375rem; line-height: 1.5; color: var(--color-text); }
.report-card__highlights li::before {
  content: ''; position: absolute; left: 0; top: 0.6em; width: 0.4rem; height: 0.4rem; border-radius: 50%; background-color: var(--color-secondary);
}
.report-card__foot { margin-top: 0.875rem; font-size: 0.75rem; color: var(--color-text-secondary); }

@media (max-width: 560px) {
  /* Two across on a phone, so the highlights aren't a screen away. */
  .report-card__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
  .report-card__tile { padding: 0.7rem 0.75rem; }
  .report-card__tile-value { font-size: 1.3rem; }
}
</style>
