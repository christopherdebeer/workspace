import { friendlyError, requesterName } from '../services/auth/client/copy';

// The authorize screen used to headline "workspace [auth]" and, at consent,
// tell a reader that a cell "is requesting access to your workspace" directly
// above a checkbox reading "nothing in your workspace". These two helpers are
// what replaced that: they decide the headline of every sign-in and the
// sentence shown when one fails.
describe('what the authorize screen calls the thing you are signing in to', () => {
  it('names a cell served from its own host', () => {
    expect(requesterName('https://c15r-shelved.on.parc.land')).toBe('Shelved');
    expect(requesterName('https://c15r-shelved.on.parc.land/readers')).toBe('Shelved');
  });
  it('names a cell served from an apex path', () => {
    expect(requesterName('https://parc.land/@c15r/shelved')).toBe('Shelved');
    expect(requesterName('https://parc.land/@c15r/drive/deep/link')).toBe('Drive');
  });
  it('makes a hyphenated cell readable rather than echoing the slug', () => {
    expect(requesterName('https://parc.land/@c15r/reef-writer')).toBe('Reef writer');
  });
  // A platform redirect is not a cell, and inventing a name for it would put a
  // wrong noun in the headline. Falling back to a plain "Sign in" is correct.
  it('names nothing when the redirect is not a cell', () => {
    expect(requesterName('https://parc.land/')).toBeNull();
    expect(requesterName('https://claude.ai/api/mcp/auth_callback')).toBeNull();
    expect(requesterName(undefined)).toBeNull();
    expect(requesterName('not-a-url')).toBeNull();
  });
});

describe('what it says when sign-in fails', () => {
  // The one a reader hits constantly: dismissing the system passkey sheet.
  it('translates a cancelled or timed-out passkey prompt', () => {
    const r = friendlyError('NotAllowedError: The operation either timed out or was not allowed.');
    expect(r.message).toMatch(/cancelled|timed out/i);
    expect(r.message).not.toMatch(/NotAllowedError/);
  });
  it('points an unknown passkey at registration', () => {
    const raw = 'Unknown credential abc — no server record for this passkey (expected rpId=parc.land)';
    expect(friendlyError(raw).message).toMatch(/create an account/i);
  });
  it('keeps the diagnostic string, it just stops being the whole message', () => {
    const raw = 'Authentication verification returned false (expectedRPID=parc.land, allowedOrigins=https://parc.land)';
    const r = friendlyError(`NotAllowedError ${raw}`);
    expect(r.detail).toContain('expectedRPID=parc.land');
    expect(r.message).not.toContain('expectedRPID');
  });
  // Anything unrecognised must survive verbatim — a swallowed error is worse
  // than an ugly one.
  it('passes an unrecognised failure through unchanged', () => {
    expect(friendlyError('Consent failed')).toEqual({ message: 'Consent failed' });
  });
});
