<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  Inbox, Search, Paperclip, Mail, Phone, Download, Trash2, ArrowLeft, RefreshCw, Loader2, FileDown,
} from 'lucide-vue-next';
import { useApi } from '@/composables/useApi';
import { formatPhone } from '@/lib/format';
import config from '@/config/dashboard';
import { kindLabel } from '@/lib/submissions';

/** Kinds come from the dashboard config (contact, application, …); 'other' catches the rest. */
type Kind = string;
type Status = 'new' | 'in_progress' | 'done' | 'archived';

interface Field { label: string; name: string; value: string }
interface Summary {
  id: string;
  kind: Kind;
  formTitle: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  fields: Field[];
  status: Status;
  notes: string;
  createdAt: string;
  fileCount: number;
}
interface Attachment { id: string; filename: string; contentType: string | null; size: number }
interface Detail extends Summary { pagePath: string | null; files: Attachment[] }

const api = useApi();

const KINDS = config.submissionKinds ?? [];
// One tab per configured kind; a single kind needs no tabs beyond "All".
const KIND_TABS: { key: Kind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(KINDS.length > 1 ? KINDS.map((k) => ({ key: k.kind, label: k.many.charAt(0).toUpperCase() + k.many.slice(1) })) : []),
];
const KIND_LABELS = new Proxy({} as Record<Kind, string>, { get: (_, key) => kindLabel(String(key)) });
const STATUS_LABELS: Record<Status, string> = { new: 'New', in_progress: 'In progress', done: 'Done', archived: 'Archived' };
const STATUS_FILTERS: { key: Status | 'open' | 'all'; label: string }[] = [
  { key: 'open', label: 'Not archived' },
  { key: 'new', label: 'New' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'Everything' },
];

// ─── List ───────────────────────────────────────────────────────────────────

const state = ref<'loading' | 'ready' | 'setup' | 'error'>('loading');
const message = ref('');
const rows = ref<Summary[]>([]);
/** How many match the current filters in all, of which `rows` holds the pages loaded so far. */
const total = ref(0);
const loadingMore = ref(false);
const counts = ref<{ kind: Kind; status: Status; n: number }[]>([]);

// The overview links straight to "new sales inquiries" and the like.
const route = useRoute();
const kind = ref<Kind | 'all'>(
  [...KINDS.map((k) => k.kind), 'other'].includes(String(route.query.kind)) ? String(route.query.kind) : 'all'
);
const status = ref<Status | 'open' | 'all'>(
  ['new', 'in_progress', 'done', 'archived', 'all'].includes(String(route.query.status))
    ? (route.query.status as Status | 'all')
    : 'open'
);
const search = ref('');

function filterParams(): URLSearchParams {
  const params = new URLSearchParams();
  if (kind.value !== 'all') params.set('kind', kind.value);
  if (status.value !== 'open') params.set('status', status.value);
  if (search.value.trim()) params.set('q', search.value.trim());
  return params;
}

/**
 * Loads the first page of the list, or appends the next one. Changes to a
 * single row do not come through here: they patch the row in place, so saving a
 * note three pages down does not snap the list back to its first page.
 */
async function loadList(mode: 'replace' | 'more' = 'replace') {
  message.value = '';
  try {
    const params = filterParams();
    if (mode === 'more') params.set('offset', String(rows.value.length));

    const res = await api(`form-submissions?${params}`);
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') throw new Error('The submissions service is not responding.');
    if (data.configured === false) {
      state.value = 'setup';
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Submissions could not be loaded.');

    rows.value = mode === 'more' ? [...rows.value, ...(data.submissions ?? [])] : data.submissions ?? [];
    total.value = data.total ?? rows.value.length;
    counts.value = data.counts ?? [];
    state.value = 'ready';
  } catch (err) {
    message.value = err instanceof Error ? err.message : 'Submissions could not be loaded.';
    state.value = 'error';
  }
}

async function loadMore() {
  loadingMore.value = true;
  await loadList('more');
  loadingMore.value = false;
}

/** After a change to one row: patch it where it sits rather than reloading the pages. */
function patchRow(id: string, change: Partial<Summary>) {
  const row = rows.value.find((r) => r.id === id);
  if (row) Object.assign(row, change);
}

/** How many are still waiting, per tab — the number that says where to look. */
function newCount(tab: Kind | 'all'): number {
  return counts.value
    .filter((c) => c.status === 'new' && (tab === 'all' || c.kind === tab))
    .reduce((sum, c) => sum + c.n, 0);
}

watch([kind, status], () => loadList());

// Typing should not fire a request per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadList(), 300);
});

// ─── Presentation helpers ───────────────────────────────────────────────────

function formatDate(isoDate: string, withTime = false): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

const displayName = (row: Summary) => row.name || row.email || 'No name given';

/** The line under the name in the list: what they want, in their own words. */
function preview(row: Summary): string {
  const pick = (pattern: RegExp) => row.fields.find((f) => pattern.test(f.name.toLowerCase()) && f.value.trim())?.value;
  if (row.kind === 'application') {
    const position = pick(/position|role|job/);
    const branch = pick(/branch|location/);
    const line = [position, branch].filter(Boolean).join(' · ');
    if (line) return line;
  }
  return (pick(/message|comment|note|detail/) ?? row.fields.find((f) => f.value.length > 20)?.value ?? '').replace(/\s+/g, ' ');
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isLong = (field: Field) => field.value.length > 60 || field.value.includes('\n');
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && /^[\d\s()+.-]+$/.test(value.trim()) ? digits : '';
};

// ─── Detail ─────────────────────────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const detail = ref<Detail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const notesDraft = ref('');
const saving = ref(false);
const savedNote = ref(false);

async function open(id: string) {
  selectedId.value = id;
  detail.value = null;
  detailError.value = '';
  detailLoading.value = true;
  savedNote.value = false;
  try {
    const res = await api(`form-submissions?id=${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.submission) throw new Error(data?.error || 'That submission could not be opened.');
    // A slow response for one row must not overwrite the row opened after it.
    if (selectedId.value !== id) return;
    detail.value = data.submission;
    notesDraft.value = data.submission.notes ?? '';
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : 'That submission could not be opened.';
  } finally {
    if (selectedId.value === id) detailLoading.value = false;
  }
}

function close() {
  selectedId.value = null;
  detail.value = null;
}

async function update(change: { status?: Status; notes?: string }) {
  if (!detail.value) return;
  const id = detail.value.id;
  saving.value = true;
  detailError.value = '';
  try {
    const res = await api('form-submissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...change }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'That change could not be saved.');

    if (detail.value?.id === id) Object.assign(detail.value, change);
    if (change.notes !== undefined) savedNote.value = true;
    patchRow(id, change);
    void refreshCounts(change.status !== undefined ? { id, status: change.status } : undefined);
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : 'That change could not be saved.';
  } finally {
    saving.value = false;
  }
}

/**
 * The tab badges come from the server. Refreshing them is one small request;
 * a row that no longer belongs in the current view (archived, or filtered by a
 * status it has just left) is dropped from the list locally.
 */
async function refreshCounts(changed?: { id: string; status: Status }) {
  if (changed) {
    const hidden =
      (status.value === 'open' && changed.status === 'archived') ||
      (status.value !== 'open' && status.value !== 'all' && status.value !== changed.status);
    if (hidden) {
      rows.value = rows.value.filter((r) => r.id !== changed.id);
      total.value = Math.max(0, total.value - 1);
    }
  }
  try {
    const params = filterParams();
    params.set('offset', '1000000');
    const data = await (await api(`form-submissions?${params}`)).json();
    if (Array.isArray(data?.counts)) counts.value = data.counts;
  } catch {
    // The badges are a convenience; the change itself has been saved.
  }
}

const notesChanged = computed(() => detail.value !== null && notesDraft.value !== (detail.value.notes ?? ''));
watch(notesDraft, () => { savedNote.value = false; });

async function remove() {
  if (!detail.value) return;
  const who = displayName(detail.value);
  if (!window.confirm(`Delete the submission from ${who}? Its attachments are deleted too, and this cannot be undone.`)) return;

  saving.value = true;
  try {
    const res = await api('form-submissions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: detail.value.id }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'That submission could not be deleted.');
    const id = detail.value.id;
    close();
    rows.value = rows.value.filter((r) => r.id !== id);
    total.value = Math.max(0, total.value - 1);
    void refreshCounts();
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : 'That submission could not be deleted.';
  } finally {
    saving.value = false;
  }
}

const downloading = ref<string | null>(null);

async function download(file: Attachment) {
  downloading.value = file.id;
  detailError.value = '';
  try {
    const res = await api(`form-submissions?file=${encodeURIComponent(file.id)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.content) throw new Error(data?.error || 'That file could not be downloaded.');

    const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
    // Always offered as a download, never opened in the page: an attachment
    // comes from a stranger, whatever type it claims to be.
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = data.filename || file.filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : 'That file could not be downloaded.';
  } finally {
    downloading.value = null;
  }
}

function replyHref(row: Detail): string {
  const subject = `${row.kind === 'application' ? 'Your application to' : 'Your message to'} ${config.clientName}`;
  return `mailto:${row.email}?subject=${encodeURIComponent(subject)}`;
}

// ─── Export ─────────────────────────────────────────────────────────────────

const exporting = ref(false);

async function exportCsv() {
  exporting.value = true;
  message.value = '';
  let all: Summary[];
  try {
    const params = filterParams();
    params.set('all', '1');
    const res = await api(`form-submissions?${params}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data?.submissions)) throw new Error(data?.error || 'The export could not be prepared.');
    all = data.submissions;
  } catch (err) {
    exportError.value = err instanceof Error ? err.message : 'The export could not be prepared.';
    exporting.value = false;
    return;
  }
  exportError.value = '';
  writeCsv(all);
  exporting.value = false;
}

const exportError = ref('');

function writeCsv(all: Summary[]) {
  // Name, email and phone already have their own columns; repeating them under
  // each form's own wording for the same thing only widens the sheet.
  const REPEATED = /^((full )?name|e-?mail( address)?|(mobile )?phone( number)?)$/i;
  const labels = [...new Set(all.flatMap((r) => r.fields.map((f) => f.label)))].filter(
    (label) => !REPEATED.test(label.trim())
  );
  const header = ['Received', 'Type', 'Status', 'Name', 'Email', 'Phone', ...labels, 'Attachments', 'Notes'];

  const cell = (value: unknown) => {
    let text = String(value ?? '');
    // A leading = + - or @ makes a spreadsheet run the cell as a formula.
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = all.map((r) =>
    [
      formatDate(r.createdAt, true), KIND_LABELS[r.kind], STATUS_LABELS[r.status], r.name, r.email, formatPhone(r.phone),
      ...labels.map((label) => {
        const value = r.fields.find((f) => f.label === label)?.value ?? '';
        return phoneDigits(value) ? formatPhone(value) : value;
      }),
      r.fileCount, r.notes,
    ].map(cell).join(',')
  );

  // The BOM is what makes Excel read the file as UTF-8.
  const blob = new Blob(['﻿' + [header.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `form-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(loadList);
</script>

<template>
  <DashboardLayout page-title="Form Submissions">
    <div v-if="state === 'setup'" class="subs-empty">
      <Inbox :size="48" class="subs-empty__icon" aria-hidden="true" />
      <h2>Submissions are being connected</h2>
      <p>Messages sent through your website will be listed here once the connection is finished.</p>
    </div>

    <div v-else class="subs" :class="{ 'subs--detail-open': selectedId }">
      <!-- ── List ─────────────────────────────────────────────────────── -->
      <section class="subs__list-pane" aria-label="Submissions">
        <div class="subs__tabs" role="group" aria-label="Type">
          <button
            v-for="tab in KIND_TABS"
            :key="tab.key"
            type="button"
            class="subs__tab"
            :class="{ 'subs__tab--active': kind === tab.key }"
            :aria-pressed="kind === tab.key"
            @click="kind = tab.key"
          >
            {{ tab.label }}
            <span v-if="newCount(tab.key)" class="subs__tab-count">
              {{ newCount(tab.key) }}<span class="subs__sr-only"> new</span>
            </span>
          </button>
        </div>

        <div class="subs__filters">
          <label class="subs__search">
            <Search :size="16" aria-hidden="true" />
            <span class="subs__sr-only">Search submissions</span>
            <input v-model="search" type="search" placeholder="Search name, email or message" />
          </label>
          <label class="subs__sr-only" for="subs-status">Status</label>
          <select id="subs-status" v-model="status" class="subs__select">
            <option v-for="option in STATUS_FILTERS" :key="option.key" :value="option.key">{{ option.label }}</option>
          </select>
          <button type="button" class="subs__btn" :disabled="!rows.length || exporting" @click="exportCsv">
            <Loader2 v-if="exporting" :size="16" class="subs__spin" aria-hidden="true" />
            <FileDown v-else :size="16" aria-hidden="true" />
            Export
          </button>
        </div>
        <p v-if="exportError" class="subs__error" role="alert">{{ exportError }}</p>

        <div v-if="state === 'loading'" class="subs__status" role="status">
          <Loader2 :size="18" class="subs__spin" aria-hidden="true" /> Loading submissions…
        </div>

        <div v-else-if="state === 'error'" class="subs__status" role="alert">
          <span>{{ message }}</span>
          <button type="button" class="subs__btn" @click="loadList()"><RefreshCw :size="14" aria-hidden="true" /> Try again</button>
        </div>

        <p v-else-if="!rows.length" class="subs__status">
          {{ search || status !== 'open' || kind !== 'all' ? 'Nothing matches those filters.' : 'No submissions yet. They will appear here as they arrive.' }}
        </p>

        <template v-else>
        <p class="subs__count" role="status">
          Showing {{ rows.length.toLocaleString() }} of {{ total.toLocaleString() }}
        </p>
        <ul class="subs__list">
          <li v-for="row in rows" :key="row.id">
            <button
              type="button"
              class="subs__row"
              :class="{ 'subs__row--new': row.status === 'new', 'subs__row--selected': selectedId === row.id }"
              :aria-current="selectedId === row.id ? 'true' : undefined"
              @click="open(row.id)"
            >
              <span class="subs__row-top">
                <span class="subs__row-name">
                  <span v-if="row.status === 'new'" class="subs__dot" aria-hidden="true"></span>
                  {{ displayName(row) }}
                </span>
                <span class="subs__row-date">{{ formatDate(row.createdAt) }}</span>
              </span>
              <span class="subs__row-preview">{{ preview(row) || row.formTitle }}</span>
              <span class="subs__row-meta">
                <span class="subs__tag" :class="`subs__tag--${row.kind}`">{{ KIND_LABELS[row.kind] }}</span>
                <span class="subs__state" :class="`subs__state--${row.status}`">{{ STATUS_LABELS[row.status] }}</span>
                <span v-if="row.fileCount" class="subs__clip">
                  <Paperclip :size="13" aria-hidden="true" />
                  <span class="subs__sr-only">{{ row.fileCount }} attachment{{ row.fileCount === 1 ? '' : 's' }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
        <button v-if="rows.length < total" type="button" class="subs__btn subs__more" :disabled="loadingMore" @click="loadMore">
          <Loader2 v-if="loadingMore" :size="16" class="subs__spin" aria-hidden="true" />
          Show {{ Math.min(100, total - rows.length) }} more
        </button>
        </template>
      </section>

      <!-- ── Detail ───────────────────────────────────────────────────── -->
      <section class="subs__detail-pane" aria-label="Selected submission" aria-live="polite">
        <div v-if="!selectedId" class="subs__placeholder">
          <Inbox :size="40" aria-hidden="true" />
          <p>Choose a submission to read it.</p>
        </div>

        <template v-else>
          <button type="button" class="subs__back" @click="close">
            <ArrowLeft :size="16" aria-hidden="true" /> All submissions
          </button>

          <div v-if="detailLoading" class="subs__status" role="status">
            <Loader2 :size="18" class="subs__spin" aria-hidden="true" /> Opening…
          </div>

          <p v-if="detailError" class="subs__error" role="alert">{{ detailError }}</p>

          <article v-if="detail" class="subs__detail">
            <header class="subs__detail-head">
              <div>
                <h2 class="subs__detail-name">{{ displayName(detail) }}</h2>
                <p class="subs__detail-sub">
                  <span class="subs__tag" :class="`subs__tag--${detail.kind}`">{{ KIND_LABELS[detail.kind] }}</span>
                  Received {{ formatDate(detail.createdAt, true) }}
                </p>
              </div>
              <div class="subs__contact">
                <a v-if="detail.email" :href="replyHref(detail)" class="subs__btn subs__btn--primary">
                  <Mail :size="16" aria-hidden="true" /> Reply by email
                </a>
                <a v-if="detail.phone && phoneDigits(detail.phone)" :href="`tel:${phoneDigits(detail.phone)}`" class="subs__btn">
                  <Phone :size="16" aria-hidden="true" /> {{ formatPhone(detail.phone) }}
                </a>
              </div>
            </header>

            <div class="subs__statusbar" role="group" aria-label="Status">
              <button
                v-for="(label, key) in STATUS_LABELS"
                :key="key"
                type="button"
                class="subs__status-btn"
                :class="{ 'subs__status-btn--active': detail.status === key }"
                :aria-pressed="detail.status === key"
                :disabled="saving"
                @click="detail.status !== key && update({ status: key })"
              >
                {{ label }}
              </button>
            </div>

            <dl class="subs__fields">
              <div v-for="field in detail.fields" :key="field.name || field.label" class="subs__field" :class="{ 'subs__field--wide': isLong(field) }">
                <dt>{{ field.label }}</dt>
                <dd>
                  <a v-if="isEmail(field.value)" :href="`mailto:${field.value.trim()}`">{{ field.value }}</a>
                  <a v-else-if="phoneDigits(field.value)" :href="`tel:${phoneDigits(field.value)}`">{{ formatPhone(field.value) }}</a>
                  <template v-else>{{ field.value }}</template>
                </dd>
              </div>
            </dl>

            <div v-if="detail.files.length" class="subs__block">
              <h3 class="subs__block-title">Attachments</h3>
              <ul class="subs__files">
                <li v-for="file in detail.files" :key="file.id">
                  <button type="button" class="subs__file" :disabled="downloading === file.id" @click="download(file)">
                    <Loader2 v-if="downloading === file.id" :size="16" class="subs__spin" aria-hidden="true" />
                    <Download v-else :size="16" aria-hidden="true" />
                    <span class="subs__file-name">{{ file.filename }}</span>
                    <span class="subs__file-size">{{ formatSize(file.size) }}</span>
                  </button>
                </li>
              </ul>
            </div>

            <div class="subs__block">
              <label class="subs__block-title" for="subs-notes">Notes</label>
              <p class="subs__hint">Only people who sign in to this dashboard can see these.</p>
              <textarea id="subs-notes" v-model="notesDraft" class="subs__notes" rows="4" maxlength="5000" placeholder="Called back, left a voicemail…"></textarea>
              <div class="subs__notes-actions">
                <button type="button" class="subs__btn subs__btn--primary" :disabled="!notesChanged || saving" @click="update({ notes: notesDraft })">
                  Save notes
                </button>
                <span v-if="savedNote" class="subs__saved" role="status">Saved</span>
              </div>
            </div>

            <footer class="subs__detail-foot">
              <span v-if="detail.pagePath" class="subs__hint">Sent from {{ detail.pagePath }}</span>
              <button type="button" class="subs__btn subs__btn--danger" :disabled="saving" @click="remove">
                <Trash2 :size="16" aria-hidden="true" /> Delete
              </button>
            </footer>
          </article>
        </template>
      </section>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.subs {
  display: grid;
  grid-template-columns: minmax(320px, 440px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
  max-width: 1500px;
}

.subs__sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* ── Tabs and filters ─────────────────────────────────────────────────── */
.subs__tabs {
  display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.25rem; margin-bottom: 0.75rem;
  background-color: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius);
}
.subs__tab {
  display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.4rem 0.75rem;
  border: none; border-radius: var(--border-radius); background: none; cursor: pointer;
  font: inherit; font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary, var(--color-text));
}
.subs__tab:hover { color: var(--color-text); }
.subs__tab--active { background-color: var(--color-primary); color: var(--color-on-primary); }
.subs__tab--active:hover { color: var(--color-on-primary); }
.subs__tab-count {
  min-width: 1.25rem; padding: 0 0.3rem; border-radius: 999px; font-size: 0.6875rem; font-weight: 700; line-height: 1.25rem; text-align: center;
  background-color: var(--color-secondary); color: var(--color-text-inverse);
}

.subs__filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
.subs__search {
  flex: 1 1 180px; display: flex; align-items: center; gap: 0.5rem; padding: 0 0.625rem;
  border: 1px solid var(--color-border); border-radius: var(--border-radius); background-color: var(--color-bg);
  color: var(--color-text-secondary, var(--color-text));
}
.subs__search:focus-within { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.subs__search input {
  flex: 1; min-width: 0; padding: 0.5rem 0; border: none; background: none; outline: none;
  font: inherit; font-size: 0.875rem; color: var(--color-text);
}
.subs__select {
  padding: 0.5rem 0.625rem; border: 1px solid var(--color-border); border-radius: var(--border-radius);
  background-color: var(--color-bg); color: var(--color-text); font: inherit; font-size: 0.875rem;
}

.subs__btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border); border-radius: var(--border-radius); background-color: var(--color-bg);
  color: var(--color-text); font: inherit; font-size: 0.875rem; font-weight: 500; text-decoration: none; cursor: pointer;
}
.subs__btn:hover:not(:disabled) { border-color: var(--color-primary); }
.subs__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.subs__btn--primary { background-color: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); }
.subs__btn--danger { color: var(--color-down); }
.subs__btn--danger:hover:not(:disabled) { border-color: var(--color-down); }

/* ── List ─────────────────────────────────────────────────────────────── */
.subs__status {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 1.5rem 0.25rem;
  font-size: 0.875rem; color: var(--color-text-secondary, var(--color-text));
}
.subs__spin { animation: subs-spin 1s linear infinite; }
@keyframes subs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .subs__spin { animation: none; } }

.subs__count { margin-bottom: 0.5rem; font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); }
.subs__more { width: 100%; margin-top: 0.75rem; }
.subs__list { list-style: none; display: flex; flex-direction: column; gap: 0.5rem; }
.subs__row {
  width: 100%; display: flex; flex-direction: column; gap: 0.3rem; padding: 0.75rem 0.875rem; text-align: left;
  border: 1px solid var(--color-border); border-left: 3px solid transparent; border-radius: var(--border-radius);
  background-color: var(--color-surface); color: var(--color-text); font: inherit; cursor: pointer;
}
.subs__row:hover { border-color: var(--color-primary); border-left-color: transparent; }
.subs__row--new { border-left-color: var(--color-secondary); }
.subs__row--new:hover { border-left-color: var(--color-secondary); }
.subs__row--selected, .subs__row--selected:hover { border-color: var(--color-primary); border-left-color: var(--color-primary); }
.subs__row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; }
.subs__row-name { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.9375rem; font-weight: 500; overflow-wrap: anywhere; }
.subs__row--new .subs__row-name { font-weight: 700; }
.subs__dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background-color: var(--color-secondary); flex-shrink: 0; }
.subs__row-date { font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); white-space: nowrap; }
.subs__row-preview {
  font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text));
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.subs__row-meta { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.1rem; }
.subs__clip { display: inline-flex; color: var(--color-text-secondary, var(--color-text)); }

.subs__tag {
  display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.6875rem; font-weight: 600;
  background-color: rgba(99, 102, 241, 0.14); color: var(--color-info);
}
.subs__tag--application { background-color: rgba(245, 158, 11, 0.16); color: var(--color-warn); }
.subs__tag--other { background-color: var(--color-border); color: var(--color-text); }
.subs__state { font-size: 0.6875rem; font-weight: 600; color: var(--color-text-secondary, var(--color-text)); }
.subs__state--new { color: var(--color-text); }
.subs__state--done { color: var(--color-up); }

/* ── Detail ───────────────────────────────────────────────────────────── */
.subs__detail-pane { position: sticky; top: 0; min-width: 0; max-height: calc(100dvh - 7rem); overflow-y: auto; }
.subs__placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 4rem 1rem; text-align: center;
  border: 1px dashed var(--color-border); border-radius: var(--border-radius);
  color: var(--color-text-secondary, var(--color-text)); font-size: 0.9375rem;
}
.subs__back {
  display: none; align-items: center; gap: 0.4rem; margin-bottom: 0.75rem; padding: 0.25rem 0; border: none; background: none;
  color: var(--color-primary); font: inherit; font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.subs__error { margin-bottom: 0.75rem; font-size: 0.875rem; color: var(--color-down); }

.subs__detail {
  background-color: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem;
}
.subs__detail-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
.subs__detail-name { font-size: 1.375rem; font-weight: 700; color: var(--color-text); overflow-wrap: anywhere; }
.subs__detail-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.35rem; font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); }
.subs__contact { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.subs__statusbar {
  display: inline-flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.25rem; margin-bottom: 1.25rem;
  background-color: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius);
}
.subs__status-btn {
  padding: 0.35rem 0.75rem; border: none; border-radius: var(--border-radius); background: none; cursor: pointer;
  font: inherit; font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary, var(--color-text));
}
.subs__status-btn:hover:not(:disabled) { color: var(--color-text); }
.subs__status-btn--active, .subs__status-btn--active:hover:not(:disabled) { background-color: var(--color-primary); color: var(--color-on-primary); }

.subs__fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem 1.5rem; }
.subs__field--wide { grid-column: 1 / -1; }
.subs__field dt { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary, var(--color-text)); margin-bottom: 0.2rem; }
.subs__field dd { font-size: 0.9375rem; color: var(--color-text); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 80ch; }
.subs__field dd a { text-decoration: underline; }

.subs__block { margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--color-border); }
.subs__block-title { display: block; font-size: 0.9375rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.5rem; font-family: var(--font-heading); }
.subs__hint { font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); }
.subs__files { list-style: none; display: flex; flex-direction: column; gap: 0.5rem; }
.subs__file {
  display: inline-flex; align-items: center; gap: 0.5rem; max-width: 100%; padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border); border-radius: var(--border-radius); background-color: var(--color-bg);
  color: var(--color-text); font: inherit; font-size: 0.875rem; cursor: pointer;
}
.subs__file:hover:not(:disabled) { border-color: var(--color-primary); }
.subs__file-name { font-weight: 500; overflow-wrap: anywhere; text-align: left; }
.subs__file-size { color: var(--color-text-secondary, var(--color-text)); white-space: nowrap; }
.subs__notes {
  width: 100%; max-width: 80ch; margin-top: 0.5rem; padding: 0.625rem 0.75rem; resize: vertical;
  border: 1px solid var(--color-border); border-radius: var(--border-radius); background-color: var(--color-bg);
  color: var(--color-text); font: inherit; font-size: 0.875rem; line-height: 1.5;
}
.subs__notes-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; }
.subs__saved { font-size: 0.8125rem; color: var(--color-up); }
.subs__detail-foot {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem;
  margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--color-border);
}
.subs__detail-foot .subs__btn { margin-left: auto; }

/* ── Setup state ──────────────────────────────────────────────────────── */
.subs-empty { text-align: center; padding: 4rem 1.5rem; color: var(--color-text-secondary, var(--color-text)); }
.subs-empty__icon { opacity: 0.3; margin: 0 auto 1rem; }
.subs-empty h2 { font-size: 1.25rem; font-weight: 700; color: var(--color-text); margin-bottom: 0.5rem; }
.subs-empty p { max-width: 420px; margin: 0 auto; font-size: 0.9375rem; line-height: 1.5; }

/* One pane at a time where two will not fit: the list, or what was opened. */
@media (max-width: 900px) {
  .subs { grid-template-columns: minmax(0, 1fr); }
  .subs__detail-pane { position: static; display: none; max-height: none; overflow: visible; }
  .subs--detail-open .subs__list-pane { display: none; }
  .subs--detail-open .subs__detail-pane { display: block; }
  .subs__back { display: inline-flex; }
}
</style>
