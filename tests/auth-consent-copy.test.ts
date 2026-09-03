import { friendlyError, requesterIdentity, requesterName } from '../services/auth/client/copy';

// The authorize screen used to headline "workspace [auth]" and, at consent,
// tell a reader that a cell "is requesting access to your workspace" directly
// above a checkbox reading "nothing in your workspace". These two helpers are
// what replaced that: they decide the headline of every sign-in and the
// sentence shown when one fails.
const APEX = 'https://parc.land';

describe('what the authorize screen calls the thing you are signing in to', () => {
  it('names a cell served from its own host', () => {
    expect(requesterName('https://c15r-shelved.on.parc.land', APEX)).toBe('Shelved');
    expect(requesterName('https://c15r-shelved.on.parc.land/readers', APEX)).toBe('Shelved');
  });
  it('names a cell served from an apex path', () => {
    expect(requesterName('https://parc.land/@c15r/shelved', APEX)).toBe('Shelved');
    expect(requesterName('https://parc.land/@c15r/drive/deep/link', APEX)).toBe('Drive');
  });
  it('makes a hyphenated cell readable rather than echoing the slug', () => {
    expect(requesterName('https://parc.land/@c15r/reef-writer', APEX)).toBe('Reef writer');
  });
  // A platform redirect is not a cell, and inventing a name for it would put a
  // wrong noun in the headline. Falling back to a plain "Sign in" is correct.
  it('names nothing when the redirect is not a cell', () => {
    expect(requesterName('https://parc.land/', APEX)).toBeNull();
    expect(requesterName('https://claude.ai/api/mcp/auth_callback', APEX)).toBeNull();
    expect(requesterName(undefined, APEX)).toBeNull();
    expect(requesterName('not-a-url', APEX)).toBeNull();
  });

  // The headline is the one thing on this screen that says who is asking, and
  // the redirect_uri is chosen by whoever built the authorize URL. Unanchored,
  // every one of these read "Shelved" while the code went elsewhere.
  describe('and refuses to be told by a stranger', () => {
    it('will not read a cell address off a foreign origin', () => {
      expect(requesterName('https://evil.example/@c15r/shelved', APEX)).toBeNull();
      expect(requesterName('https://evil.example/@c15r/shelved/anything', APEX)).toBeNull();
    });
    it('will not accept a cell host under someone else’s domain', () => {
      expect(requesterName('https://c15r-shelved.on.evil.example', APEX)).toBeNull();
    });
    it('will not accept a suffix that merely ends with ours', () => {
      expect(requesterName('https://parc.land.evil.example/@c15r/shelved', APEX)).toBeNull();
      expect(requesterName('https://c15r-shelved.on.parc.land.evil.example', APEX)).toBeNull();
    });
    // One label before `.on.` — a deeper name is not a cell host we serve.
    it('will not accept a deeper label under the cell domain', () => {
      expect(requesterName('https://a.c15r-shelved.on.parc.land', APEX)).toBeNull();
    });
    it('names nothing when it has no anchor to check against', () => {
      expect(requesterName('https://parc.land/@c15r/shelved', undefined)).toBeNull();
    });
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


// Registration is open (RFC 7591) and `client_name` is whatever the registrant
// typed, so the consent screen must never lead with it. A client registered as
// "parc.land" pointing at its own origin used to be introduced, in bold, as
// parc.land.
describe('what the consent screen is allowed to call the requester', () => {
  const APEX2 = 'https://parc.land';

  it('names a cell we serve, because we serve it', () => {
    expect(requesterIdentity('https://c15r-shelved.on.parc.land', APEX2, 'parc.land'))
      .toEqual({ kind: 'cell', name: 'Shelved' });
    expect(requesterIdentity('https://parc.land/@c15r/drive', APEX2, null))
      .toEqual({ kind: 'cell', name: 'Drive' });
  });

  it('calls our own apex the platform, not a cell', () => {
    expect(requesterIdentity('https://parc.land/', APEX2, 'parc.land'))
      .toEqual({ kind: 'platform', origin: 'parc.land' });
  });

  // The point of the whole exercise: a stranger is introduced by the origin the
  // code can actually reach, and its chosen name is demoted to a claim.
  it('introduces a stranger by origin and demotes its chosen name to a claim', () => {
    expect(requesterIdentity('https://evil.example/cb', APEX2, 'parc.land'))
      .toEqual({ kind: 'external', origin: 'evil.example', claimed: 'parc.land' });
  });

  it('does not let a lookalike host pass as ours', () => {
    expect(requesterIdentity('https://parc.land.evil.example/@c15r/shelved', APEX2, 'Shelved'))
      .toEqual({ kind: 'external', origin: 'parc.land.evil.example', claimed: 'Shelved' });
    expect(requesterIdentity('https://c15r-shelved.on.evil.example', APEX2, null))
      .toEqual({ kind: 'external', origin: 'c15r-shelved.on.evil.example' });
  });

  // A real connected client should still read sensibly, not alarmingly.
  it('reads sensibly for a genuine third-party client', () => {
    expect(requesterIdentity('https://claude.ai/api/mcp/auth_callback', APEX2, 'Claude'))
      .toEqual({ kind: 'external', origin: 'claude.ai', claimed: 'Claude' });
  });

  it('omits the claim when none was registered', () => {
    expect(requesterIdentity('https://claude.ai/cb', APEX2, null))
      .toEqual({ kind: 'external', origin: 'claude.ai' });
  });

  it('says nothing at all without a usable redirect', () => {
    expect(requesterIdentity(undefined, APEX2, 'Claude')).toBeNull();
    expect(requesterIdentity('not-a-url', APEX2, 'Claude')).toBeNull();
  });
});
