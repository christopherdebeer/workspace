/**
 * The lit fence meta-grammar (ADR-0059) — dotlit's declared vocabulary,
 * whole, with a faithful serializer. The worked example is pinned VERBATIM
 * from dotlit `src/parser/parser.lit:60-104` — the upstream spec's own test.
 */
import { parseFenceMeta, fenceToString, fenceTagsOf } from '../cells/lit/fence';

describe('parseFenceMeta — the full dotlit grammar', () => {
  it('parses the pinned dotlit spec example (parser.lit)', () => {
    const m = parseFenceMeta('js index.jsx !foo #bar baz=qux\\ zig < source.jsx > json output.json #faz !raz');
    expect(m.lang).toBe('js');
    expect(m.filename).toBe('index.jsx');
    expect(m.directives).toEqual(['foo']);
    expect(m.tags).toEqual(['bar']);
    expect(m.attrs).toEqual({ baz: 'qux zig' }); // escaped space survives the token
    expect(m.isOutput).toBe(false);
    expect(m.fromSource).toBe('source.jsx');
    expect(m.source?.lang).toBe('txt'); // bare sources default lang txt
    expect(m.source?.filename).toBe('source.jsx');
    expect(m.output?.lang).toBe('json');
    expect(m.output?.filename).toBe('output.json');
    expect(m.output?.tags).toEqual(['faz']);
    expect(m.output?.directives).toEqual(['raz']);
  });

  it('recognizes output cells — the leading > sigil, glued or spaced', () => {
    const glued = parseFenceMeta('>img influences.svg attached=true updated=1625694616836');
    expect(glued.isOutput).toBe(true);
    expect(glued.lang).toBe('img');
    expect(glued.filename).toBe('influences.svg');
    expect(glued.attrs.attached).toBe('true');
    expect(glued.attrs.updated).toBe('1625694616836');

    const admonition = parseFenceMeta('>md !warn');
    expect(admonition.isOutput).toBe(true);
    expect(admonition.lang).toBe('md');
    expect(admonition.directives).toEqual(['warn']);

    expect(parseFenceMeta('>search').isOutput).toBe(true);
    expect(parseFenceMeta('>search').lang).toBe('search');
  });

  it('distinguishes uri from filename at position 1', () => {
    expect(parseFenceMeta('js https://cdn.example.com/x.js').uri).toBe('https://cdn.example.com/x.js');
    expect(parseFenceMeta('js //cdn.example.com/x.js').uri).toBe('//cdn.example.com/x.js');
    expect(parseFenceMeta('js ./plugins/cors-proxy.js').filename).toBe('./plugins/cors-proxy.js');
  });

  it('collects unknown bare tokens instead of dropping them', () => {
    const m = parseFenceMeta('js file.js stray tokens');
    expect(m.unknowns).toEqual(['stray', 'tokens']);
  });

  it('parses the real corpus lines from dotlit index.lit', () => {
    const plugin = parseFenceMeta('js !plugin type=proxy id=corsProxy !collapse < ./plugins/other/cors-proxy.js');
    expect(plugin.directives).toEqual(['plugin', 'collapse']);
    expect(plugin.attrs).toEqual({ type: 'proxy', id: 'corsProxy' });
    expect(plugin.fromSource).toBe('./plugins/other/cors-proxy.js');

    const uml = parseFenceMeta('uml !collapse repl=uml > img influences.svg');
    expect(uml.lang).toBe('uml');
    expect(uml.attrs.repl).toBe('uml');
    expect(uml.output?.lang).toBe('img');
    expect(uml.output?.filename).toBe('influences.svg');
  });
});

describe('fenceToString — the round-trip serializer', () => {
  const canon = (s: string): string => fenceToString(parseFenceMeta(s));

  it('is a fixpoint: parse ∘ serialize ∘ parse ≡ parse ∘ serialize', () => {
    for (const s of [
      'js index.jsx !foo #bar baz=qux\\ zig < source.jsx > json output.json #faz !raz',
      '>img influences.svg attached=true updated=1625694616836',
      'uml !collapse repl=uml > img influences.svg',
      '>md !warn',
      '>css viewer=style #styling #tweaks',
      'js !plugin type=viewer of=upcase',
      'run',
    ]) {
      const once = canon(s);
      expect(canon(once)).toBe(once); // canonical form is stable
    }
  });

  it('serializes every part in canonical order', () => {
    const m = parseFenceMeta('>uml out.svg !collapse repl=uml #diag < in.txt > img final.svg');
    expect(fenceToString(m)).toBe('> uml out.svg !collapse repl=uml #diag < txt in.txt > img final.svg');
  });

  it('escapes spaces in filenames and attr values', () => {
    const m = parseFenceMeta('js my\\ file.js note=two\\ words');
    expect(m.filename).toBe('my file.js');
    expect(m.attrs.note).toBe('two words');
    const s = fenceToString(m);
    expect(s).toContain('my\\ file.js');
    expect(s).toContain('note=two\\ words');
    expect(fenceToString(parseFenceMeta(s))).toBe(s);
  });
});

describe('fenceTagsOf — declared tags reach the fact (ADR-0059 §2)', () => {
  it('collects #tags from every fence in a cell body', () => {
    const md = '# Title\n\n```js #alpha #beta\ncode\n```\n\ntext\n\n```>css viewer=style #styling\nbody{}\n```\n';
    expect(fenceTagsOf(md).sort()).toEqual(['alpha', 'beta', 'styling']);
  });
  it('returns nothing for prose or bare fences', () => {
    expect(fenceTagsOf('just prose')).toEqual([]);
    expect(fenceTagsOf('```js\ncode\n```')).toEqual([]);
  });
});
