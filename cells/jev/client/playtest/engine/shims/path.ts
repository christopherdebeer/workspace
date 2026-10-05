/* POSIX path subset for the vendored engine (generated). */
export function join(...parts: string[]): string {
  const stack: string[] = [];
  const abs = parts[0]?.startsWith('/');
  for (const seg of parts.join('/').split('/')) {
    if (seg === '..') stack.pop();
    else if (seg && seg !== '.') stack.push(seg);
  }
  return (abs ? '/' : '') + stack.join('/');
}
export function dirname(p: string): string {
  const i = p.replace(/\/$/, '').lastIndexOf('/');
  return i <= 0 ? (p.startsWith('/') ? '/' : '.') : p.slice(0, i);
}
export function basename(p: string, ext?: string): string {
  const b = p.replace(/\/$/, '').split('/').pop() ?? '';
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}
export default { join, dirname, basename };
