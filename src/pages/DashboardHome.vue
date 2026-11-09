<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { Info, CheckCircle2, AlertTriangle, XOctagon, ExternalLink, ArrowRight } from 'lucide-vue-next';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import OverviewGreeting from '@/components/overview/OverviewGreeting.vue';
import AttentionStrip from '@/components/overview/AttentionStrip.vue';
import MonthToDate from '@/components/overview/MonthToDate.vue';
import SiteHealth from '@/components/overview/SiteHealth.vue';
import RecentSubmissions from '@/components/overview/RecentSubmissions.vue';
import WebTeamCard from '@/components/overview/WebTeamCard.vue';
import { hasInbox } from '@/lib/submissions';
import MonthlyReportWidget from '@/components/widgets/MonthlyReportWidget.vue';
import TutorialsWidget from '@/components/widgets/TutorialsWidget.vue';
import ContentEditorWidget from '@/components/widgets/ContentEditorWidget.vue';
import { useOverview } from '@/composables/useOverview';
import config from '@/config/dashboard';

/**
 * The page the client lands on, read top to bottom (docs/OVERVIEW-STANDARD.md):
 *
 *   1. who it's for, and the things they came to do (greeting, quick actions)
 *   2. anything waiting on them (new submissions, an unpaid invoice)
 *   3. how this month is going, live
 *   4. how last month went, settled (the monthly report)
 *   …with the site's health alongside.
 *
 * Latest website messages sit in the side column when the dashboard has an
 * inbox (config.submissionKinds). The Links and analytics widgets used to sit here; their content
 * now lives in the greeting's actions and the month-so-far card.
 */
const {
  month, monthState, charges, chargesLoaded, lighthouse, healthLoaded, submissions, submissionsLoaded, webTeam, webTeamState, load,
} = useOverview();
const inbox = hasInbox();

/** Optional extras; none are enabled for this client today. */
const extras = computed(() =>
  [
    config.enabledWidgets.includes('tutorials') ? TutorialsWidget : null,
    config.enabledWidgets.includes('contentEditors') ? ContentEditorWidget : null,
  ].filter(Boolean)
);

const announcementIconMap = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: XOctagon } as const;

// The first banner whose date window includes today (viewer's local date).
const today = new Intl.DateTimeFormat('en-CA').format(new Date());
const announcement = computed(
  () =>
    (config.announcements ?? []).find(
      (a) => (!a.showFrom || today >= a.showFrom) && (!a.showUntil || today <= a.showUntil),
    ) ?? null,
);
const announcementIcon = computed(() => announcementIconMap[announcement.value?.level || 'info']);

// A /path stays in the dashboard; anything else opens in a new tab.
const isInternalLink = computed(() => {
  const url = announcement.value?.link?.url || '';
  return url.startsWith('/') && !url.startsWith('//');
});

onMounted(load);
</script>

<template>
  <DashboardLayout page-title="Overview">
    <div class="overview">
      <OverviewGreeting />

      <div
        v-if="announcement"
        class="overview__banner"
        :class="`overview__banner--${announcement.level || 'info'}`"
        role="status"
      >
        <component :is="announcementIcon" :size="18" class="overview__banner-icon" aria-hidden="true" />
        <span class="overview__banner-msg">{{ announcement.message }}</span>
        <RouterLink v-if="announcement.link && isInternalLink" :to="announcement.link.url" class="overview__banner-link">
          {{ announcement.link.label }} <ArrowRight :size="12" aria-hidden="true" />
        </RouterLink>
        <a v-else-if="announcement.link" :href="announcement.link.url" target="_blank" rel="noopener" class="overview__banner-link">
          {{ announcement.link.label }} <ExternalLink :size="12" aria-hidden="true" />
          <span class="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <AttentionStrip :submissions="submissions" :charges="charges" :loaded="chargesLoaded && submissionsLoaded" />

      <div class="overview__columns">
        <div class="overview__main">
          <MonthToDate :month="month" :state="monthState" :this-month="submissions?.thisMonth ?? null" />
          <MonthlyReportWidget />
        </div>
        <aside class="overview__side" aria-label="Latest submissions, your web team and site health">
          <RecentSubmissions v-if="inbox" :submissions="submissions" :loaded="submissionsLoaded" />
          <WebTeamCard v-if="webTeamState !== 'none'" :web-team="webTeam" :state="webTeamState" />
          <SiteHealth :lighthouse="lighthouse" :loaded="healthLoaded" />
        </aside>
      </div>

      <div v-if="extras.length" class="overview__extras">
        <component :is="extra" v-for="(extra, i) in extras" :key="i" />
      </div>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 1.5rem; max-width: 1400px; }
.overview__columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.overview__main, .overview__side { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.overview__extras { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }

@media (min-width: 1180px) {
  .overview__columns { grid-template-columns: minmax(0, 1.7fr) minmax(320px, 1fr); }
}

/* Banner: tinted by level over whichever theme is showing */
.overview__banner {
  display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem; padding: 0.75rem 1rem;
  border: 1px solid; border-radius: var(--border-radius); font-size: 0.875rem; line-height: 1.4; color: var(--color-text);
}
.overview__banner-icon { flex-shrink: 0; }
.overview__banner-msg { flex: 1; min-width: 12rem; }
.overview__banner-link {
  display: inline-flex; align-items: center; gap: 0.3rem; flex-shrink: 0; padding-bottom: 1px;
  font-weight: 500; color: inherit; text-decoration: none; border-bottom: 1px solid currentColor;
}
.overview__banner-link:hover { opacity: 0.85; }
.overview__banner--info { background: color-mix(in srgb, var(--color-primary) 8%, transparent); border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); }
.overview__banner--success { background: color-mix(in srgb, #059669 10%, transparent); border-color: color-mix(in srgb, #059669 35%, transparent); }
.overview__banner--warning { background: color-mix(in srgb, #d97706 12%, transparent); border-color: color-mix(in srgb, #d97706 40%, transparent); }
.overview__banner--critical { background: color-mix(in srgb, #dc2626 12%, transparent); border-color: color-mix(in srgb, #dc2626 40%, transparent); }
</style>
