/**
 * ── A GLSL IDENTIFIER IS CHECKED AGAINST ES 3.00, NOT ES 1.00 ──
 *
 *   node cells/drive/devtools/glsl-reserved.test.mjs
 *
 * WHY THIS CANNOT BE LEFT TO A RUN. three compiles `#version 300 es` on a
 * WebGL2 context and ES 1.00 on WebGL1, and the two have different reserved
 * word lists — so a shader naming a variable `patch`, `sample`, `filter` or
 * `cast` compiles perfectly in the harness (whose SwiftShader context is
 * WebGL1) and fails to link on every phone. It cost a deploy: the sward's
 * structural expression shipped with a parameter called `patch` and the
 * device dump came back with
 *
 *   ERROR: 0:224: 'patch' : Illegal use of reserved word
 *
 * on TWO programs — and the world looked fine, because a program that fails
 * to link logs to the console and throws nothing. This repo has recorded the
 * same fault once before for `cast` in the façade shader; the difference now
 * is that it is checked rather than remembered.
 *
 * WHAT IS SCANNED. Every template literal in `client/` that looks like GLSL,
 * with its comments stripped — a reserved word in a comment is harmless, and
 * the prose in these files is full of them. The word list is the ES 3.00
 * "reserved for future use" set, which is the one that bites: the ordinary
 * keywords (`in`, `out`, `flat`, `switch`) are errors a compiler catches on
 * both profiles and nobody ships, and three's own ES3 prelude #defines
 * `attribute` and `varying` away.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../client/', import.meta.url).pathname;
let fails = 0, scanned = 0, blocks = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

/** GLSL ES 3.00 §3.7, the words reserved for future use — plus `cast` and
 *  `sizeof`, which ES 1.00 reserves too and which this repo has already been
 *  bitten by once. Not the keywords: a keyword misused is an error on every
 *  profile and never reaches a device. */
export const RESERVED = [
  'common', 'partition', 'active', 'asm', 'class', 'union', 'enum', 'typedef',
  'template', 'this', 'packed', 'goto', 'inline', 'noinline', 'volatile',
  'public', 'static', 'extern', 'external', 'interface', 'long', 'short',
  'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output',
  'filter', 'sizeof', 'cast', 'namespace', 'using', 'row_major', 'patch',
  'sample', 'subroutine', 'resource', 'coherent', 'restrict', 'readonly',
  'writeonly', 'atomic_uint',
];

/** Every template literal in a TS source, with `${...}` spans removed — a
 *  substitution is TypeScript and its own identifiers are not GLSL. Tracks
 *  nesting because a substitution may itself contain a template literal. */
function templateLiterals(src) {
  const out = [];
  let i = 0, depth = 0, buf = '', sub = 0;
  while (i < src.length) {
    const c = src[i];
    if (depth === 0) {
      // Skip line and block comments and quoted strings so a backtick inside
      // one does not open a phantom literal.
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
        i++; continue;
      }
      if (c === '`') { depth = 1; buf = ''; sub = 0; i++; continue; }
      i++; continue;
    }
    if (c === '\\') { buf += ' '; i += 2; continue; }
    if (sub === 0 && c === '`') { out.push(buf); depth = 0; i++; continue; }
    if (sub === 0 && c === '$' && src[i + 1] === '{') { sub = 1; i += 2; buf += ' 0.0 '; continue; }
    if (sub > 0) {
      if (c === '{') sub++;
      else if (c === '}') sub--;
      i++; continue;
    }
    buf += c; i++;
  }
  return out;
}

// Comments go, and so does the NAME INSIDE an #include: three's chunks are
// called `common`, `fog_pars_fragment` and so on, and `common` is on the
// reserved list — but a chunk name is not an identifier in the shader, it is
// an argument to three's own preprocessor, which substitutes the chunk before
// a compiler ever sees the line. Twelve of these in main.ts alone; a checker
// that reports them is a checker nobody runs.
const stripComments = (g) => g
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/#include\s*<[^>]*>/g, ' ');
const looksGlsl = (g) => /\b(?:vec[234]|mat[234]|sampler2D|gl_Position|gl_FragColor)\b/.test(g)
  && /[;{]/.test(g);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) files.push(p);
  }
})(ROOT);

console.log('GLSL template literals, against the ES 3.00 reserved list:\n');
const hits = [];
for (const f of files.sort()) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('`')) continue;
  scanned++;
  for (const lit of templateLiterals(src)) {
    if (!looksGlsl(lit)) continue;
    blocks++;
    const body = stripComments(lit);
    for (const w of RESERVED) {
      const re = new RegExp(`(^|[^\\w.])${w}(?![\\w])`, 'g');
      let m;
      while ((m = re.exec(body))) {
        const upto = body.slice(0, m.index);
        hits.push({ file: relative(ROOT, f), word: w, line: upto.split('\n').length, near: body.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ').trim() });
      }
    }
  }
}
for (const h of hits) console.log(`  FAIL ${h.file}: '${h.word}' is reserved in GLSL ES 3.00 — …${h.near}…`);
fails += hits.length;
check(hits.length === 0, `no reserved word is used as an identifier (${blocks} GLSL blocks in ${scanned} files)`);
check(blocks > 20, `the scanner actually found the shaders (${blocks} blocks) — a zero here is a broken scanner, not a clean tree`);

// THE NEGATIVE CONTROL, because a checker that cannot fail is decoration.
// The exact form that shipped, and the fixed form beside it.
const bad = 'vec3 f(float patch) { float x = smoothstep(0.0, 1.0, patch); return vec3(x); }';
const good = 'vec3 f(float clumpN) { float x = smoothstep(0.0, 1.0, clumpN); return vec3(x); }';
const scan = (g) => RESERVED.some((w) => new RegExp(`(^|[^\\w.])${w}(?![\\w])`).test(stripComments(g)));
check(looksGlsl(bad) && scan(bad), 'the form that shipped is caught');
check(looksGlsl(good) && !scan(good), '…and the form that replaced it is not');
check(!scan('vec3 f() { /* a coherent patch of sward */ return vec3(0.0); }'),
  'a reserved word in a GLSL comment is not a fault');

console.log(fails ? `\n${fails} FAILURES` : '\nglsl-reserved: all ok');
process.exitCode = fails ? 1 : 0;
