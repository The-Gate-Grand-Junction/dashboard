<script setup lang="ts">
import { ref } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  MessageSquare,
  CreditCard,
  FileBarChart,
  Video,
  Mail,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next';
import config from '@/config/dashboard';

const showAnalytics = config.enabledWidgets.includes('siteAnalytics');
const showContentKit = config.contentKit?.enabled === true;
const showBilling = config.billing?.enabled === true;
const reviewCadence = config.reports?.reviewCadence ?? 'annual';
const showTutorials = config.enabledWidgets.includes('tutorials') && config.tutorialVideos.length > 0;

const expanded = ref<Record<string, boolean>>({
  overview: true,
  reports: false,
  analytics: false,
  contentKit: false,
  billing: false,
  support: false,
  tutorials: false,
  troubleshooting: false,
});

function toggle(key: string) {
  expanded.value[key] = !expanded.value[key];
}
</script>

<template>
  <DashboardLayout page-title="Help & How-To">
    <div class="help">
      <p class="help__intro">
        Welcome to your dashboard. This page explains what each section does and
        how to use it. Still stuck? Head to <strong>Contact &amp; Support</strong>
        and send a message — we aim to reply within one business day.
      </p>

      <!-- Overview -->
      <section class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.overview" @click="toggle('overview')">
          <LayoutDashboard :size="20" />
          <span class="help__title">Overview (the home page)</span>
          <component :is="expanded.overview ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.overview" class="help__body">
          <p>
            Your dashboard's home page. Shows at-a-glance widgets:
          </p>
          <ul>
            <li><strong>Quick actions</strong> to view your website, edit its content, or request a change.</li>
            <li><strong>Anything waiting on you</strong>, such as an unpaid invoice.</li>
            <li v-if="showAnalytics"><strong>A snapshot of your site traffic</strong> — the full chart lives on the Analytics page.</li>
            <li><strong>Last month's report</strong> at a glance, plus your site's latest speed and quality scores — every month lives on the Monthly Reports page.</li>
            <li v-if="showTutorials"><strong>Tutorial videos</strong> we've added for your site.</li>
          </ul>
          <p>Use the sidebar on the left to jump to any section.</p>
        </div>
      </section>

      <!-- Reports -->
      <section class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.reports" @click="toggle('reports')">
          <FileBarChart :size="20" />
          <span class="help__title">Monthly Reports</span>
          <component :is="expanded.reports ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.reports" class="help__body">
          <p>
            A report on how your website did, written automatically early each month
            for the month just ended and kept here so you can come back to it any time.
          </p>
          <ul>
            <li>
              <strong>What's in each report:</strong> the month in a few plain sentences,
              visits compared with the month before, the pages people looked at most,
              how people found your site, and Google's speed and quality test of your homepage.
            </li>
            <li>
              <strong>From your web team:</strong>
              <template v-if="reviewCadence === 'monthly'">
                each month we add a short write-up of the work done, anything unusual in the
                numbers, and what comes next.
              </template>
              <template v-else>
                once a year we do a full review of your site, add our notes to that month's
                report, and check in with you by email.
              </template>
            </li>
            <li>
              <strong>Older reports</strong> stay available — use the month selector at the
              top of the Monthly Reports page to look back through your history.
            </li>
            <li>
              <strong>Print or save as PDF</strong> from the button on the report to share it.
            </li>
          </ul>
          <p class="help__note">
            If something in a report needs action from you, we'll reach out directly.
            You never have to interpret the numbers on your own.
          </p>
        </div>
      </section>

      <!-- Analytics -->
      <section v-if="showAnalytics" class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.analytics" @click="toggle('analytics')">
          <BarChart3 :size="20" />
          <span class="help__title">Analytics</span>
          <component :is="expanded.analytics ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.analytics" class="help__body">
          <p>
            Shows how many people are visiting your site and what they're looking at.
            Numbers refresh roughly every 24 hours.
          </p>
          <ul>
            <li><strong>Visitors</strong> — unique people who came to the site in the selected window.</li>
            <li><strong>Page views</strong> — total page loads; one visitor can view several pages.</li>
            <li><strong>Top pages</strong> — which pages are getting the most attention. Useful for deciding what to feature or expand.</li>
            <li><strong>Referrers</strong> — where visitors came from (Google, Facebook, a direct link, etc.).</li>
          </ul>
          <p class="help__note">
            If the chart is empty for a new site, it's because analytics needs 24–48 hours to collect first data after launch.
          </p>
        </div>
      </section>

      <!-- Content Kit -->
      <section v-if="showContentKit" class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.contentKit" @click="toggle('contentKit')">
          <ClipboardList :size="20" />
          <span class="help__title">Content Kit</span>
          <component :is="expanded.contentKit ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.contentKit" class="help__body">
          <p>
            Where you tell us about your business so the content on your site stays
            accurate — hours, offerings, team, service areas, brand voice. Changes
            you save here feed into site updates and future content work.
          </p>
          <ul>
            <li>Progress is auto-saved per section — safe to close the tab and come back.</li>
            <li>The completion percentage at the top tracks how much of the kit is filled in.</li>
            <li>Not every field is required — fill in what applies and skip what doesn't.</li>
          </ul>
          <p>
            After you make substantial changes, send a note via <strong>Contact &amp; Support</strong>
            so we know to review and apply them to the live site.
          </p>
        </div>
      </section>

      <!-- Billing -->
      <section v-if="showBilling" class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.billing" @click="toggle('billing')">
          <CreditCard :size="20" />
          <span class="help__title">Billing</span>
          <component :is="expanded.billing ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.billing" class="help__body">
          <p>Your invoice history and current billing status.</p>
          <ul>
            <li><strong>Paid invoices</strong> — everything settled, with amounts and dates.</li>
            <li><strong>Open or pending</strong> — anything that still needs action from you.</li>
            <li><strong>Credits</strong> — any prepayment or referral credit on your account that will be applied against the next invoice.</li>
          </ul>
          <p class="help__note">
            To update the card we charge or switch payment methods, send a request through
            Contact &amp; Support — we don't ask you to enter card details on this page.
          </p>
        </div>
      </section>

      <!-- Support -->
      <section class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.support" @click="toggle('support')">
          <MessageSquare :size="20" />
          <span class="help__title">Contact &amp; Support</span>
          <component :is="expanded.support ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.support" class="help__body">
          <p>Your primary way to reach us. Use the form on the Support page for anything that's not urgent — we aim to reply within one business day.</p>
          <ul>
            <li><strong>Bug report</strong> — something is broken (link doesn't work, image missing, form won't submit).</li>
            <li><strong>Update request</strong> — change wording, swap a photo, update hours, add a page.</li>
            <li><strong>Question</strong> — not sure what to do, want our take on something.</li>
            <li><strong>Other</strong> — anything that doesn't fit the above.</li>
          </ul>
          <p class="help__note">
            For time-sensitive issues (site down, payment problem, security concern), send the request
            with "URGENT" in the subject and we'll prioritize it.
          </p>
        </div>
      </section>

      <!-- Tutorial videos (shown only if configured) -->
      <section v-if="showTutorials" class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.tutorials" @click="toggle('tutorials')">
          <Video :size="20" />
          <span class="help__title">Tutorial videos</span>
          <component :is="expanded.tutorials ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.tutorials" class="help__body">
          <p>Walk-throughs we've recorded for your site. Open any one in a new tab:</p>
          <ul>
            <li v-for="video in config.tutorialVideos" :key="video.url">
              <a :href="video.url" target="_blank" rel="noopener">{{ video.title }}</a>
            </li>
          </ul>
        </div>
      </section>

      <!-- Troubleshooting -->
      <section class="help__section">
        <button type="button" class="help__header" :aria-expanded="expanded.troubleshooting" @click="toggle('troubleshooting')">
          <Mail :size="20" />
          <span class="help__title">Troubleshooting</span>
          <component :is="expanded.troubleshooting ? ChevronDown : ChevronRight" :size="18" class="help__chevron" />
        </button>
        <div v-if="expanded.troubleshooting" class="help__body">
          <dl class="help__faq">
            <dt>I can't log in.</dt>
            <dd>
              Make sure you're using the email address your project was set up under
              (if your transition email names a specific login email, use that one).
              If the login page keeps looping, clear cookies for this site and try again.
            </dd>

            <dt>I made changes in Content Kit but don't see them on my site.</dt>
            <dd>
              Content Kit stores your inputs — it doesn't push them to the live site automatically.
              Send a note via Support when you're ready for us to apply updates. We'll review,
              clean up anything that needs it, and publish.
            </dd>

            <dt v-if="showAnalytics">The Analytics page is empty.</dt>
            <dd v-if="showAnalytics">
              Analytics needs 24–48 hours after launch to begin collecting data. If the site has been
              live longer than that and you still see nothing, let us know via Support.
            </dd>

            <dt>I got an invoice but think the amount is wrong.</dt>
            <dd>
              Reply to the invoice email with the question, or send a note via Support with the
              invoice number. We'll pull it up and get you an answer same-day.
            </dd>

            <dt>How do I update my brand (colors, logo, fonts)?</dt>
            <dd>
              Send the updated assets via Support. We maintain your brand kit on our side so it
              stays consistent across your site and any future work.
            </dd>
          </dl>
        </div>
      </section>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.help {
  max-width: 820px;
  margin: 0 auto;
  padding: 1rem 0;
}

.help__intro {
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.9375rem;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.help__section {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.help__header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text);
  text-align: left;
  font-size: 0.9375rem;
  font-weight: 600;
  font-family: var(--font-heading);
}

.help__header:hover {
  background-color: var(--color-border);
}

.help__title {
  flex: 1;
}

.help__chevron {
  color: var(--color-text-secondary, var(--color-text));
  flex-shrink: 0;
}

.help__body {
  padding: 0 1.25rem 1.25rem 1.25rem;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.65;
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}

.help__body ul {
  padding-left: 1.25rem;
  margin: 0.5rem 0;
}

.help__body li {
  margin: 0.4rem 0;
}

.help__body p {
  margin: 0.5rem 0;
}

.help__body a {
  color: var(--color-primary);
}

.help__note {
  background-color: var(--color-border);
  border-left: 3px solid var(--color-primary);
  padding: 0.75rem 1rem;
  border-radius: 0 var(--border-radius) var(--border-radius) 0;
  font-size: 0.875rem;
  margin-top: 0.75rem;
}

.help__faq dt {
  font-weight: 600;
  color: var(--color-text);
  margin-top: 1rem;
}

.help__faq dt:first-child {
  margin-top: 0;
}

.help__faq dd {
  margin: 0.25rem 0 0 0;
  color: var(--color-text-secondary, var(--color-text));
}
</style>
