/**
 * inferIngestionType (ADR-0081) — the put-seam type table. Pure, so covering
 * the default rules + the `_config/ingestion` override path needs no store.
 */
import { inferIngestionType } from '../platform/runtime/ingestion-type';

describe('inferIngestionType: built-in defaults', () => {
  it.each([
    ['docs/readme.md', 'markdown'],
    ['notes.markdown', 'markdown'],
    ['photo.PNG', 'image'],
    ['scan.jpeg', 'image'],
    ['icon.svg', 'image'],
    ['page.html', 'artifact'],
    ['index.htm', 'artifact'],
    ['config.json', 'data'],
    ['export.csv', 'data'],
    ['settings.yaml', 'data'],
    ['archive.zip', 'file'],
    ['no-extension', 'file'],
  ])('%s -> %s', (name, expected) => {
    expect(inferIngestionType(name)).toBe(expected);
  });

  it('matches on a path, not just a bare filename', () => {
    expect(inferIngestionType('cells/c15r/data/user/notes/2026-07-11.md')).toBe('markdown');
  });

  it('falls back to MIME when the extension is missing or unmatched', () => {
    expect(inferIngestionType('blob-abc123', 'image/webp')).toBe('image');
    expect(inferIngestionType('blob-abc123', 'text/html')).toBe('artifact');
    expect(inferIngestionType('blob-abc123', 'application/octet-stream')).toBe('file');
  });

  it('prefers an extension match over a conflicting content-type', () => {
    expect(inferIngestionType('report.md', 'text/plain')).toBe('markdown');
  });
});

describe('inferIngestionType: _config/ingestion override', () => {
  it('tries override rules before the built-in table', () => {
    expect(inferIngestionType('deck.pdf', undefined, { rules: [{ ext: ['.pdf'], type: 'slides' }] })).toBe('slides');
  });

  it('lets an override redirect an extension the defaults already claim', () => {
    expect(inferIngestionType('welcome.md', undefined, { rules: [{ ext: ['.md'], type: 'doc' }] })).toBe('doc');
  });

  it('honours a custom default fallback', () => {
    expect(inferIngestionType('archive.zip', undefined, { default: 'blob' })).toBe('blob');
  });

  it('ignores a null/absent config', () => {
    expect(inferIngestionType('readme.md', undefined, null)).toBe('markdown');
    expect(inferIngestionType('readme.md')).toBe('markdown');
  });
});
