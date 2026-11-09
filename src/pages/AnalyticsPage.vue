<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { Users, Eye, Clock, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-vue-next';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import config from '@/config/dashboard';
import { useAuthToken } from '@/composables/useAuthToken';
import { apiFetch } from '@/composables/useApi';

// BarController is required for type: 'bar' — without it Chart.js v4 throws
// "bar is not a registered controller" and the page renders its error state.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const authToken = useAuthToken();
const analytics = config.analytics;
const internalRoutes = analytics?.internalRoutes ?? ['/analytics', '/billing', '/support'];
const conversionPage = analytics?.conversionPage ?? '/contact';
const conversionLabel = conversionPage.replace(/^\//, '').replace(/-/g, ' ');

// ─── State ──────────────────────────────────────────────────────────────────

const loading = ref(true);
const error = ref<string | null>(null);

interface AnalyticsData {
  pageviews: number;
  visitors: number;
  seconds_on_page: number;
  pages: { value: string; pageviews: number; visitors: number }[];
  referrers: { value: string; pageviews: number; visitors: number }[];
  /** Real visitor counts per day or month (YYYY-MM-DD bucket start). */
  histogram?: { date: string; pageviews: number; visitors: number }[];
}

type Period = 'today' | '7d' | '30d' | '12m' | 'all';

const current = ref<AnalyticsData | null>(null);
const previous = ref<AnalyticsData | null>(null);
const period = ref<Period>('30d');
const showInternal = ref(false);
const chartCanvas = ref<HTMLCanvasElement | null>(null);
let chartInstance: Chart | null = null;

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '12m': 'Last 12 months',
  all: 'Since tracking began',
};

const PERIOD_WORDS: Record<Period, string> = {
  today: 'today',
  '7d': 'this week',
  '30d': 'this month',
  '12m': 'in the last 12 months',
  all: 'since tracking began',
};

const PREV_PERIOD_WORDS: Record<Period, string> = {
  today: 'yesterday',
  '7d': 'last week',
  '30d': 'last month',
  '12m': 'the 12 months before',
  all: '',
};

// Chart buckets: days for short ranges, months for the long-term views.
const PERIOD_INTERVAL: Record<Period, 'day' | 'month'> = {
  today: 'day',
  '7d': 'day',
  '30d': 'day',
  '12m': 'month',
  all: 'month',
};

// The first day analytics recorded, else far enough back for any site; the
// chart trims the empty months before the first visit.
const ALL_TIME_START = analytics?.trackingSince || '2019-01-01';

// ─── Date helpers ───────────────────────────────────────────────────────────

function getDateRange(p: Period) {
  const now = new Date();
  // Local dates: toISOString() is UTC, which is already tomorrow on a US evening.
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (p === 'today') {
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    return { start: fmt(now), end: fmt(now), prevStart: fmt(yesterday), prevEnd: fmt(yesterday) };
  }

  if (p === 'all') {
    return { start: ALL_TIME_START, end: fmt(now), prevStart: null, prevEnd: null };
  }

  const start = new Date(now);
  if (p === '12m') start.setFullYear(now.getFullYear() - 1);
  else start.setDate(now.getDate() - (p === '7d' ? 7 : 30));

  const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1);
  const prevStart = new Date(start);
  if (p === '12m') prevStart.setFullYear(start.getFullYear() - 1);
  else prevStart.setDate(start.getDate() - (p === '7d' ? 7 : 30));

  return { start: fmt(start), end: fmt(now), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
}

// ─── Data fetching ──────────────────────────────────────────────────────────

async function fetchAnalytics() {
  loading.value = true;
  error.value = null;

  try {
    const { start, end, prevStart, prevEnd } = getDateRange(period.value);
    const token = await authToken();
    // The site is pinned server-side; only the range goes up.
    const get = (from: string, to: string, interval?: string) =>
      apiFetch<AnalyticsData>(
        `/.netlify/functions/analytics-proxy?start=${from}&end=${to}${interval ? `&interval=${interval}` : ''}`,
        { token },
      );

    const [currentData, previousData] = await Promise.all([
      get(start, end, PERIOD_INTERVAL[period.value]),
      // The comparison period is a nice-to-have; don't fail the page over it.
      prevStart && prevEnd ? get(prevStart, prevEnd).catch(() => null) : null,
    ]);

    current.value = currentData;
    previous.value = previousData;

    // The canvas only exists once the skeleton is gone, so drop it first.
    loading.value = false;
    await nextTick();
    renderChart();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load analytics';
  } finally {
    loading.value = false;
  }
}

function changePeriod(p: Period) {
  period.value = p;
  fetchAnalytics();
}

// ─── Computations ───────────────────────────────────────────────────────────

function pctChange(cur: number, prev: number): number {
  if (!prev) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function trendDirection(change: number): 'up' | 'down' | 'flat' {
  if (change > 5) return 'up';
  if (change < -5) return 'down';
  return 'flat';
}

function trendLabel(dir: 'up' | 'down' | 'flat'): string {
  if (dir === 'up') return 'Trending up';
  if (dir === 'down') return 'Declining';
  return 'About the same';
}

// A comparison needs an earlier period that actually has data. "Since
// tracking began" has none, and a 12-month view on a young site would
// otherwise compare against months before the site existed.
const hasComparison = computed(() => {
  const p = previous.value;
  if (!p || period.value === 'all') return false;
  if (period.value === '12m' && !p.visitors && !p.pageviews) return false;
  return true;
});

const visitorChange = computed(() => {
  if (!current.value || !previous.value || !hasComparison.value) return 0;
  return pctChange(current.value.visitors, previous.value.visitors);
});

// Histogram buckets to chart. For "since tracking began", drop the empty
// months before the first recorded visit.
const chartBuckets = computed(() => {
  const buckets = current.value?.histogram ?? [];
  if (period.value !== 'all') return buckets;
  const first = buckets.findIndex((b) => b.pageviews > 0 || b.visitors > 0);
  return first === -1 ? [] : buckets.slice(first);
});

function bucketDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const trackingSinceLabel = computed(() => {
  const first = chartBuckets.value[0];
  return first ? bucketDate(first.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
});

// ─── Story headline ─────────────────────────────────────────────────────────

const storyHeadline = computed(() => {
  if (!current.value) return '';
  const v = current.value.visitors;
  const periodWord =
    period.value === 'all' && trackingSinceLabel.value
      ? `since tracking began in ${trackingSinceLabel.value}`
      : PERIOD_WORDS[period.value];

  if (v === 0) return `No one visited your site ${periodWord}.`;

  const visited = `${v.toLocaleString()} ${v === 1 ? 'person' : 'people'} visited your site ${periodWord}`;
  if (!hasComparison.value) return `${visited}.`;

  const prevWord = PREV_PERIOD_WORDS[period.value];
  const change = visitorChange.value;

  let trend: string;
  if (change > 50) trend = `nearly double ${prevWord}`;
  else if (change > 10) trend = `up from ${prevWord}`;
  else if (change >= -10) trend = `about the same as ${prevWord}`;
  else trend = `down from ${prevWord}`;

  return `${visited} — ${trend}.`;
});

const storySubline = computed(() => {
  if (!current.value) return '';
  if (current.value.visitors === 0) return 'Try a longer range above to see earlier visits.';
  const pages = current.value.pages || [];
  const homepageVisitors = pages.find(p => p.value === '/')?.visitors ?? current.value.visitors;
  const deepExplorers = Math.max(0, current.value.visitors - homepageVisitors);
  if (deepExplorers === 0) return 'All traffic landed on your homepage. No one explored further pages.';
  return `Most traffic landed on your homepage. Only ${deepExplorers.toLocaleString()} ${deepExplorers === 1 ? 'person' : 'people'} explored further.`;
});

// ─── Metric cards ───────────────────────────────────────────────────────────

const metricCards = computed(() => {
  if (!current.value) return [];
  const c = current.value;
  // null = nothing to compare against, so the card shows no trend at all
  const p = hasComparison.value ? previous.value : null;
  return [
    { label: 'Visitors', value: c.visitors.toLocaleString(), change: p ? pctChange(c.visitors, p.visitors) : null, icon: Users },
    { label: 'Page views', value: c.pageviews.toLocaleString(), change: p ? pctChange(c.pageviews, p.pageviews) : null, icon: Eye },
    { label: 'Avg. time on page', value: formatDuration(c.seconds_on_page || 0), change: p ? pctChange(c.seconds_on_page, p.seconds_on_page) : null, icon: Clock },
  ];
});

// ─── Visitor journey funnel ─────────────────────────────────────────────────

const funnel = computed(() => {
  if (!current.value) return [];
  const totalVisitors = current.value.visitors || 1;
  const pages = current.value.pages || [];

  const exploredVisitors = pages
    .filter(p => p.value !== '/' && !internalRoutes.includes(p.value))
    .reduce((sum, p) => sum + (p.visitors || 0), 0);

  const conversionVisitors = pages.find(p => p.value === conversionPage)?.visitors ?? 0;

  return [
    { label: 'Visited your site', count: totalVisitors, pct: 100, color: 'var(--color-primary)' },
    { label: 'Explored a page', count: Math.min(exploredVisitors, totalVisitors), pct: Math.round((Math.min(exploredVisitors, totalVisitors) / totalVisitors) * 100), color: 'var(--color-secondary)' },
    { label: `Reached ${conversionLabel}`, count: conversionVisitors, pct: Math.round((conversionVisitors / totalVisitors) * 100), color: 'var(--color-accent)' },
  ];
});

// ─── Top pages ──────────────────────────────────────────────────────────────

const sortedPages = computed(() => {
  if (!current.value) return [];
  const pages = current.value.pages || [];
  const external = pages
    .filter(p => !internalRoutes.includes(p.value))
    .sort((a, b) => (b.visitors || 0) - (a.visitors || 0));
  const internal = pages
    .filter(p => internalRoutes.includes(p.value))
    .sort((a, b) => (b.visitors || 0) - (a.visitors || 0));
  return [...external, ...internal];
});

const maxPageVisitors = computed(() => {
  const external = sortedPages.value.filter(p => !internalRoutes.includes(p.value));
  return external.length > 0 ? Math.max(...external.map(p => p.visitors || 0)) : 1;
});

// ─── Insight card ───────────────────────────────────────────────────────────

const insightText = computed(() => {
  if (!current.value) return '';
  const pages = current.value.pages || [];
  const totalVisitors = current.value.visitors || 0;
  const homepageVisitors = pages.find(p => p.value === '/')?.visitors ?? 0;
  const conversionVisitors = pages.find(p => p.value === conversionPage)?.visitors ?? 0;
  const change = visitorChange.value;

  const homepagePct = totalVisitors > 0 ? homepageVisitors / totalVisitors : 0;
  const conversionPct = totalVisitors > 0 ? conversionVisitors / totalVisitors : 0;

  if (homepagePct > 0.9 && conversionPct < 0.05) {
    return `Over 9 in 10 visitors left from your homepage without going further. Adding a clear '${conversionLabel}' button to your homepage could help more people find their way.`;
  }
  if (change < -10) {
    return "Traffic dipped this period — this often happens after a quiet spell in posting or outreach. Sharing a recent update or story on social media can bring people back.";
  }
  if (change > 50) {
    return `Your traffic is growing — great time to make sure visitors know what to do when they arrive. Is your '${conversionLabel}' page easy to find?`;
  }
  return "Consistent, genuine outreach tends to compound over time. Even one new post or updated page per month keeps your site active in search results.";
});

// ─── Referrers ──────────────────────────────────────────────────────────────

interface ReferrerDisplay {
  name: string;
  desc: string;
  visitors: number;
}

const referrerRows = computed<ReferrerDisplay[]>(() => {
  if (!current.value) return [];
  return (current.value.referrers || []).map(r => {
    const v = (r.value || '').toLowerCase();
    if (!v || v === 'direct' || v === '(direct)') {
      return { name: 'Direct / typed your URL', desc: 'Existing contacts, bookmarks, or word of mouth', visitors: r.visitors };
    }
    if (v.includes('google')) return { name: 'Google Search', desc: 'Someone searched and found you', visitors: r.visitors };
    if (v.includes('facebook')) return { name: 'Facebook', desc: 'A post or profile link', visitors: r.visitors };
    if (v.includes('instagram')) return { name: 'Instagram', desc: 'A post or bio link', visitors: r.visitors };
    const cleaned = r.value.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return { name: cleaned, desc: '', visitors: r.visitors };
  });
});

// ─── Bar chart ──────────────────────────────────────────────────────────────

function renderChart() {
  if (!chartCanvas.value || !current.value) return;

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#0d9488';

  // Real per-day or per-month visitor counts.
  const monthly = PERIOD_INTERVAL[period.value] === 'month';
  const labels = chartBuckets.value.map((b) =>
    bucketDate(b.date).toLocaleDateString('en-US', monthly ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' }),
  );
  const data = chartBuckets.value.map((b) => b.visitors);

  chartInstance = new Chart(chartCanvas.value, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: primaryColor,
        borderRadius: 4,
        barPercentage: 0.6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} ${ctx.parsed.y === 1 ? 'visitor' : 'visitors'}` } },
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
          // Level labels, thinned to fit, read better than 30 slanted ones
          ticks: { font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
        },
        y: { display: false },
      },
    },
  });
}

watch(period, () => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});

// The bars take the brand color when drawn; redraw when the theme flips.
const themeWatcher = new MutationObserver(() => renderChart());

onMounted(() => {
  themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  fetchAnalytics();
});
onBeforeUnmount(() => {
  themeWatcher.disconnect();
  chartInstance?.destroy();
});
</script>

<template>
  <DashboardLayout page-title="Site Analytics">
    <div class="ana">
      <!-- Period selector -->
      <div class="ana__periods">
        <button
          v-for="(label, key) in PERIOD_LABELS"
          :key="key"
          class="ana__period"
          :class="{ 'ana__period--active': period === key }"
          @click="changePeriod(key)"
        >
          {{ label }}
        </button>
      </div>

      <!-- Loading skeleton -->
      <template v-if="loading">
        <div class="ana__skeleton ana__skeleton--story"></div>
        <div class="ana__skeleton ana__skeleton--chart"></div>
        <div class="ana__skeleton-grid">
          <div class="ana__skeleton ana__skeleton--card"></div>
          <div class="ana__skeleton ana__skeleton--card"></div>
          <div class="ana__skeleton ana__skeleton--card"></div>
        </div>
      </template>

      <!-- Error -->
      <div v-else-if="error" class="ana__error">
        <p class="ana__error-msg">Couldn't load analytics data</p>
        <button class="ana__error-btn" @click="fetchAnalytics">
          <RefreshCw :size="14" /> Try again
        </button>
      </div>

      <!-- Data -->
      <template v-else-if="current">
        <!-- Story card -->
        <div class="ana__story">
          <p class="ana__story-headline">{{ storyHeadline }}</p>
          <p class="ana__story-sub">{{ storySubline }}</p>
        </div>

        <!-- Visitors over time (real daily or monthly counts) -->
        <div v-if="period !== 'today' && chartBuckets.length > 0" class="ana__chart-section">
          <p class="ana__section-label">{{ PERIOD_INTERVAL[period] === 'month' ? 'Visitors by month' : 'Visitors by day' }}</p>
          <div class="ana__chart-wrap">
            <canvas ref="chartCanvas"></canvas>
          </div>
        </div>

        <!-- Metric cards -->
        <div class="ana__metrics">
          <div v-for="card in metricCards" :key="card.label" class="ana__metric">
            <div class="ana__metric-header">
              <component :is="card.icon" :size="16" class="ana__metric-icon" />
              <span class="ana__metric-label">{{ card.label }}</span>
            </div>
            <p class="ana__metric-value">{{ card.value }}</p>
            <div
              v-if="card.change !== null"
              class="ana__metric-trend"
              :class="{
                'ana__metric-trend--up': trendDirection(card.change) === 'up',
                'ana__metric-trend--down': trendDirection(card.change) === 'down',
              }"
            >
              <TrendingUp v-if="trendDirection(card.change) === 'up'" :size="14" />
              <TrendingDown v-else-if="trendDirection(card.change) === 'down'" :size="14" />
              <Minus v-else :size="14" />
              <span>{{ trendLabel(trendDirection(card.change)) }}</span>
            </div>
          </div>
        </div>

        <!-- Visitor journey funnel -->
        <div v-if="current.visitors > 0" class="ana__funnel">
          <p class="ana__section-label">Visitor journey</p>
          <div v-for="step in funnel" :key="step.label" class="ana__funnel-row">
            <span class="ana__funnel-label">{{ step.label }}</span>
            <div class="ana__funnel-track">
              <div
                class="ana__funnel-fill"
                :style="{ width: `clamp(36px, ${step.pct}%, 100%)`, backgroundColor: step.color }"
              ></div>
            </div>
            <span class="ana__funnel-pct">{{ step.pct }}%</span>
          </div>
        </div>

        <!-- Top pages -->
        <div class="ana__pages">
          <div class="ana__pages-header">
            <p class="ana__section-label">Top pages — real visitors only</p>
            <button class="ana__toggle" @click="showInternal = !showInternal">
              {{ showInternal ? 'Hide your activity' : 'Show your own activity' }}
            </button>
          </div>
          <div class="ana__pages-list">
            <div
              v-for="page in sortedPages"
              :key="page.value"
              class="ana__page-row"
              :class="{ 'ana__page-row--internal': internalRoutes.includes(page.value) }"
              :style="{ display: internalRoutes.includes(page.value) && !showInternal ? 'none' : undefined }"
            >
              <span class="ana__page-path">
                {{ page.value }}
                <span v-if="internalRoutes.includes(page.value)" class="ana__page-badge">(you)</span>
              </span>
              <div class="ana__page-bar-track">
                <div
                  class="ana__page-bar-fill"
                  :style="{ width: `${maxPageVisitors > 0 ? Math.max(2, ((page.visitors || 0) / maxPageVisitors) * 100) : 0}%` }"
                ></div>
              </div>
              <span class="ana__page-count">{{ (page.visitors || 0).toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <!-- Insight card -->
        <div class="ana__insight">
          <div class="ana__insight-dot"></div>
          <div>
            <p class="ana__insight-heading">What to focus on this month</p>
            <p class="ana__insight-text">{{ insightText }}</p>
          </div>
        </div>

        <!-- Referrers -->
        <div class="ana__referrers">
          <p class="ana__section-label">How people found you</p>
          <div v-if="referrerRows.length === 0" class="ana__referrers-empty">No referrer data for this period.</div>
          <div v-for="row in referrerRows" :key="row.name" class="ana__referrer-row">
            <div class="ana__referrer-info">
              <span class="ana__referrer-name">{{ row.name }}</span>
              <span v-if="row.desc" class="ana__referrer-desc">{{ row.desc }}</span>
            </div>
            <span class="ana__referrer-count">{{ row.visitors.toLocaleString() }}</span>
          </div>
        </div>
      </template>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.ana { max-width: 720px; }

/* ─── Period selector ─────────────────────────────────────────────────────── */
.ana__periods {
  display: flex; gap: 0.25rem; background-color: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--border-radius);
  padding: 0.25rem; width: fit-content; max-width: 100%; margin-bottom: 1.5rem;
  /* Five ranges no longer fit one row on a phone */
  flex-wrap: wrap;
}
.ana__period {
  padding: 0.375rem 0.75rem; font-size: 0.8125rem; font-weight: 500;
  border: none; border-radius: calc(var(--border-radius) - 2px); background: none;
  color: var(--color-text-secondary, var(--color-text)); cursor: pointer; transition: all 0.15s ease;
}
.ana__period--active { background-color: var(--color-primary); color: var(--color-text-inverse); }

/* ─── Loading skeletons ───────────────────────────────────────────────────── */
.ana__skeleton { background-color: var(--color-surface); border-radius: var(--border-radius); animation: pulse 1.5s ease-in-out infinite; }
.ana__skeleton--story { height: 80px; margin-bottom: 1rem; }
.ana__skeleton--chart { height: 90px; margin-bottom: 1rem; }
.ana__skeleton--card { height: 100px; }
.ana__skeleton-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* ─── Error ───────────────────────────────────────────────────────────────── */
.ana__error {
  text-align: center; padding: 3rem; background-color: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--border-radius);
}
.ana__error-msg { font-size: 0.9375rem; color: var(--color-text); margin-bottom: 1rem; }
.ana__error-btn {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.5rem 1rem; background-color: var(--color-primary); color: var(--color-text-inverse);
  border: none; border-radius: var(--border-radius); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
}

/* ─── Story card ──────────────────────────────────────────────────────────── */
.ana__story {
  border-left: 3px solid var(--color-primary); background-color: var(--color-surface);
  padding: 1.25rem 1.5rem; border-radius: var(--border-radius); margin-bottom: 1.5rem;
}
.ana__story-headline { font-size: 1.125rem; font-weight: 500; color: var(--color-text); line-height: 1.5; }
.ana__story-sub { font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); margin-top: 0.375rem; }

/* ─── Chart ───────────────────────────────────────────────────────────────── */
.ana__chart-section { margin-bottom: 1.5rem; }
.ana__chart-wrap { height: 90px; }

/* ─── Metrics ─────────────────────────────────────────────────────────────── */
.ana__metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
.ana__metric {
  background-color: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--border-radius); padding: 1rem;
}
.ana__metric-header { display: flex; align-items: center; gap: 0.375rem; margin-bottom: 0.375rem; }
.ana__metric-icon { color: var(--color-text-secondary, var(--color-text)); }
.ana__metric-label { font-size: 0.6875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary, var(--color-text)); }
.ana__metric-value { font-size: 1.5rem; font-weight: 700; color: var(--color-text); font-family: var(--font-heading); }
.ana__metric-trend { display: flex; align-items: center; gap: 0.25rem; margin-top: 0.25rem; font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); }
.ana__metric-trend--up { color: var(--color-success); }
.ana__metric-trend--down { color: var(--color-danger); }

/* ─── Funnel ──────────────────────────────────────────────────────────────── */
.ana__funnel { margin-bottom: 1.5rem; }
.ana__funnel-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.ana__funnel-label { font-size: 0.8125rem; color: var(--color-text); min-width: 140px; flex-shrink: 0; }
.ana__funnel-track { flex: 1; height: 20px; background-color: var(--color-surface); border-radius: 4px; overflow: hidden; border: 1px solid var(--color-border); }
.ana__funnel-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
.ana__funnel-pct { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); min-width: 36px; text-align: right; }

/* ─── Top pages ───────────────────────────────────────────────────────────── */
.ana__pages { margin-bottom: 1.5rem; }
.ana__pages-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
.ana__toggle { font-size: 0.75rem; font-weight: 500; color: var(--color-primary); background: none; border: none; cursor: pointer; }
.ana__toggle:hover { text-decoration: underline; }
.ana__pages-list { display: flex; flex-direction: column; gap: 0.375rem; }
.ana__page-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; background-color: var(--color-surface); border-radius: var(--border-radius); }
.ana__page-row--internal { opacity: 0.4; }
.ana__page-path { font-family: monospace; font-size: 0.8125rem; color: var(--color-text); min-width: 140px; flex-shrink: 0; }
.ana__page-badge { font-family: var(--font-body); font-size: 0.6875rem; color: var(--color-text-secondary, var(--color-text)); margin-left: 0.25rem; }
.ana__page-bar-track { flex: 1; height: 8px; background-color: var(--color-border); border-radius: 4px; overflow: hidden; }
.ana__page-bar-fill { height: 100%; background-color: var(--color-primary); border-radius: 4px; transition: width 0.3s ease; }
.ana__page-count { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); min-width: 32px; text-align: right; }

/* ─── Insight ─────────────────────────────────────────────────────────────── */
.ana__insight {
  display: flex; gap: 0.75rem; padding: 1.25rem;
  background-color: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--border-radius); margin-bottom: 1.5rem;
}
.ana__insight-dot { width: 8px; height: 8px; border-radius: 50%; background-color: var(--color-warning); margin-top: 0.375rem; flex-shrink: 0; }
.ana__insight-heading { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.25rem; }
.ana__insight-text { font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); line-height: 1.6; }

/* ─── Referrers ───────────────────────────────────────────────────────────── */
.ana__referrers { margin-bottom: 1.5rem; }
.ana__referrers-empty { font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); padding: 1rem 0; }
.ana__referrer-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 0; border-bottom: 1px solid var(--color-border);
}
.ana__referrer-info { display: flex; flex-direction: column; gap: 0.125rem; }
.ana__referrer-name { font-size: 0.875rem; font-weight: 500; color: var(--color-text); }
.ana__referrer-desc { font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); }
.ana__referrer-count { font-size: 0.875rem; font-weight: 600; color: var(--color-text); }

/* ─── Section label ───────────────────────────────────────────────────────── */
.ana__section-label {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-secondary, var(--color-text)); margin-bottom: 0.75rem;
}

/* ─── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .ana__metrics { grid-template-columns: 1fr; }
  .ana__funnel-label { min-width: 100px; font-size: 0.75rem; }
  .ana__page-path { min-width: 100px; }
}
</style>
