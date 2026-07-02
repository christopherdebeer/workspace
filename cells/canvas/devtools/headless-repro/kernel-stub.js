// Stub for https://parc.land/@c15r/kernel/app.js — benign no-op substrate.
export const mcp = async () => ({});
export const read = () => new Promise(() => {
  // Never settles: a resolved-empty read would wipe the hydrated board on the
  // background refresh, a rejected one falls back to empty state — pending
  // keeps the hydrate payload live, which is what the harness wants.
});
export const act = async () => ({});
export const ensureAuth = async () => true;
export const isAuthed = () => true;
export const accessToken = () => 'stub-token';
export const authFetch = (...args) => fetch(...args);
export const login = async () => {};
export const signOut = () => {};
export const requestScopes = async () => true;
export const loadTypes = async () => ({});
export const titleOf = (entry) => (entry && entry.key) || 'fact';
export const hrefOf = () => '#';
