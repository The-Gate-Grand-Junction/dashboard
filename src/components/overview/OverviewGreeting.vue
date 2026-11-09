<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuth0 } from '@auth0/auth0-vue';
import { Globe, PenLine, MessageSquare } from 'lucide-vue-next';
import config from '@/config/dashboard';

const { user } = useAuth0();

const firstName = computed(() => (user.value?.given_name ?? user.value?.name ?? '').trim().split(/\s+/)[0] || '');

const greeting = computed(() => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
});

const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/** The configured links, worded as things to do rather than places to go. */
const actions = computed(() =>
  config.links.map((link) => {
    const isEditor = /studio|sanity|cms/i.test(`${link.label} ${link.url}`);
    return {
      url: link.url,
      label: isEditor ? 'Edit website content' : /live|site/i.test(link.label) ? 'View website' : link.label,
      icon: isEditor ? PenLine : Globe,
    };
  })
);
</script>

<template>
  <header class="greet">
    <div>
      <h2 class="greet__title">{{ greeting }}<template v-if="firstName">, {{ firstName }}</template></h2>
      <p class="greet__sub">{{ today }} · Here's how {{ config.clientName }}'s website is doing.</p>
    </div>
    <nav class="greet__actions" aria-label="Quick actions">
      <a v-for="action in actions" :key="action.url" :href="action.url" target="_blank" rel="noopener noreferrer" class="greet__btn">
        <component :is="action.icon" :size="16" aria-hidden="true" />
        {{ action.label }}<span class="sr-only"> (opens in a new tab)</span>
      </a>
      <RouterLink to="/support" class="greet__btn greet__btn--primary">
        <MessageSquare :size="16" aria-hidden="true" />
        Request a change
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.greet { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem 2rem; }
.greet__title { font-family: var(--font-heading); font-size: clamp(1.5rem, 1.2rem + 1vw, 2rem); font-weight: 700; color: var(--color-text); }
.greet__sub { margin-top: 0.25rem; font-size: 0.9375rem; color: var(--color-text-secondary); }
.greet__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.greet__btn {
  display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.55rem 0.9rem;
  border: 1px solid var(--color-border); border-radius: 999px; background-color: var(--color-surface);
  box-shadow: var(--shadow-card); color: var(--color-text); font-size: 0.875rem; font-weight: 600;
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.greet__btn:hover { border-color: var(--color-primary); }
.greet__btn--primary { background-color: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); }
@media (prefers-reduced-motion: no-preference) {
  .greet__btn:hover { transform: translateY(-1px); }
}
</style>
