/**
 * source-tree.ts — a cell's source as a coherent, versioned tree.
 *
 * Per-file versions made single edits safe; this gives the TREE an identity:
 *
 *   treeVersion = tree:sha256( sorted  "<path>\t<contentVersion>\n"  lines )
 *
 * derived only from paths and content — never timestamps or ETags — so the
 * same source always has the same treeVersion, whoever computes it.
 *
 * S3 layout added beside src/ (see docs/cell-storage-s3.md):
 *
 *   cells/<id>/blobs/<sha256>             immutable content, stored once per version
 *   cells/<id>/snapshots/<treehash>.json  immutable manifest: path → version + type
 *   cells/<id>/tree/index.json            cache: path → {etag, version} (a hint, never trusted blind)
 *   cells/<id>/tree/lock.json             patch-set commit lock + rollback journal
 *
 * Computing a treeVersion costs one LIST plus a GET only for files whose ETag
 * moved since the cache last saw them — so on a 292-file cell it is cheap after
 * the first time, and it stays correct when files are written by any path
 * (importSrc, cell-sync, another agent) because every entry is revalidated
 * against the ETag S3 reports in the listing.
 */
import { createHash, randomUUID } from 'node:crypto';
import { srcPrefix, srcKey } from './cell-files';
import {
  getObjectRaw,
  listObjectsMeta,
  putObject,
  putObjectIf,
  deleteObject,
  copyObjectIf,
  PreconditionFailedError,
} from './provisioner';
import { contentVersion, mapLimit } from './source-text';

export interface TreeEntry {
  path: string;
  version: string;
  contentType: string;
  bytes: number;
  /** The S3 generation the version was computed from (live tree only). */
  etag?: string;
}

export interface Tree {
  treeVersion: string;
  files: TreeEntry[];
  bytes: number;
}

export interface Snapshot {
  treeVersion: string;
  createdAt: string;
  createdBy?: string;
  count: number;
  bytes: number;
  files: Array<Omit<TreeEntry, 'etag'>>;
}

interface IndexEntry {
  etag: string;
  version: string;
  contentType: string;
  bytes: number;
}

interface TreeIndex {
  files: Record<string, IndexEntry>;
  /** Versions known to be stored under blobs/ (a cache; re-storing is idempotent). */
  blobs: Record<string, 1>;
}

/** What a patch-set commit intends: every touched path's before and after version. */
export interface Journal {
  base: Record<string, string | null>;
  next: Record<string, string | null>;
  /** Content type to restore each base with. */
  baseTypes: Record<string, string>;
}

interface LockBody {
  id: string;
  holder: string;
  acquiredAt: string;
  expiresAt: string;
  journal?: Journal;
}

export interface Lock {
  id: string;
  etag?: string;
  body: LockBody;
}

const VERSION_RE = /^sha256:([0-9a-f]{64})$/;
const TREE_RE = /^tree:([0-9a-f]{64})$/;

/** A commit lock outlives the forge Lambda's 120 s timeout, so an expired lock means its holder is dead. */
export const LOCK_TTL_MS = 150_000;

export function treeVersionOf(entries: Array<{ path: string; version: string }>): string {
  const lines = entries
    .map((e) => `${e.path}\t${e.version}\n`)
    .sort();
  return `tree:${createHash('sha256').update(lines.join('')).digest('hex')}`;
}

export function isTreeVersion(v: unknown): v is string {
  return typeof v === 'string' && TREE_RE.test(v);
}

export const blobKey = (cellId: string, version: string): string => {
  const m = VERSION_RE.exec(version);
  if (!m) throw new Error(`invalid content version "${version}"`);
  return `cells/${cellId}/blobs/${m[1]}`;
};
export const snapshotKey = (cellId: string, treeVersion: string): string => {
  const m = TREE_RE.exec(treeVersion);
  if (!m) throw new Error(`invalid treeVersion "${treeVersion}" — expected tree:<64 hex>`);
  return `cells/${cellId}/snapshots/${m[1]}.json`;
};
const indexKey = (cellId: string): string => `cells/${cellId}/tree/index.json`;
const lockKey = (cellId: string): string => `cells/${cellId}/tree/lock.json`;

export class TreeConflictError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `TREE_CONFLICT: expected ${expected}, found ${actual} — the source tree changed since you inspected it; nothing was written. ` +
        'cells.diff({from:"<your treeVersion>", to:"current"}) shows what moved',
    );
    this.name = 'TreeConflictError';
  }
}

export class TreeStore {
  private index?: TreeIndex;
  private dirty = false;

  constructor(private readonly bucket: string, private readonly cellId: string) {}

  private async loadIndex(): Promise<TreeIndex> {
    if (this.index) return this.index;
    const raw = await getObjectRaw(this.bucket, indexKey(this.cellId));
    let idx: TreeIndex = { files: {}, blobs: {} };
    if (raw) {
      try {
        const parsed = JSON.parse(raw.body.toString('utf-8')) as Partial<TreeIndex>;
        idx = { files: parsed.files ?? {}, blobs: parsed.blobs ?? {} };
      } catch {
        // A corrupt cache is just a cold cache.
      }
    }
    this.index = idx;
    return idx;
  }

  /** Persist the cache if it changed. Best-effort: a lost write only costs re-hashing. */
  async flush(): Promise<void> {
    if (!this.dirty || !this.index) return;
    await putObject(this.bucket, indexKey(this.cellId), JSON.stringify(this.index), 'application/json');
    this.dirty = false;
  }

  /** Teach the cache about files this process just wrote (their ETags came back from the PUT). */
  async seed(entries: Array<{ path: string } & IndexEntry>): Promise<void> {
    const idx = await this.loadIndex();
    for (const { path, ...e } of entries) {
      if (!e.etag) continue;
      idx.files[path] = e;
      this.dirty = true;
    }
  }

  /** The live src/ tree and its treeVersion. */
  async tree(): Promise<Tree> {
    const prefix = srcPrefix(this.cellId);
    const listed = (await listObjectsMeta(this.bucket, prefix))
      .map((o) => ({ path: o.key.slice(prefix.length), etag: o.etag }))
      .filter((o) => o.path);
    const idx = await this.loadIndex();
    const entries = await mapLimit(listed, 16, async (o): Promise<TreeEntry | null> => {
      const cached = idx.files[o.path];
      if (cached && o.etag && cached.etag === o.etag) {
        return { path: o.path, version: cached.version, contentType: cached.contentType, bytes: cached.bytes, etag: cached.etag };
      }
      const raw = await getObjectRaw(this.bucket, prefix + o.path);
      if (!raw) return null; // deleted between LIST and GET
      const e: IndexEntry = {
        etag: raw.etag ?? o.etag ?? '',
        version: contentVersion(raw.body),
        contentType: raw.contentType,
        bytes: raw.body.length,
      };
      if (e.etag) {
        idx.files[o.path] = e;
        this.dirty = true;
      }
      return { path: o.path, ...e, etag: e.etag || undefined };
    });
    const files = entries.filter((e): e is TreeEntry => e !== null).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const live = new Set(files.map((f) => f.path));
    for (const p of Object.keys(idx.files)) {
      if (!live.has(p)) { delete idx.files[p]; this.dirty = true; }
    }
    return { treeVersion: treeVersionOf(files), files, bytes: files.reduce((n, f) => n + f.bytes, 0) };
  }

  async readBlob(version: string): Promise<Buffer | null> {
    const raw = await getObjectRaw(this.bucket, blobKey(this.cellId, version));
    return raw ? raw.body : null;
  }

  /** Store content under its version (idempotent — an existing blob is the same bytes by construction). */
  async putBlob(version: string, body: Buffer, contentType: string): Promise<void> {
    const idx = await this.loadIndex();
    if (idx.blobs[version]) return;
    try {
      await putObjectIf(this.bucket, blobKey(this.cellId, version), body, contentType, { ifNoneMatch: '*' });
    } catch (err) {
      if (!(err instanceof PreconditionFailedError)) throw err;
    }
    idx.blobs[version] = 1;
    this.dirty = true;
  }

  /** The bytes of `path` at `version` — from the blob store, or from src/ if it is still at that version. */
  async readVersion(path: string, version: string): Promise<Buffer> {
    const blob = await this.readBlob(version);
    if (blob) return blob;
    const raw = await getObjectRaw(this.bucket, srcKey(this.cellId, path));
    if (raw && contentVersion(raw.body) === version) return raw.body;
    throw new Error(`content for ${path}@${version} is no longer available (it was never snapshotted)`);
  }

  async loadSnapshot(treeVersion: string): Promise<Snapshot | null> {
    const raw = await getObjectRaw(this.bucket, snapshotKey(this.cellId, treeVersion));
    return raw ? (JSON.parse(raw.body.toString('utf-8')) as Snapshot) : null;
  }

  /**
   * Freeze a tree: every file's bytes into blobs/, then an immutable manifest.
   *
   * Blobs are server-side copies pinned to the ETag the version was hashed
   * from, so a blob can never hold bytes other than its version. Without a
   * given `tree`, the live tree is re-listed afterwards and the snapshot is
   * retried if anything moved — the manifest then names a tree that really
   * existed. `inline` supplies bytes already in memory (a patch set's output).
   */
  async snapshot(opts: { tree?: Tree; createdBy?: string; inline?: Map<string, { body: Buffer; contentType: string }> } = {}): Promise<Snapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tree = opts.tree ?? (await this.tree());
      const existing = await this.loadSnapshot(tree.treeVersion);
      if (existing) {
        await this.flush();
        return existing;
      }
      const idx = await this.loadIndex();
      let moved = false;
      await mapLimit(tree.files, 16, async (f) => {
        if (moved || idx.blobs[f.version]) return;
        const inline = opts.inline?.get(f.version);
        if (inline) {
          await this.putBlob(f.version, inline.body, inline.contentType);
          return;
        }
        if (!f.etag) throw new Error(`cannot snapshot ${f.path}: no ETag to pin the copy to`);
        try {
          await copyObjectIf(this.bucket, srcKey(this.cellId, f.path), blobKey(this.cellId, f.version), f.etag);
          idx.blobs[f.version] = 1;
          this.dirty = true;
        } catch (err) {
          if (err instanceof PreconditionFailedError) moved = true;
          else throw err;
        }
      });
      if (!moved && !opts.tree) {
        const prefix = srcPrefix(this.cellId);
        const again = new Map(
          (await listObjectsMeta(this.bucket, prefix)).map((o) => [o.key.slice(prefix.length), o.etag] as const).filter(([p]) => p),
        );
        moved = again.size !== tree.files.length || tree.files.some((f) => again.get(f.path) !== f.etag);
      }
      if (moved) {
        if (opts.tree) throw new Error('source changed while snapshotting the patched tree; the patch landed — call cells.snapshot to freeze the current tree');
        continue;
      }
      const snap: Snapshot = {
        treeVersion: tree.treeVersion,
        createdAt: new Date().toISOString(),
        ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
        count: tree.files.length,
        bytes: tree.bytes,
        files: tree.files.map(({ path, version, contentType, bytes }) => ({ path, version, contentType, bytes })),
      };
      try {
        await putObjectIf(this.bucket, snapshotKey(this.cellId, tree.treeVersion), JSON.stringify(snap), 'application/json', { ifNoneMatch: '*' });
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err; // same tree already frozen — immutable, same content
      }
      await this.flush();
      return snap;
    }
    throw new Error('the source tree kept changing while snapshotting (3 attempts); retry when writers settle');
  }

  // ─── Patch-set commit lock ─────────────────────────────────────────

  /**
   * Take the cell's commit lock. Patch sets serialize on it, so two
   * ifTreeVersion-checked patch sets can never both commit against the same
   * tree. An expired lock means its holder died mid-commit: its journal is
   * replayed backwards first (restoring every path still at the dead commit's
   * version), so a crash can never leave half a patch set behind for long.
   */
  async acquireLock(holder: string): Promise<{ lock: Lock; recovered: string[] }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const body: LockBody = {
        id: randomUUID(),
        holder,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
      };
      try {
        const r = await putObjectIf(this.bucket, lockKey(this.cellId), JSON.stringify(body), 'application/json', { ifNoneMatch: '*' });
        return { lock: { id: body.id, etag: r.etag, body }, recovered: [] };
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err;
      }
      const raw = await getObjectRaw(this.bucket, lockKey(this.cellId));
      if (!raw) continue;
      let held: LockBody;
      try {
        held = JSON.parse(raw.body.toString('utf-8')) as LockBody;
      } catch {
        held = { id: '?', holder: '?', acquiredAt: '', expiresAt: new Date(0).toISOString() };
      }
      if (Date.parse(held.expiresAt) > Date.now()) {
        throw new Error(`LOCKED: another patch set (${held.holder}) is committing on this cell until ${held.expiresAt}; retry shortly`);
      }
      const recovered = held.journal ? await this.rollback(held.journal) : [];
      try {
        const r = await putObjectIf(this.bucket, lockKey(this.cellId), JSON.stringify(body), 'application/json', { ifMatch: raw.etag });
        return { lock: { id: body.id, etag: r.etag, body }, recovered };
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err;
      }
    }
    throw new Error('LOCKED: could not take the commit lock (contended); retry shortly');
  }

  /** Record what is about to be written, so a crash can be undone by the next lock holder. */
  async writeJournal(lock: Lock, journal: Journal): Promise<void> {
    const body = { ...lock.body, journal };
    try {
      const r = await putObjectIf(this.bucket, lockKey(this.cellId), JSON.stringify(body), 'application/json', lock.etag ? { ifMatch: lock.etag } : {});
      lock.etag = r.etag;
      lock.body = body;
    } catch (err) {
      if (err instanceof PreconditionFailedError) throw new Error('lost the commit lock before committing (it expired); nothing was written — retry');
      throw err;
    }
  }

  async releaseLock(lock: Lock): Promise<void> {
    const raw = await getObjectRaw(this.bucket, lockKey(this.cellId));
    if (!raw) return;
    try {
      if ((JSON.parse(raw.body.toString('utf-8')) as LockBody).id !== lock.id) return;
    } catch {
      return;
    }
    await deleteObject(this.bucket, lockKey(this.cellId));
  }

  /**
   * Undo a commit: every path whose live content is still exactly what the
   * journal says the commit wrote goes back to its base (from blobs/), and
   * paths the commit created are removed. A path someone else has since
   * changed is left alone — their write is newer than the commit being undone.
   * Returns the paths restored.
   */
  async rollback(journal: Journal): Promise<string[]> {
    const restored: string[] = [];
    for (const path of Object.keys(journal.next)) {
      const key = srcKey(this.cellId, path);
      const cur = await getObjectRaw(this.bucket, key);
      const curVersion = cur ? contentVersion(cur.body) : null;
      if (curVersion !== journal.next[path]) continue;
      const baseVersion = journal.base[path];
      if (baseVersion === null) {
        if (cur) {
          await deleteObject(this.bucket, key);
          restored.push(path);
        }
        continue;
      }
      if (curVersion === baseVersion) continue;
      const body = await this.readBlob(baseVersion);
      if (!body) continue; // base was never stored — cannot restore; left as committed
      try {
        await putObjectIf(this.bucket, key, body, journal.baseTypes[path] ?? 'application/octet-stream', cur?.etag ? { ifMatch: cur.etag } : { ifNoneMatch: '*' });
        restored.push(path);
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err;
      }
    }
    return restored;
  }
}
