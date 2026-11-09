import { ref } from 'vue';
import { apiFetch } from '@/composables/useApi';
import { useAuthToken } from '@/composables/useAuthToken';
import type { MonthlyReport, ReportNotes } from '@/types/report';

/** The stored monthly reports: the newest by default, or a chosen month. */
export function useReports() {
  const authToken = useAuthToken();
  const state = ref<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const report = ref<MonthlyReport | null>(null);
  const notes = ref<ReportNotes | null>(null);
  const months = ref<string[]>([]);
  const message = ref('');

  async function load(month?: string) {
    state.value = 'loading';
    message.value = '';
    try {
      const token = await authToken();
      const data = await apiFetch<any>(
        `/.netlify/functions/reports${month ? `?month=${encodeURIComponent(month)}` : ''}`,
        { token },
      );
      months.value = data?.months ?? [];
      report.value = data?.report ?? null;
      notes.value = data?.notes ?? null;
      state.value = report.value ? 'ready' : 'empty';
    } catch (err) {
      message.value = err instanceof Error ? err.message : 'The report could not be loaded.';
      state.value = 'error';
    }
  }

  return { state, report, notes, months, message, load };
}

/** "2026-09" as "September 2026". */
export const monthName = (month: string, style: 'long' | 'short' = 'long') =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' });

/** "2026-09" as "September", for sentences. */
export const monthOnly = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

/**
 * When the next report appears, given the newest one's month: September's
 * successor is October's, written on November 3. (Date.UTC counts months from
 * 0, so index m+1 is two months on from m.)
 */
export function nextReportDate(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m + 1, 3, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}
