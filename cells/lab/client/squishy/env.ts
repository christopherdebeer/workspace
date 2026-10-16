/** What the page was opened with (read once, for every module), and where it keeps what it remembers. */
export const params = new URLSearchParams(location.search);
export const preview = params.has('preview');
export const auto = preview || params.has('auto');
export const STORE = 'squishy:v1';
/** `?fast=N`: N steps of the game a drawn frame (headless tests, where a frame takes seconds); drawn small and plain */
export const FAST = Math.max(0, Math.round(Number(params.get('fast')) || 0));
