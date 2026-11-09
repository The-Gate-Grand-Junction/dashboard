/** Optional overview extras. The greeting, month-so-far, report and site health cards are always shown. */
export type WidgetType =
  | 'siteAnalytics'
  | 'tutorials'
  | 'contentEditors';

export interface TutorialVideo {
  title: string;
  url: string;
  category?: string;
  description?: string;
}

/**
 * Unified dashboard link. Without a description renders as a compact pill
 * (the former Quick Action). With a description renders as a resource card
 * (the former Helpful Link).
 */
export interface DashboardLink {
  label: string;
  url: string;
  emoji?: string;
  description?: string;
}

export interface ContentEditor {
  label: string;
  documentType: string;
  description?: string;
}

export interface BillingConfig {
  /** Show the Billing page. The Stripe customer lives in STRIPE_CUSTOMER_ID,
   *  server-side — it must not ship in the browser bundle. */
  enabled: boolean;
  showPendingCharges: boolean;
  showOfflineInvoices: boolean;
}

export interface AnalyticsConfig {
  provider: 'simple-analytics' | 'ga4';
  /** Simple Analytics: client domain (e.g. "acmeplumbing.com") */
  simpleAnalyticsId?: string;
  /** GA4: measurement ID (e.g. "G-XXXXXXXXXX") */
  analyticsId?: string;
  /** Dashboard routes filtered from public traffic view */
  internalRoutes?: string[];
  /** Goal page slug for visitor journey funnel (default: '/contact') */
  conversionPage?: string;
  /**
   * First day analytics recorded (YYYY-MM-DD). Its month is partial, so it and
   * anything earlier are never used as a comparison (OVERVIEW-STANDARD 6.2).
   */
  trackingSince?: string;
}

/** One kind of website form submission (OVERVIEW-STANDARD 3.2). */
export interface SubmissionKind {
  /** Stored on each submission, e.g. 'contact', 'application'. */
  kind: string;
  /** Singular and plural labels: "inquiry" / "inquiries". */
  one: string;
  many: string;
  /** Regex source matched against the form's slug and title to file a submission under this kind. */
  match?: string;
}

export interface ReportsConfig {
  /** How often the web team writes the full review + check-in (monthly reports are automatic on every tier). */
  reviewCadence: 'monthly' | 'annual';
}

export interface ContentKitSection {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  required: boolean;
}

export interface ContentKitConfig {
  enabled: boolean;
  sections: ContentKitSection[];
  maxPersonalityPicks?: number;
  welcomeMessage?: string;
  completionEmailNotify?: boolean;
}

/**
 * A banner across the top of the Overview. Push a message to the client by
 * adding one here and committing; no runtime API needed.
 */
export interface DashboardAnnouncement {
  /** Body text shown to the client. Keep it short: one or two sentences. */
  message: string;
  /**
   * 'info' = neutral, 'success' = new feature or good news, 'warning' =
   * heads-up (scheduled maintenance), 'critical' = incident. Default 'info'.
   */
  level?: 'info' | 'success' | 'warning' | 'critical';
  /** Optional link after the message. A /path opens in the dashboard. */
  link?: { label: string; url: string };
  /** First day to show it, YYYY-MM-DD in the viewer's local time (inclusive). */
  showFrom?: string;
  /** Last day to show it, YYYY-MM-DD in the viewer's local time (inclusive). */
  showUntil?: string;
}

export interface DashboardConfig {
  clientId: string;
  clientName: string;
  clientDomain: string;
  clientEmail: string;
  /**
   * Overview banners in priority order. The first whose showFrom/showUntil
   * window includes today is shown, so a banner can be scheduled ahead and
   * swaps on its own without a deploy. Empty or omitted shows none.
   */
  announcements?: DashboardAnnouncement[];
  enabledWidgets: string[];
  tutorialVideos: TutorialVideo[];
  links: DashboardLink[];
  contentEditors: ContentEditor[];
  billing?: BillingConfig;
  analytics?: AnalyticsConfig;
  contentKit?: ContentKitConfig;
  reports?: ReportsConfig;
  /** The submissions inbox; absent or empty means no inbox (e.g. the minimal profile). */
  submissionKinds?: SubmissionKind[];
}
