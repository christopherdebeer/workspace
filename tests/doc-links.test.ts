/**
 * Doc link resolution (ADR-0092 follow-on — docs are USABLE on home): relative
 * `*.md` hrefs inside a rendered doc resolve to `doc:` fact keys against the
 * doc's own corpus directory; absolute URLs, anchors, and traversal outside
 * `docs/` never do.
 */
import { resolveDocHref } from '../cells/home/client/doc-links';

describe('resolveDocHref', () => {
  const base = 'docs/architecture/adr';

  it('resolves a sibling doc link against the base directory', () => {
    expect(resolveDocHref('0091-the-public-read-path.md', base)).toBe('doc:docs/architecture/adr/0091-the-public-read-path');
    expect(resolveDocHref('./0091-the-public-read-path.md', base)).toBe('doc:docs/architecture/adr/0091-the-public-read-path');
  });

  it('resolves parent traversal that stays inside docs/', () => {
    expect(resolveDocHref('../../platform-core.md', base)).toBe('doc:docs/platform-core');
    expect(resolveDocHref('../compose.md', base)).toBe('doc:docs/architecture/compose');
  });

  it('accepts corpus-rooted paths regardless of base', () => {
    expect(resolveDocHref('docs/substrate.md', undefined)).toBe('doc:docs/substrate');
    expect(resolveDocHref('docs/substrate.md', base)).toBe('doc:docs/substrate');
  });

  it('drops fragments and refuses traversal OUT of docs/', () => {
    expect(resolveDocHref('0090-fact-address-url.md#context', base)).toBe('doc:docs/architecture/adr/0090-fact-address-url');
    expect(resolveDocHref('../../../secrets.md', base)).toBeNull();
    expect(resolveDocHref('../../../../etc/passwd.md', base)).toBeNull();
  });

  it('leaves non-doc links to the ordinary sanitized path', () => {
    expect(resolveDocHref('https://example.com/x.md', base)).toBeNull();
    expect(resolveDocHref('mailto:x@y.z', base)).toBeNull();
    expect(resolveDocHref('/r/doc:docs/substrate', base)).toBeNull();
    expect(resolveDocHref('#anchor', base)).toBeNull();
    expect(resolveDocHref('image.png', base)).toBeNull();
    expect(resolveDocHref('script.ts', base)).toBeNull();
  });
});
