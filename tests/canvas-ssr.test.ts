import { covers, covers0, mayRenderBoard } from '../cells/canvas/index';

/**
 * Canvas SSR authority gate (kb: canvas-ssr-anonymous-board-disclosure).
 * The owner gets a server-painted board; everyone else only when the owner has
 * shared it via `_public/canvas:<board>`. Otherwise the cell must serve the bare
 * shell so the client hydrates with the viewer's own session (API enforces grants).
 */
describe('canvas SSR _public/ gate', () => {
  describe('covers', () => {
    it('matches the whole-slice wildcard', () => {
      expect(covers('*', 'canvas:anything')).toBe(true);
    });
    it('matches a trailing-* prefix', () => {
      expect(covers('canvas:*', 'canvas:board-1')).toBe(true);
      expect(covers('canvas:demo-*', 'canvas:demo-1')).toBe(true);
      expect(covers('canvas:demo-*', 'canvas:other')).toBe(false);
    });
    it('matches an exact key only', () => {
      expect(covers('canvas:board-1', 'canvas:board-1')).toBe(true);
      expect(covers('canvas:board-1', 'canvas:board-2')).toBe(false);
    });
  });

  describe('mayRenderBoard', () => {
    it('always renders for the owner, even with no public shares', () => {
      expect(mayRenderBoard('canvas-002', true, [])).toBe(true);
    });

    it('refuses a non-owner when the board is not shared (the disclosure fix)', () => {
      // The pre-fix bug: this private board rendered to anyone. Now: shell only.
      expect(mayRenderBoard('canvas-002', false, [])).toBe(false);
      // Shares of OTHER keys (e.g. lit docs) do not unlock a board.
      expect(mayRenderBoard('canvas-002', false, ['doc:docs/*'])).toBe(false);
    });

    it('renders for a non-owner only when a _public/ pattern covers the board', () => {
      expect(mayRenderBoard('board-1', false, ['canvas:board-1'])).toBe(true);
      expect(mayRenderBoard('board-1', false, ['canvas:*'])).toBe(true);
      expect(mayRenderBoard('board-1', false, ['*'])).toBe(true);
      expect(mayRenderBoard('board-2', false, ['canvas:board-1'])).toBe(false);
    });
  });

  it('covers0 is an any-pattern match', () => {
    expect(covers0(['doc:x', 'canvas:y'], 'canvas:y')).toBe(true);
    expect(covers0(['doc:x'], 'canvas:y')).toBe(false);
    expect(covers0([], 'canvas:y')).toBe(false);
  });
});
