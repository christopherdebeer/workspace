// Stub for the kernel bridge — the home cell's bridge.ts installBridge() wires
// these before mount. The graph calls mcpCall (which goes through authFetch),
// so we stub authFetch to proxy to the live parc.land MCP endpoint if a token
// is present, or return canned data otherwise.

// Auth stubs (the bridge interface)
export const login = () => {};
export const logout = async () => {};
export const completeLoginIfReturning = async () => false;
// Claim authed and let whoami decide: the serve.mjs proxy holds the device
// token; if it's missing/expired, whoami returns 401 and useAuth falls back
// to the landing — exactly the real client's judgement.
export const isAuthed = () => true;
export const cellUrl = (owner, name, rest = '') => `/@${owner}/${name}${rest}`;
export const refreshSessionCookie = () => {};

// authFetch goes through the local serve.mjs proxy — the device token lives
// server-side in /tmp/parc-token.json, never in the page.
export const authFetch = async (path, init) => fetch(path, init);
