/** Typecheck-only shim for the runtime kernel URL import (.tsconfig.check.json
 *  maps the https:// specifier here; the forge bundler and the browser resolve
 *  the real module). Deliberately loose — the kernel's surface is dynamic. */
export declare const login: (...args: any[]) => any;
export declare const signOut: (...args: any[]) => any;
export declare const ensureAuth: (...args: any[]) => any;
export declare const isAuthed: (...args: any[]) => any;
export declare const authFetch: (...args: any[]) => any;
export declare const cellUrl: (...args: any[]) => any;
export declare const accessToken: (...args: any[]) => any;
export declare const loadTypes: (...args: any[]) => any;
export declare const titleOf: (...args: any[]) => any;
export declare const hrefOf: (...args: any[]) => any;
export declare const createOutbox: (...args: any[]) => any;
export declare const createProjection: (...args: any[]) => any;
export declare const stableStringify: (...args: any[]) => any;
