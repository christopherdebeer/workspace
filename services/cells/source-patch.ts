/**
 * source-patch.ts — plan a multi-file patch set against a known base (pure).
 *
 * `applyPatchSet` reads every file the patch touches, hands the bytes here,
 * and gets back either the complete final state or the complete list of what
 * is wrong — never a partial answer. Every change is evaluated even after one
 * fails, so a dry run reports all conflicts at once instead of one per retry.
 *
 * Precondition semantics (documented on the tool):
 * - `ifVersion` / `ifAbsent` / `ifExists` refer to the tree AS IT WAS BEFORE
 *   the patch set — the tree the agent read — not to intermediate states.
 * - The edits themselves apply in order, so two `replace`s on one file chain.
 */
import { cleanPath } from './cell-files';
import { contentVersion, occurrenceOffsets, lineAt } from './source-text';

export interface BaseFile {
  body: Buffer;
  contentType: string;
  version: string;
  etag?: string;
  binary: boolean;
}

export type PatchChange =
  | { op: 'write'; path: string; content: string; encoding?: 'utf8' | 'base64'; ifVersion?: string; ifAbsent?: boolean }
  | {
      op: 'replace';
      path: string;
      old_str: string;
      new_str: string;
      replace_all?: boolean;
      expectedOccurrences?: number;
      matchIndex?: number;
      ifVersion?: string;
    }
  | { op: 'append'; path: string; content: string; ifVersion?: string; ifExists?: boolean }
  | { op: 'delete'; path: string; ifVersion?: string }
  | { op: 'move'; from: string; to: string; ifVersion?: string; overwrite?: boolean };

export interface FileState {
  body: Buffer;
  contentType: string;
  binary: boolean;
}

export interface PatchConflict {
  index: number;
  op: string;
  path: string;
  error: string;
}

export interface PlannedFile {
  path: string;
  /** A = added, M = modified, D = deleted. */
  status: 'A' | 'M' | 'D';
  oldVersion?: string;
  version?: string;
  /** The final state (absent for D). */
  next?: FileState;
  /** When the file arrived here by a move. */
  movedFrom?: string;
}

export interface PatchPlan {
  conflicts: PatchConflict[];
  files: PlannedFile[];
}

export const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

/** Replace semantics shared with `replaceInFile`: ambiguity is refused, not reported after the fact. */
export function planReplace(
  path: string,
  content: string,
  c: { old_str: string; new_str: string; replace_all?: boolean; expectedOccurrences?: number; matchIndex?: number },
): { next: string; replacements: number; occurrences: number; line: number; targets: number[] } {
  if (typeof c.old_str !== 'string' || c.old_str.length === 0) throw new Error('old_str (non-empty string) is required');
  if (typeof c.new_str !== 'string') throw new Error('new_str (string, may be empty) is required');
  if (c.replace_all && c.matchIndex !== undefined) throw new Error('matchIndex cannot be combined with replace_all');
  const offsets = occurrenceOffsets(content, c.old_str);
  const occurrences = offsets.length;
  if (occurrences === 0) {
    throw new Error(`old_str not found in ${path} — it must match exactly (case-sensitive, including whitespace)`);
  }
  const expected = c.expectedOccurrences ?? (c.replace_all || c.matchIndex !== undefined ? undefined : 1);
  if (expected !== undefined && occurrences !== expected) {
    const lines = offsets.slice(0, 20).map((o) => lineAt(content, o));
    throw new Error(
      `old_str occurs ${occurrences} times in ${path} (expected ${expected}; at lines ${lines.join(', ')}${occurrences > 20 ? ', …' : ''}) — nothing was written. ` +
        'Widen old_str to be unique, or pass matchIndex, replace_all, or expectedOccurrences',
    );
  }
  if (c.matchIndex !== undefined && (!Number.isInteger(c.matchIndex) || c.matchIndex < 0 || c.matchIndex >= occurrences)) {
    throw new Error(`matchIndex ${c.matchIndex} is out of range (${occurrences} occurrences, 0-based)`);
  }
  const targets = c.replace_all ? offsets : [offsets[c.matchIndex ?? 0]];
  let next = '';
  let cursor = 0;
  for (const at of targets) {
    next += content.slice(cursor, at) + c.new_str;
    cursor = at + c.old_str.length;
  }
  next += content.slice(cursor);
  return { next, replacements: targets.length, occurrences, line: lineAt(content, targets[0]), targets };
}

/** Every path a change reads or writes (for prefetch), cleaned; invalid paths are reported by `planPatch`. */
export function touchedPaths(changes: PatchChange[]): string[] {
  const out = new Set<string>();
  for (const c of changes) {
    for (const p of c && c.op === 'move' ? [c.from, c.to] : [c?.path]) {
      try { out.add(cleanPath(p as string)); } catch { /* reported by planPatch */ }
    }
  }
  return [...out];
}

const binaryTypeFallback = 'application/octet-stream';

/**
 * Evaluate `changes` against `base` (path → file | null for absent). Returns
 * the conflicts (if any) and the per-file outcome. Callers commit only when
 * `conflicts` is empty — that is the "all or nothing" rule.
 */
export function planPatch(
  base: Map<string, BaseFile | null>,
  changes: PatchChange[],
  binaryTypeFor: (path: string) => string = () => binaryTypeFallback,
): PatchPlan {
  const conflicts: PatchConflict[] = [];
  const state = new Map<string, FileState | null>();
  for (const [p, f] of base) state.set(p, f ? { body: f.body, contentType: f.contentType, binary: f.binary } : null);
  const movedFrom = new Map<string, string>();
  const baseVersion = (p: string): string | undefined => base.get(p)?.version;

  const checkIfVersion = (p: string, ifVersion: unknown): void => {
    if (ifVersion === undefined) return;
    if (typeof ifVersion !== 'string') throw new Error('ifVersion must be a string');
    const actual = baseVersion(p) ?? 'absent';
    if (actual !== ifVersion) throw new Error(`VERSION_CONFLICT on ${p}: expected ${ifVersion}, found ${actual}`);
  };
  const text = (p: string, f: FileState, op: string): string => {
    if (f.binary) throw new Error(`${op} refuses ${p}: it is stored as bytes (${f.contentType})`);
    return f.body.toString('utf-8');
  };

  changes.forEach((c, index) => {
    const op = (c as { op?: unknown })?.op;
    let label = String((c as { path?: unknown })?.path ?? (c as { from?: unknown })?.from ?? '');
    try {
      if (!c || typeof c !== 'object') throw new Error('each change must be an object');
      switch (c.op) {
        case 'write': {
          const p = cleanPath(c.path);
          label = p;
          if (typeof c.content !== 'string') throw new Error('content (string) is required');
          if (c.ifAbsent && c.ifVersion !== undefined) throw new Error('ifAbsent cannot be combined with ifVersion');
          if (c.ifAbsent && base.get(p)) throw new Error(`VERSION_CONFLICT on ${p}: expected absent, found ${baseVersion(p)}`);
          checkIfVersion(p, c.ifVersion);
          if (c.encoding !== undefined && c.encoding !== 'utf8' && c.encoding !== 'base64') throw new Error("encoding must be 'utf8' or 'base64'");
          if (c.encoding === 'base64') {
            const bytes = Buffer.from(c.content, 'base64');
            if (bytes.toString('base64').replace(/=+$/, '') !== c.content.replace(/[\s=]+$/g, '').replace(/\s/g, '')) {
              throw new Error(`content is not valid base64 for ${p}`);
            }
            state.set(p, { body: bytes, contentType: binaryTypeFor(p), binary: true });
          } else {
            state.set(p, { body: Buffer.from(c.content, 'utf-8'), contentType: TEXT_CONTENT_TYPE, binary: false });
          }
          break;
        }
        case 'replace': {
          const p = cleanPath(c.path);
          label = p;
          checkIfVersion(p, c.ifVersion);
          const cur = state.get(p);
          if (!cur) throw new Error(`File not found: ${p}`);
          const r = planReplace(p, text(p, cur, 'replace'), c);
          state.set(p, { body: Buffer.from(r.next, 'utf-8'), contentType: TEXT_CONTENT_TYPE, binary: false });
          break;
        }
        case 'append': {
          const p = cleanPath(c.path);
          label = p;
          if (typeof c.content !== 'string' || c.content.length === 0) throw new Error('content (non-empty string) is required');
          checkIfVersion(p, c.ifVersion);
          if (c.ifExists && !base.get(p)) throw new Error(`File not found: ${p} (ifExists)`);
          const cur = state.get(p);
          const existing = cur ? text(p, cur, 'append') : '';
          state.set(p, { body: Buffer.from(existing + c.content, 'utf-8'), contentType: TEXT_CONTENT_TYPE, binary: false });
          break;
        }
        case 'delete': {
          const p = cleanPath(c.path);
          label = p;
          checkIfVersion(p, c.ifVersion);
          if (!state.get(p)) throw new Error(`File not found: ${p}`);
          state.set(p, null);
          break;
        }
        case 'move': {
          const from = cleanPath(c.from);
          const to = cleanPath(c.to);
          label = from;
          if (from === to) throw new Error('move: from and to are the same path');
          checkIfVersion(from, c.ifVersion);
          const cur = state.get(from);
          if (!cur) throw new Error(`File not found: ${from}`);
          if (state.get(to) && !c.overwrite) throw new Error(`move target exists: ${to} (pass overwrite:true to replace it)`);
          state.set(to, cur);
          state.set(from, null);
          movedFrom.set(to, movedFrom.get(from) ?? from);
          movedFrom.delete(from);
          break;
        }
        default:
          throw new Error(`unknown op "${String(op)}" — expected write | replace | append | delete | move`);
      }
    } catch (err) {
      conflicts.push({ index, op: String(op), path: label, error: (err as Error).message });
    }
  });

  const files: PlannedFile[] = [];
  for (const [path, next] of [...state].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const was = base.get(path) ?? null;
    if (!was && !next) continue;
    if (was && next && was.contentType === next.contentType && was.body.equals(next.body)) continue;
    const planned: PlannedFile = next
      ? { path, status: was ? 'M' : 'A', ...(was ? { oldVersion: was.version } : {}), version: contentVersion(next.body), next }
      : { path, status: 'D', oldVersion: was!.version };
    const src = movedFrom.get(path);
    if (src && next) planned.movedFrom = src;
    files.push(planned);
  }
  return { conflicts, files };
}
