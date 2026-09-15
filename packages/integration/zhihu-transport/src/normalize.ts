import {createHash} from 'node:crypto';
import {ZhihuTransportError} from './index.js';

export type SearchSource = 'zhihu' | 'global';
export const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
export function plainText(x: unknown, max = 2400): string {
  if (typeof x !== 'string') return '';
  // API summaries are text, not trusted HTML. Consumers must render as textContent.
  return x.slice(0, 32000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n: string) =>
      ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '}[n] ?? ''))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max);
}
export function sourceUrl(x: unknown, zhihuOnly = false): string | null {
  if (typeof x !== 'string' || x.length > 4096) return null;
  try {
    const u = new URL(x);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (zhihuOnly && u.hostname !== 'zhihu.com' && !u.hostname.endsWith('.zhihu.com')) return null;
    return u.href; // Preserve provider-returned paths and UTM attribution, never invent URLs.
  } catch { return null; }
}
export interface SourceItem {
  id: string; provider: 'zhihu'; source: SearchSource; title: string; author: string | null;
  url: string | null; excerpt: string; content_type: string; content_mode: 'summary'; fetched_at: string;
}
export function normalizeItems(data: unknown, source: SearchSource, fetchedAt: string, limit: number): SourceItem[] {
  if (!record(data) || !Array.isArray(data.Items ?? data.items)) throw new ZhihuTransportError('INVALID_RESPONSE', 'Zhihu response is missing an Items array.');
  const items = (data.Items ?? data.items) as unknown[];
  return items.slice(0, limit).map((raw, index) => {
    if (!record(raw)) throw new ZhihuTransportError('INVALID_RESPONSE', 'Zhihu returned a malformed content item.');
    const author = record(raw.Author) ? raw.Author : record(raw.author) ? raw.author : {};
    const title = plainText(raw.Title ?? raw.title, 400);
    const excerpt = plainText(raw.ContentText ?? raw.Summary ?? raw.content_text ?? raw.summary ?? raw.excerpt);
    const url = sourceUrl(raw.Url ?? raw.url, source === 'zhihu');
    if (!title && !excerpt) throw new ZhihuTransportError('INVALID_RESPONSE', 'Zhihu returned an empty content item.');
    const id = 'external:' + createHash('sha256').update(JSON.stringify({source, url, title, excerpt, index})).digest('hex').slice(0, 32);
    return {id, provider: 'zhihu', source, title, author: plainText(raw.AuthorName ?? raw.author_name ?? author.Name ?? author.name, 200) || null,
      url, excerpt, content_type: plainText(raw.ContentType ?? raw.content_type ?? raw.type, 60) || 'unknown', content_mode: 'summary', fetched_at: fetchedAt};
  });
}
