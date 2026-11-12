<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { Inbox } from 'lucide-vue-next';
import type { SubmissionSummary } from '@/composables/useOverview';
import { kindLabel } from '@/lib/submissions';

defineProps<{ submissions: SubmissionSummary | null; loaded: boolean }>();


function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const initials = (name: string | null, email: string | null) =>
  (name || email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
</script>

<template>
  <section class="card" aria-labelledby="recent-title">
    <div class="card__head">
      <h2 id="recent-title" class="card__title"><Inbox :size="18" aria-hidden="true" /> Latest submissions</h2>
      <RouterLink to="/submissions" class="card__link">View all &rarr;</RouterLink>
    </div>

    <p v-if="!loaded" class="card__empty" role="status">Loading…</p>
    <p v-else-if="!submissions?.recent.length" class="card__empty">Nothing yet. Messages sent through your website will appear here.</p>

    <ul v-else class="recent">
      <li v-for="item in submissions.recent" :key="item.id">
        <RouterLink :to="`/submissions?kind=${item.kind}`" class="recent__row">
          <span class="recent__avatar" :class="`recent__avatar--${item.kind}`" aria-hidden="true">{{ initials(item.name, item.email) }}</span>
          <span class="recent__main">
            <span class="recent__name">
              {{ item.name || item.email || 'No name given' }}
              <span v-if="item.status === 'new'" class="recent__new">New</span>
            </span>
            <span class="recent__meta">{{ kindLabel(item.kind) }} · {{ ago(item.createdAt) }}</span>
          </span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recent { list-style: none; display: flex; flex-direction: column; }
.recent li + li { border-top: 1px solid var(--color-border); }
.recent__row { display: flex; align-items: center; gap: 0.75rem; padding: 0.65rem 0.25rem; color: var(--color-text); border-radius: var(--border-radius); }
.recent__row:hover { background-color: var(--color-bg); }
.recent__avatar {
  display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex-shrink: 0; border-radius: 50%;
  font-size: 0.75rem; font-weight: 700; background-color: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary);
}
.recent__avatar--application { background-color: rgba(214, 166, 22, 0.18); color: var(--color-warn); }
.recent__main { display: flex; flex-direction: column; min-width: 0; }
.recent__name { display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; font-weight: 600; overflow-wrap: anywhere; }
.recent__new { padding: 0 0.4rem; border-radius: 999px; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background-color: var(--color-secondary); color: var(--color-text-inverse); }
.recent__meta { font-size: 0.8125rem; color: var(--color-text-secondary); }
</style>
