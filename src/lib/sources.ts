/**
 * Simple Analytics referrers in the words a business owner would use.
 * Shared by the report page and the report's generated sentences, so the two
 * never name the same visit differently.
 */

const SEARCH_ENGINES: Record<string, string> = {
  google: 'Google Search',
  bing: 'Bing Search',
  duckduckgo: 'DuckDuckGo',
  yahoo: 'Yahoo Search',
  ecosia: 'Ecosia',
  brave: 'Brave Search',
};
const AI_ASSISTANTS = ['chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot'];
/** Beyond this many rows the list is a tail of one-visit sources nobody acts on. */
const MAX_SOURCES = 6;

export interface DescribedSource {
  name: string;
  desc: string;
  visits: number;
}

export function nameSource(source: string): { name: string; desc: string } {
  const s = source.toLowerCase();
  if (s === 'direct') return { name: 'Direct', desc: 'Typed the address, used a bookmark, or tapped a link in an app or email' };
  const engine = Object.keys(SEARCH_ENGINES).find((e) => s === e || s.includes(`${e}.`));
  if (engine) return { name: SEARCH_ENGINES[engine]!, desc: 'Searched and found you' };
  if (AI_ASSISTANTS.some((a) => s.includes(a))) return { name: 'AI assistants', desc: 'Followed a link from ChatGPT or a similar tool' };
  if (s.includes('facebook') || s === 'fb.me') return { name: 'Facebook', desc: 'A post or profile link' };
  if (s.includes('instagram')) return { name: 'Instagram', desc: 'A post or profile link' };
  if (s.includes('yelp')) return { name: 'Yelp', desc: 'Your Yelp listing' };
  if (s.startsWith('android-app')) return { name: 'Android apps', desc: 'A link in an app on an Android phone' };
  return { name: source.replace(/^https?:\/\//, '').replace(/\/$/, ''), desc: 'A link on another website' };
}

/** Merges rows that mean the same thing (google, google.com) and groups the long tail. */
export function describeSources(rows: { source: string; visits: number }[], max = MAX_SOURCES): DescribedSource[] {
  const merged = new Map<string, DescribedSource>();
  for (const row of rows) {
    const { name, desc } = nameSource(row.source);
    const existing = merged.get(name);
    if (existing) existing.visits += row.visits;
    else merged.set(name, { name, desc, visits: row.visits });
  }

  const sorted = [...merged.values()].filter((s) => s.visits > 0).sort((a, b) => b.visits - a.visits);
  if (sorted.length <= max) return sorted;
  const rest = sorted.slice(max - 1);
  return [
    ...sorted.slice(0, max - 1),
    { name: 'Everything else', desc: `${rest.length} smaller sources`, visits: rest.reduce((sum, r) => sum + r.visits, 0) },
  ];
}

const titleCase = (slug: string) => {
  const words = slug.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A page address as a person would say it: "/home" → "the homepage",
 * "/services" → "the Services page", "/blog/spring-sale" → "the blog post “Spring sale”".
 * The report merges "/" and "/home" under "/home".
 */
export function namePage(path: string): string {
  if (path === '/' || path === '/home') return 'the homepage';
  const post = path.match(/^\/(?:blog|blog-pages|posts)\/(?!category)([^/]+)$/);
  if (post) return `the blog post “${titleCase(post[1]!)}”`;
  const segments = path.split('/').filter(Boolean);
  return `the ${titleCase(segments[segments.length - 1] ?? path)} page`;
}
