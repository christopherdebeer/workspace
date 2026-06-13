/**
 * Image imports resolve to data-URI strings: the HttpServiceCell client build
 * passes `.jpg/.png/.webp` through esbuild's `dataurl` loader, so painted
 * assets ship inside app.js (no extra routes, CloudFront-cached with the
 * bundle). Keep assets small — they ride every bundle download.
 */
declare module '*.jpg' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
declare module '*.webp' {
  const url: string;
  export default url;
}
