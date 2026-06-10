/**
 * tar.ts — minimal ustar reader for `cells.importSrc`.
 *
 * Enough of the tar format to extract text sources from a GitHub
 * codeload tarball (`https://codeload.github.com/<o>/<r>/tar.gz/<ref>`):
 * 512-byte headers, octal sizes, ustar name+prefix, regular files only.
 * Kept dependency-free, like the zip writer.
 */
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';

export interface TarEntry {
  /** Full path within the archive (e.g. `repo-main/src/main.ts`). */
  name: string;
  content: string;
}

export interface ExtractOptions {
  /** Only entries whose path starts with this prefix (also stripped by callers). */
  include?: string;
  /** Cap on extracted files. Default 300. */
  maxFiles?: number;
  /** Cap on total extracted bytes. Default 5 MiB. */
  maxBytes?: number;
}

/** Extensions we treat as text sources; everything else is skipped. */
const TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.html', '.md', '.svg', '.txt', '.yml', '.yaml',
];

function isText(name: string): boolean {
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function octal(buf: Buffer, start: number, len: number): number {
  const raw = buf.subarray(start, start + len).toString('ascii').replace(/\0.*$/, '').trim();
  return raw ? parseInt(raw, 8) : 0;
}

function str(buf: Buffer, start: number, len: number): string {
  return buf.subarray(start, start + len).toString('utf8').replace(/\0.*$/, '');
}

/** Extract text entries from a (possibly gzipped) tar archive. */
export function extractTarGz(archive: Buffer, opts: ExtractOptions = {}): { entries: TarEntry[]; skipped: number } {
  const maxFiles = opts.maxFiles ?? 300;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const tar = archive[0] === 0x1f && archive[1] === 0x8b ? gunzipSync(archive) : archive;

  const entries: TarEntry[] = [];
  let skipped = 0;
  let total = 0;
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // Two all-zero blocks terminate the archive; one is enough to stop.
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = header[156];
    let name = str(header, 0, 100);
    const prefix = str(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const dataStart = offset + 512;
    offset = dataStart + Math.ceil(size / 512) * 512;

    const isFile = type === 0x30 /* '0' */ || type === 0; // regular file
    if (!isFile || !name) continue;
    if (opts.include && !name.startsWith(opts.include)) continue;
    if (!isText(name)) {
      skipped++;
      continue;
    }
    if (entries.length >= maxFiles) throw new Error(`archive exceeds ${maxFiles} files`);
    total += size;
    if (total > maxBytes) throw new Error(`archive exceeds ${maxBytes} bytes of text`);
    entries.push({ name, content: tar.subarray(dataStart, dataStart + size).toString('utf8') });
  }
  return { entries, skipped };
}
