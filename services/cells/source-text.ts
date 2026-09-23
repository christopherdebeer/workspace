/**
 * source-text.ts — the pure half of cell source access: content versions,
 * line/byte ranges, path globs and text search. No S3 here; `service.ts` reads
 * the objects and hands the bytes in, so everything below is unit-testable.
 *
 * Why this exists: the cell file tools used to treat a source file as an
 * opaque blob on read (all or nothing) and as mutable code on write. A 2.5 MB
 * `client/main.ts` could be surgically edited with `replaceInFile`, but nobody
 * could ask for lines 12,000–12,150 of it, find a symbol in it, or prove the
 * file being edited was still the file that was read. The version here is that
 * proof (the same proof-of-read idea ADR-0066 gave workspace facts).
 */
import { createHash } from 'node:crypto';

/** Text is anything not stored as bytes — the stored content type is the record. */
export const isTextType = (contentType: string): boolean =>
  contentType.startsWith('text/') || contentType.startsWith('application/json');

/** Run `fn` over `items` with at most `n` in flight (S3 round trips). */
export async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Content version: `sha256:<hex>` over the stored bytes. Stable across reads. */
export function contentVersion(body: Buffer | string): string {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

/** Number of lines in a text body (a trailing newline does not open a new line). */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * Response budget for one ranged read or search, in UTF-8 bytes. Under the
 * substrate's 60KB read guard with room for the envelope, so a ranged read
 * never needs the `whole:true` transport escape hatch.
 */
export const RANGE_MAX_BYTES = 48 * 1024;

export interface LineSlice {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** True when the byte budget cut the slice short of the requested endLine. */
  truncated: boolean;
  /** First line not returned, when the file continues past this slice. */
  nextStartLine?: number;
}

/**
 * Lines `startLine..endLine` (1-based, inclusive) of `text`, cut at a line
 * boundary once `maxBytes` would be exceeded. At least one line is always
 * returned (a single over-budget line comes back whole rather than never).
 */
export function sliceLines(text: string, startLine = 1, endLine?: number, maxBytes = RANGE_MAX_BYTES): LineSlice {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  const totalLines = text.length === 0 ? 0 : lines.length;
  if (!Number.isInteger(startLine) || startLine < 1) throw new Error('startLine must be an integer >= 1');
  if (endLine !== undefined && (!Number.isInteger(endLine) || endLine < startLine)) {
    throw new Error('endLine must be an integer >= startLine');
  }
  if (totalLines === 0 || startLine > totalLines) {
    if (startLine > Math.max(totalLines, 1)) throw new Error(`startLine ${startLine} is past the end of the file (${totalLines} lines)`);
    return { content: '', startLine, endLine: startLine - 1, totalLines, truncated: false };
  }
  const want = Math.min(endLine ?? totalLines, totalLines);
  const out: string[] = [];
  let bytes = 0;
  let last = startLine - 1;
  for (let n = startLine; n <= want; n++) {
    const line = lines[n - 1];
    const cost = Buffer.byteLength(line, 'utf8') + 1;
    if (out.length > 0 && bytes + cost > maxBytes) break;
    out.push(line);
    bytes += cost;
    last = n;
  }
  const slice: LineSlice = {
    content: out.join('\n') + (last < totalLines || text.endsWith('\n') ? '\n' : ''),
    startLine,
    endLine: last,
    totalLines,
    truncated: last < want,
  };
  if (last < totalLines) slice.nextStartLine = last + 1;
  return slice;
}

/**
 * Compile a path glob to a RegExp. `**` crosses directories, `*` and `?` do
 * not, `{a,b}` alternates. A glob with no `/` matches the basename anywhere
 * (so `*.ts` means every TypeScript file, as it does in most tools).
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { depth++; re += '(?:'; }
    else if (c === '}' && depth > 0) { depth--; re += ')'; }
    else if (c === ',' && depth > 0) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(glob.includes('/') ? `^${re}$` : `(?:^|/)${re}$`);
}

/** Path filter from an optional prefix + glob. */
export function pathMatcher(prefix?: string, glob?: string): (path: string) => boolean {
  const re = glob ? globToRegExp(glob) : null;
  return (path) => (!prefix || path.startsWith(prefix)) && (!re || re.test(path));
}

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
}

export interface SearchMatch {
  line: number;
  column: number;
  text: string;
  before?: string[];
  after?: string[];
}

/** Longest line echoed back in a match; minified bundles would blow the budget. */
export const MATCH_LINE_MAX = 400;
const clip = (s: string): string => (s.length > MATCH_LINE_MAX ? `${s.slice(0, MATCH_LINE_MAX)}…` : s);

/** Build the line matcher once per search (a bad regex fails the call, not a file). */
export function compileQuery(opts: SearchOptions): RegExp {
  if (typeof opts.query !== 'string' || opts.query.length === 0) throw new Error('query (non-empty string) is required');
  if (opts.query.length > 1000) throw new Error('query is too long (max 1000 characters)');
  const source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = opts.caseSensitive === false ? 'i' : '';
  try {
    return new RegExp(source, flags);
  } catch (err) {
    throw new Error(`invalid regex: ${(err as Error).message}`);
  }
}

/**
 * Every line of `text` matching `re`, from `afterLine` onward, stopping once
 * `limit` matches are found. One match per line (the first column), which is
 * what an agent needs to decide where to `readFile` next.
 */
export function searchText(text: string, re: RegExp, contextLines: number, limit: number, afterLine = 0): SearchMatch[] {
  const lines = text.split('\n');
  const out: SearchMatch[] = [];
  for (let i = afterLine; i < lines.length && out.length < limit; i++) {
    const m = re.exec(lines[i]);
    if (!m || m[0].length === 0) continue;
    const match: SearchMatch = { line: i + 1, column: m.index + 1, text: clip(lines[i]) };
    if (contextLines > 0) {
      match.before = lines.slice(Math.max(0, i - contextLines), i).map(clip);
      match.after = lines.slice(i + 1, i + 1 + contextLines).map(clip);
    }
    out.push(match);
  }
  return out;
}

/** Non-overlapping occurrence offsets of `needle` in `haystack`. */
export function occurrenceOffsets(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) out.push(at);
  return out;
}

/** 1-based line number of a character offset. */
export function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Opaque resume token for a search: the file and line to continue after. */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
export function decodeCursor<T>(cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('invalid cursor');
  }
}
