<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { FileBarChart, Printer, RefreshCw, Loader2 } from 'lucide-vue-next';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { useReports, monthName, monthOnly, nextReportDate } from '@/composables/useReports';
import { compare, formatDuration, AGAINST_MONTH_BEFORE, againstLastYear, type Direction } from '@/lib/trend';
import { describeSources } from '@/lib/sources';
import config from '@/config/dashboard';

/**
 * Every stored monthly report (OVERVIEW-STANDARD 6). A report is a document,
 * so it reads like one: capped width, and printable on its own.
 */
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const { state, report, notes, months, message, load } = useReports();
const selected = ref('');
const chartCanvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

async function show(month?: string) {
  await load(month);
  if (report.value) selected.value = report.value.month;
  await nextTick();
  drawChart();
}

watch(selected, (month) => {
  if (month && month !== report.value?.month) show(month);
});

const generatedOn = computed(() =>
  report.value
    ? new Date(report.value.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''
);
const isLatest = computed(() => report.value?.month === months.value[0]);

interface Tile { label: string; value: string; note?: string; dir?: Direction }

const trafficTiles = computed<Tile[]>(() => {
  const r = report.value;
  const t = r?.traffic;
  if (!r || !t) return [];
  const vsMonth = compare(t.visits, t.prevVisits, AGAINST_MONTH_BEFORE);
  const yearBefore = monthName(`${Number(r.month.slice(0, 4)) - 1}${r.month.slice(4)}`);
  return [
    { label: 'Visits', value: t.visits.toLocaleString(), note: vsMonth.text, dir: vsMonth.dir },
    // This tile's number is last year's, so its note says whose it is; the
    // change itself is worded on this year's figure, below and in the brief.
    ...(t.lastYearVisits !== null
      ? [{ label: 'A year earlier', value: t.lastYearVisits.toLocaleString(), note: `visits in ${yearBefore}` }]
      : []),
    { label: 'Pages viewed', value: t.pageviews.toLocaleString() },
    { label: 'Time on a page', value: formatDuration(t.secondsOnPage), note: 'typical' },
    ...(t.mobileShare !== null ? [{ label: 'On a phone', value: `${t.mobileShare}%`, note: 'of visits' }] : []),
    ...(t.returningShare != null ? [{ label: 'Coming back', value: `${t.returningShare}%`, note: 'had visited before' }] : []),
  ];
});

/** Inquiries per configured kind, against the month before (standard 4.4 wording). */
const inquiryTiles = computed<Tile[]>(() =>
  (report.value?.inquiries?.kinds ?? []).map((k) => {
    const vs = compare(k.count, k.prev, AGAINST_MONTH_BEFORE);
    return { label: k.many.charAt(0).toUpperCase() + k.many.slice(1), value: k.count.toLocaleString(), note: vs.text, dir: vs.dir };
  })
);
const stillNewText = computed(() => {
  const n = report.value?.inquiries?.stillNew ?? 0;
  return n ? `${n === 1 ? 'One is' : `${n} are`} still marked New.` : '';
});
const countedBy =
  config.analytics?.provider === 'ga4'
    ? 'Counted by Google Analytics as engaged visits (10+ seconds, a second page, or an inquiry), which leaves out most automated traffic.'
    : 'Counted by Simple Analytics, which leaves out bots and uses no cookies.';

/** This year against the same month last year, worded on this year's figure. */
const yearChange = computed(() => {
  const r = report.value;
  const t = r?.traffic;
  if (!r || !t || t.lastYearVisits === null) return null;
  const change = compare(t.visits, t.lastYearVisits, againstLastYear(monthOnly(r.month)));
  return change.text ? { text: `${monthOnly(r.month)} visits: ${change.text.charAt(0).toLowerCase()}${change.text.slice(1)}`, dir: change.dir } : null;
});

// ─── Lighthouse ─────────────────────────────────────────────────────────────

const lighthouseRuns = computed(() =>
  [report.value?.lighthouse?.mobile, report.value?.lighthouse?.desktop].filter((r): r is NonNullable<typeof r> => Boolean(r))
);

const SCORE_LABELS = [
  ['performance', 'Speed'],
  ['accessibility', 'Accessibility'],
  ['bestPractices', 'Best practices'],
  ['seo', 'Search basics'],
] as const;

const band = (score: number) => (score >= 90 ? 'good' : score >= 50 ? 'needs-work' : 'poor');
const RATING_WORDS = { good: 'Good', 'needs-work': 'Needs work', poor: 'Poor' } as const;

const lighthouseDate = computed(() => {
  const at = report.value?.lighthouse?.checkedAt;
  return at ? new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
});

// ─── Ranked lists ───────────────────────────────────────────────────────────

const sources = computed(() => describeSources(report.value?.sources ?? []));

/** Bar widths relative to the list's own largest entry. */
const widthOf = (value: number, max: number) => `${Math.max(2, (value / Math.max(1, max)) * 100)}%`;
const maxViews = computed(() => Math.max(0, ...(report.value?.pages ?? []).map((p) => p.views)));
const maxSource = computed(() => Math.max(0, ...sources.value.map((s) => s.visits)));
const maxCity = computed(() => Math.max(0, ...(report.value?.cities ?? []).map((c) => c.visits)));

/** Clicks from Google against the month before (standard 4.4 wording). */
const searchChange = computed(() => {
  const s = report.value?.search;
  return s ? compare(s.clicks, s.prevClicks, AGAINST_MONTH_BEFORE) : null;
});

// ─── Daily chart ────────────────────────────────────────────────────────────

const chartSummary = computed(() => {
  const series = report.value?.series ?? [];
  if (!series.length) return '';
  const peak = series.reduce((a, b) => (b.visits > a.visits ? b : a));
  const day = new Date(`${peak.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return `Visits each day. Busiest: ${day}, with ${peak.visits}.`;
});

function drawChart() {
  chart?.destroy();
  chart = null;
  const series = report.value?.series ?? [];
  if (!chartCanvas.value || !series.length) return;
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--color-text-secondary').trim() || '#55676b';
  chart = new Chart(chartCanvas.value, {
    type: 'bar',
    data: {
      labels: series.map((p) => String(Number(p.day.slice(8)))),
      datasets: [{ data: series.map((p) => p.visits), backgroundColor: css.getPropertyValue('--color-secondary').trim() || '#9fba9a', borderRadius: 3, barPercentage: 0.7 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => `Day ${items[0]?.label}`, label: (ctx) => `${ctx.parsed.y} visits` } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: muted, maxRotation: 0, autoSkipPadding: 8 } },
        y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 4, font: { size: 10 }, color: muted }, border: { display: false } },
      },
    },
  });
}

const print = () => window.print();

onMounted(() => show());
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <DashboardLayout page-title="Monthly Reports">
    <div v-if="state === 'empty'" class="rep-empty">
      <FileBarChart :size="48" class="rep-empty__icon" aria-hidden="true" />
      <h2>No reports yet</h2>
      <p>A report for each month is written early the following month and kept here.</p>
    </div>

    <div v-else class="rep">
      <div class="rep__bar">
        <label class="rep__picker">
          <span>Month</span>
          <select v-model="selected" :disabled="state === 'loading' || !months.length">
            <option v-for="m in months" :key="m" :value="m">{{ monthName(m) }}</option>
          </select>
        </label>
        <button type="button" class="rep__btn" :disabled="state !== 'ready'" @click="print">
          <Printer :size="16" aria-hidden="true" /> Print or save as PDF
        </button>
      </div>

      <div v-if="state === 'loading'" class="rep__status" role="status">
        <Loader2 :size="18" class="rep__spin" aria-hidden="true" /> Loading the report…
      </div>

      <div v-else-if="state === 'error'" class="rep__status" role="alert">
        {{ message }}
        <button type="button" class="rep__btn" @click="show(selected || undefined)"><RefreshCw :size="14" aria-hidden="true" /> Try again</button>
      </div>

      <article v-else-if="report" class="rep__doc">
        <header class="rep__head">
          <p class="rep__eyebrow">Monthly website report</p>
          <h2 class="rep__title">{{ monthName(report.month) }}</h2>
          <p class="rep__meta">
            Prepared {{ generatedOn }}<template v-if="isLatest"> · Next report {{ nextReportDate(report.month) }}</template>
          </p>
        </header>

        <section class="rep__section">
          <h3 class="rep__h">The month in brief</h3>
          <ul class="rep__highlights">
            <li v-for="line in report.highlights" :key="line">{{ line }}</li>
          </ul>
        </section>

        <section v-if="notes" class="rep__section rep__notes">
          <h3 class="rep__h">From your web team</h3>
          <p v-if="notes.summary" class="rep__prose">{{ notes.summary }}</p>
          <template v-if="notes.recommendations">
            <h4 class="rep__h4">Recommendations</h4>
            <p class="rep__prose">{{ notes.recommendations }}</p>
          </template>
        </section>

        <section v-if="inquiryTiles.length" class="rep__section">
          <h3 class="rep__h">People getting in touch</h3>
          <div class="rep__tiles">
            <div v-for="tile in inquiryTiles" :key="tile.label" class="rep__tile">
              <span class="rep__tile-label">{{ tile.label }}</span>
              <span class="rep__tile-value">{{ tile.value }}</span>
              <span v-if="tile.note" class="rep__tile-note" :class="tile.dir && `rep__tile-note--${tile.dir}`">{{ tile.note }}</span>
            </div>
          </div>
          <p class="rep__fine">Counted from the forms on your website. {{ stillNewText }}</p>
        </section>

        <section v-if="report.traffic" class="rep__section">
          <h3 class="rep__h">Visits</h3>
          <div class="rep__tiles">
            <div v-for="tile in trafficTiles" :key="tile.label" class="rep__tile">
              <span class="rep__tile-label">{{ tile.label }}</span>
              <span class="rep__tile-value">{{ tile.value }}</span>
              <span v-if="tile.note" class="rep__tile-note" :class="tile.dir && `rep__tile-note--${tile.dir}`">{{ tile.note }}</span>
            </div>
          </div>
          <p v-if="yearChange" class="rep__fine rep__fine--change" :class="`rep__tile-note--${yearChange.dir}`">{{ yearChange.text }}.</p>
          <p class="rep__fine">{{ countedBy }}</p>
          <div v-if="report.series.length" class="rep__chart">
            <canvas ref="chartCanvas" role="img" :aria-label="chartSummary"></canvas>
          </div>
        </section>

        <section v-if="lighthouseRuns.length" class="rep__section">
          <h3 class="rep__h">Speed and quality</h3>
          <p class="rep__fine rep__fine--lead">
            Google Lighthouse test of the homepage, taken {{ lighthouseDate }}. Scores are out of 100; 90 and above is good.
          </p>
          <div class="rep__lh">
            <div v-for="run in lighthouseRuns" :key="run.strategy" class="rep__lh-run">
              <h4 class="rep__h4">{{ run.strategy === 'mobile' ? 'On a phone' : 'On a computer' }}</h4>
              <ul class="rep__lh-scores">
                <li v-for="[key, label] in SCORE_LABELS" :key="key" :class="`rep__lh-score rep__lh-score--${band(run.scores[key])}`">
                  <span class="rep__lh-value">{{ run.scores[key] }}</span>
                  <span class="rep__lh-label">{{ label }}</span>
                </li>
              </ul>
              <dl class="rep__lh-metrics">
                <div>
                  <dt>Main content appears</dt>
                  <dd>{{ (run.metrics.lcp.value / 1000).toFixed(1) }}s <span :class="`rep__rating rep__rating--${run.metrics.lcp.rating}`">{{ RATING_WORDS[run.metrics.lcp.rating] }}</span></dd>
                </div>
                <div>
                  <dt>Layout stays steady</dt>
                  <dd>{{ run.metrics.cls.value }} <span :class="`rep__rating rep__rating--${run.metrics.cls.rating}`">{{ RATING_WORDS[run.metrics.cls.rating] }}</span></dd>
                </div>
                <div>
                  <dt>Page responds to taps</dt>
                  <dd>{{ run.metrics.tbt.value }}ms delay <span :class="`rep__rating rep__rating--${run.metrics.tbt.rating}`">{{ RATING_WORDS[run.metrics.tbt.rating] }}</span></dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <div class="rep__grid">
          <section v-if="report.pages.length" class="rep__section">
            <h3 class="rep__h">Most viewed pages</h3>
            <ol class="rep__list">
              <li v-for="page in report.pages" :key="page.path">
                <span class="rep__list-name rep__list-name--path">{{ page.path }}</span>
                <span class="rep__list-bar" aria-hidden="true"><span :style="{ width: widthOf(page.views, maxViews) }"></span></span>
                <span class="rep__list-count">{{ page.views.toLocaleString() }}</span>
              </li>
            </ol>
          </section>

          <section v-if="report.cities?.length" class="rep__section">
            <h3 class="rep__h">Where visitors were</h3>
            <ol class="rep__list">
              <li v-for="city in report.cities" :key="`${city.name}-${city.region}`">
                <span class="rep__list-name">{{ city.name }}, {{ city.region }}</span>
                <span class="rep__list-bar" aria-hidden="true"><span :style="{ width: widthOf(city.visits, maxCity) }"></span></span>
                <span class="rep__list-count">{{ city.visits.toLocaleString() }}</span>
              </li>
            </ol>
          </section>

          <section v-if="sources.length" class="rep__section">
            <h3 class="rep__h">How people found the site</h3>
            <ol class="rep__list">
              <li v-for="source in sources" :key="source.name" :title="source.desc">
                <span class="rep__list-name">{{ source.name }}</span>
                <span class="rep__list-bar" aria-hidden="true"><span :style="{ width: widthOf(source.visits, maxSource) }"></span></span>
                <span class="rep__list-count">{{ source.visits.toLocaleString() }}</span>
              </li>
            </ol>
          </section>
        </div>

        <section v-if="report.search" class="rep__section">
          <h3 class="rep__h">Google search</h3>
          <p class="rep__prose">
            The site appeared in Google results {{ report.search.impressions.toLocaleString() }}
            {{ report.search.impressions === 1 ? 'time' : 'times' }} and was clicked {{ report.search.clicks.toLocaleString() }}
            {{ report.search.clicks === 1 ? 'time' : 'times' }}<template v-if="report.search.position">, usually around position {{ report.search.position }}</template>.
          </p>
          <p v-if="searchChange?.text" class="rep__fine rep__fine--change" :class="`rep__tile-note--${searchChange.dir}`">Clicks: {{ searchChange.text.charAt(0).toLowerCase() + searchChange.text.slice(1) }}.</p>
          <table v-if="report.search.queries.length" class="rep__table">
            <caption class="sr-only">Top searches that showed the site</caption>
            <thead>
              <tr><th scope="col">Search</th><th scope="col">Clicks</th><th scope="col">Times shown</th></tr>
            </thead>
            <tbody>
              <tr v-for="q in report.search.queries" :key="q.query">
                <th scope="row">{{ q.query }}</th><td>{{ q.clicks.toLocaleString() }}</td><td>{{ q.impressions.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.rep { max-width: 1100px; }
.rep__bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 0.75rem; margin-bottom: 1.25rem; }
.rep__picker { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; font-weight: 700; color: var(--color-text-secondary); }
.rep__picker select {
  min-width: 200px; padding: 0.5rem 0.625rem; border: 1px solid var(--color-border); border-radius: var(--border-radius);
  background-color: var(--color-surface); color: var(--color-text); font: inherit; font-size: 0.9375rem; font-weight: 500;
}
.rep__btn {
  display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.875rem; border: 1px solid var(--color-border);
  border-radius: var(--border-radius); background-color: var(--color-surface); color: var(--color-text); font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer;
}
.rep__btn:hover:not(:disabled) { border-color: var(--color-primary); }
.rep__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rep__status { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 2rem 0; font-size: 0.875rem; color: var(--color-text-secondary); }
.rep__spin { animation: rep-spin 1s linear infinite; }
@keyframes rep-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .rep__spin { animation: none; } }

.rep__doc {
  background-color: var(--color-surface); border: 1px solid var(--color-border); border-top: 4px solid var(--color-secondary);
  border-radius: calc(var(--border-radius) * 1.5); box-shadow: var(--shadow-card); padding: 1.75rem 2rem 2rem;
}
.rep__head { padding-bottom: 1.25rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--color-border); }
.rep__eyebrow { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.rep__title { margin-top: 0.25rem; font-size: clamp(1.5rem, 1.2rem + 1vw, 2rem); font-weight: 700; font-family: var(--font-heading); color: var(--color-text); }
.rep__meta { margin-top: 0.35rem; font-size: 0.8125rem; color: var(--color-text-secondary); }

.rep__section { margin-bottom: 1.75rem; break-inside: avoid; }
.rep__h { margin-bottom: 0.75rem; font-size: 1rem; font-weight: 700; font-family: var(--font-heading); color: var(--color-text); }
.rep__h4 { margin: 1rem 0 0.35rem; font-size: 0.875rem; font-weight: 700; color: var(--color-text); }
.rep__prose { max-width: 80ch; font-size: 0.9375rem; line-height: 1.6; color: var(--color-text); white-space: pre-wrap; }
.rep__fine { margin-top: 0.6rem; max-width: 80ch; font-size: 0.75rem; color: var(--color-text-secondary); }

.rep__highlights { list-style: none; display: flex; flex-direction: column; gap: 0.5rem; max-width: 85ch; }
.rep__highlights li { position: relative; padding-left: 1.2rem; font-size: 1rem; line-height: 1.55; color: var(--color-text); }
.rep__highlights li::before { content: ''; position: absolute; left: 0; top: 0.62em; width: 0.45rem; height: 0.45rem; border-radius: 50%; background-color: var(--color-secondary); }

.rep__notes { padding: 1rem 1.25rem; background-color: var(--color-bg); border-left: 3px solid var(--color-accent); border-radius: var(--border-radius); }

.rep__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; }
.rep__tile { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.875rem 1rem; background-color: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); }
.rep__tile-label { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary); }
.rep__tile-value { font-size: 1.5rem; font-weight: 700; font-family: var(--font-heading); color: var(--color-text); }
.rep__tile-note { font-size: 0.75rem; color: var(--color-text-secondary); }
.rep__tile-note--up { color: var(--color-up); }
.rep__tile-note--down { color: var(--color-down); }

.rep__chart { height: 180px; margin-top: 1rem; }

.rep__fine--lead { margin: -0.4rem 0 0.9rem; }
.rep__fine--change { font-size: 0.8125rem; font-weight: 600; }
.rep__lh { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 1rem 2.5rem; }
.rep__lh-run .rep__h4 { margin-top: 0; }
.rep__lh-scores { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; }
.rep__lh-score { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; text-align: center; }
.rep__lh-value {
  display: grid; place-items: center; width: 3.25rem; height: 3.25rem; border-radius: 50%;
  border: 4px solid currentColor; font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums;
  background-color: var(--color-bg);
}
.rep__lh-score--good { color: var(--color-up); }
.rep__lh-score--needs-work { color: var(--color-warn); }
.rep__lh-score--poor { color: var(--color-down); }
.rep__lh-label { font-size: 0.75rem; color: var(--color-text-secondary); line-height: 1.25; }
.rep__lh-metrics { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
.rep__lh-metrics div { display: flex; justify-content: space-between; gap: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--color-border); font-size: 0.875rem; }
.rep__lh-metrics dt { color: var(--color-text-secondary); }
.rep__lh-metrics dd { flex-shrink: 0; color: var(--color-text); font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.rep__rating { margin-left: 0.4rem; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
.rep__rating--good { color: var(--color-up); }
.rep__rating--needs-work { color: var(--color-warn); }
.rep__rating--poor { color: var(--color-down); }

.rep__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 0 2.5rem; }
.rep__list { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; }
.rep__list li { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(60px, 1fr) auto; align-items: center; gap: 0.75rem; font-size: 0.875rem; }
.rep__list-name { color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rep__list-name--path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8125rem; }
.rep__list-bar { height: 6px; border-radius: 3px; background-color: var(--color-border); overflow: hidden; }
.rep__list-bar span { display: block; height: 100%; background-color: var(--color-secondary); border-radius: 3px; }
.rep__list-count { min-width: 2.5rem; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--color-text); }

.rep-empty { text-align: center; padding: 4rem 1.5rem; color: var(--color-text-secondary); }
.rep-empty__icon { opacity: 0.3; margin: 0 auto 1rem; }
.rep-empty h2 { font-size: 1.25rem; font-weight: 700; color: var(--color-text); margin-bottom: 0.5rem; }
.rep-empty p { max-width: 420px; margin: 0 auto; font-size: 0.9375rem; line-height: 1.5; }

@media (max-width: 640px) {
  .rep__doc { padding: 1.25rem 1rem 1.5rem; }
}

/* Printed or saved as PDF: the report alone, on white. */
@media print {
  .rep { max-width: none; }
  .rep__bar { display: none; }
  .rep__doc { border: none; box-shadow: none; padding: 0; background: #fff; }
  .rep__tile, .rep__notes { background: #fff; }
  /* Let long sections run across pages; keep only the small blocks whole. */
  .rep__section { break-inside: auto; }
  .rep__h { break-after: avoid; }
  .rep__tiles, .rep__notes, .rep__chart, .rep__lh-run, .rep__list { break-inside: avoid; }
  /* Paper is narrower than the screen's two-column breakpoint; keep the lists side by side. */
  .rep__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 1.5rem; }
  .rep__list li { grid-template-columns: minmax(0, 1.6fr) minmax(40px, 1fr) auto; gap: 0.5rem; }
}
.rep__table { width: 100%; max-width: 720px; margin-top: 0.75rem; border-collapse: collapse; font-size: 0.875rem; }
.rep__table th, .rep__table td { padding: 0.45rem 0.25rem; border-bottom: 1px solid var(--color-border); text-align: right; font-variant-numeric: tabular-nums; }
.rep__table th:first-child { text-align: left; font-weight: 500; color: var(--color-text); overflow-wrap: anywhere; }
.rep__table thead th { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; color: var(--color-text-secondary); }
</style>
