/**
 * cell-files.ts — S3 key layout for the cell common layer (see
 * `docs/cell-storage-s3.md`). One shared bucket, prefixed per cell:
 *
 *   cells/<cellId>/src/<path>          multi-file source (deploys)
 *   cells/<cellId>/build/<version>.zip built artifact
 *   cells/<cellId>/data/<user>/<key>   per-caller blob store (never deploys)
 *
 * Path traversal is blocked here so a file/data op can never escape the cell's
 * prefix — the keystone of the (forge-mediated) isolation in v1.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Normalise + validate a relative path; reject traversal and unsafe characters. */
export function cleanPath(path: string): string {
  const trimmed = (path ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) throw new Error('path is required');
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.' || !SAFE_SEGMENT.test(seg)) {
      throw new Error(`invalid path segment "${seg}" — only [A-Za-z0-9._-], no traversal`);
    }
  }
  return segments.join('/');
}

export const srcPrefix = (cellId: string): string => `cells/${cellId}/src/`;
export const srcKey = (cellId: string, path: string): string => `${srcPrefix(cellId)}${cleanPath(path)}`;
export const buildKey = (cellId: string, version: string): string => `cells/${cellId}/build/${cleanPath(version)}.zip`;
export const dataPrefix = (cellId: string, user: string): string => `cells/${cellId}/data/${cleanPath(user)}/`;
export const dataKey = (cellId: string, user: string, key: string): string => `${dataPrefix(cellId, user)}${cleanPath(key)}`;
