import type { Edition } from '../shared/types';
import { getEdition, putEdition } from './store';
import { upsertWork } from './social';

export const normalizeIsbn = (raw: unknown): string => typeof raw === 'string' ? raw.toUpperCase().replace(/[^0-9X]/g, '') : '';

const safeFetch = async (url: string, ms = 6500): Promise<Response | null> => {
  try { const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Shelved/0.2 (parc.land cell)' }, signal: AbortSignal.timeout(ms) }); return response.ok ? response : null; }
  catch { return null; }
};

async function googleEdition(isbn: string): Promise<Edition | null> {
  const response = await safeFetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`);
  if (!response) return null;
  const data = await response.json() as { items?: Array<{ volumeInfo?: { title?: string; authors?: string[]; publisher?: string; publishedDate?: string; categories?: string[]; imageLinks?: Record<string, string> } }> };
  const info = data.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const images = info.imageLinks ?? {};
  const cover = images.extraLarge || images.large || images.medium || images.thumbnail || images.smallThumbnail;
  return {
    isbn,
    title: info.title,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    genres: (info.categories ?? []).flatMap((category) => category.split('/')).map((value) => value.trim()).filter(Boolean).slice(0, 6),
    coverUrl: cover?.replace(/^http:/, 'https:'),
  };
}

async function openLibraryEdition(isbn: string): Promise<Edition | null> {
  const response = await safeFetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
  if (!response) return null;
  const data = await response.json() as { title?: string; authors?: Array<{ key?: string }>; publishers?: string[]; publish_date?: string; covers?: number[]; subjects?: string[] };
  const authorNames = await Promise.all((data.authors ?? []).slice(0, 4).map(async ({ key }) => {
    if (!key) return '';
    const author = await safeFetch(`https://openlibrary.org${key}.json`, 4000);
    if (!author) return '';
    const body = await author.json() as { name?: string };
    return body.name ?? '';
  }));
  let coverId = data.covers?.find((id) => Number.isFinite(id) && id > 0);
  let searchGenres: string[] = [];
  let searchTitle = '';
  if (!coverId || !(data.subjects ?? []).length) {
    const search = await safeFetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=cover_i,subject,title,author_name,publisher,first_publish_year&limit=1`);
    if (search) {
      const body = await search.json() as { docs?: Array<{ cover_i?: number; subject?: string[]; title?: string }> };
      const doc = body.docs?.[0];
      if (!coverId && doc?.cover_i) coverId = doc.cover_i;
      searchGenres = doc?.subject ?? [];
      searchTitle = doc?.title?.trim() ?? '';
    }
  }
  return {
    isbn,
    title: [data.title?.trim(), searchTitle].filter((value): value is string => !!value).sort((a, b) => b.length - a.length)[0] || 'Unknown title',
    authors: authorNames.filter(Boolean),
    publisher: data.publishers?.[0],
    publishedDate: data.publish_date,
    genres: [...(data.subjects ?? []), ...searchGenres].filter((subject, index, all) => subject.length < 36 && all.indexOf(subject) === index).slice(0, 6),
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
  };
}

export async function lookupIsbn(raw: unknown): Promise<Edition> {
  const isbn = normalizeIsbn(raw);
  if (isbn.length !== 10 && isbn.length !== 13) throw new Error('A valid 10 or 13 digit ISBN is required.');
  const cached = await getEdition(isbn);
  const cacheIsRich = cached?.metadataVersion === 2 && !!cached?.genres?.length && !!cached.coverUrl && !cached.coverUrl.includes('/b/isbn/');
  if (cached && cacheIsRich) {
    const work = await upsertWork(cached);
    const enriched = { ...cached, workId: work.id };
    if (cached.workId !== work.id) await putEdition(enriched);
    return enriched;
  }

  const [google, openLibrary] = await Promise.all([googleEdition(isbn), openLibraryEdition(isbn)]);
  if (!google && !openLibrary && cached) return cached;
  if (!google && !openLibrary) throw new Error('That ISBN was not found in the book catalogues.');
  let edition: Edition = {
    metadataVersion: 2,
    isbn,
    title: google?.title || openLibrary?.title || cached?.title || 'Unknown title',
    authors: google?.authors?.length ? google.authors : openLibrary?.authors?.length ? openLibrary.authors : cached?.authors ?? [],
    publisher: google?.publisher || openLibrary?.publisher || cached?.publisher,
    publishedDate: google?.publishedDate || openLibrary?.publishedDate || cached?.publishedDate,
    genres: google?.genres?.length ? google.genres : openLibrary?.genres?.length ? openLibrary.genres : cached?.genres,
    coverUrl: google?.coverUrl || openLibrary?.coverUrl,
  };
  const work = await upsertWork(edition);
  edition = { ...edition, workId: work.id };
  await putEdition(edition);
  return edition;
}
