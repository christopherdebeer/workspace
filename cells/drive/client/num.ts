/**
 * The arithmetic every other module borrows. `clamp` is reached by 44 of
 * main.ts's state-free functions and by half the siblings — the single most
 * shared thing in the client — and until now each file that left main.ts had
 * to either take a copy or reach back for it. One declaration, imported.
 */
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
