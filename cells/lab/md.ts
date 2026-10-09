/**
 * Markdown to HTML, as much of it as the experiments' READMEs use: headings, paragraphs, lists
 * (nested by indent), fenced code, rules, tables, and inline code, bold, italic and links. No
 * dependencies, no raw HTML passed through (everything is escaped first).
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function inline(s: string): string {
  // code spans first (their insides are not formatted), then links, bold, italic
  const codes: string[] = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => `<a href="${/^(https?:|\/|#|\.)/.test(href) ? href : '#'}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/** A heading's id: its text, lower-cased, words joined by hyphens. */
export const slug = (s: string) => s.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function markdown(src: string): { html: string; title: string; headings: Array<{ level: number; text: string; id: string }> } {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  const headings: Array<{ level: number; text: string; id: string }> = [];
  let title = '';
  let para: string[] = [];
  // open lists: their indent and kind
  const lists: Array<{ indent: number; tag: 'ul' | 'ol' }> = [];
  let item: string[] | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushItem = () => {
    if (item) out.push(`<li>${inline(item.join(' '))}`);
    item = null;
  };
  const closeLists = (to = -1) => {
    flushItem();
    while (lists.length && lists[lists.length - 1].indent > to) out.push(`</li></${lists.pop()!.tag}>`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara();
      closeLists();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeLists();
      const level = h[1].length;
      const text = h[2].trim();
      const id = slug(text);
      if (level === 1 && !title) title = text.replace(/`/g, '');
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      closeLists();
      out.push('<hr>');
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushPara();
      closeLists();
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const indent = li[1].length;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      const top = lists[lists.length - 1];
      if (!top || indent > top.indent) {
        if (item) out.push(`<li>${inline((item as string[]).join(' '))}`);
        item = null;
        out.push(`<${tag}>`);
        lists.push({ indent, tag });
      } else {
        closeLists(indent);
        flushItem();
        if (lists.length) out.push('</li>');
        else {
          out.push(`<${tag}>`);
          lists.push({ indent, tag });
        }
      }
      item = [li[3]];
      continue;
    }
    if (!line.trim()) {
      flushPara();
      if (!(lines[i + 1] ?? '').match(/^\s+([-*]|\d+\.)\s|^\s{2,}\S/)) closeLists();
      continue;
    }
    // a continuation: of the open list item, or of the paragraph
    if (item && /^\s+\S/.test(line)) item.push(line.trim());
    else {
      closeLists();
      para.push(line.trim());
    }
  }
  flushPara();
  closeLists();
  return { html: out.join('\n'), title, headings };
}
