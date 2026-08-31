/**
 * Just enough OSM XML to answer "what is this way called and where does it go".
 *
 * Not a general parser and not trying to be: the OSM API's `map` call returns
 * a flat list of <node>, <way> and <relation> at one level of nesting, with
 * <nd> and <tag> children, and nothing here needs namespaces, entities beyond
 * the five predefined ones, or CDATA. A regex pass over that is a few lines and
 * has no dependency to keep in step.
 *
 * The alternative was a dependency in devtools, which the rest of this
 * directory manages without — every other tool here runs on plain node with
 * nothing built.
 */
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const un = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m])
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

export function XMLParser(xml) {
  const nodes = [];
  for (const m of xml.matchAll(/<node\s+([^>]*?)\/?>/g)) {
    const a = m[1];
    const id = /id="(\d+)"/.exec(a)?.[1];
    const lat = /lat="(-?[\d.]+)"/.exec(a)?.[1];
    const lon = /lon="(-?[\d.]+)"/.exec(a)?.[1];
    if (id && lat && lon) nodes.push({ id, lat: +lat, lon: +lon });
  }
  const ways = [];
  // Non-greedy to the way's own close, so one way's children never bleed into
  // the next — the single thing this has to get right.
  for (const m of xml.matchAll(/<way\s+id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[2];
    const nds = [...body.matchAll(/<nd\s+ref="(\d+)"/g)].map((x) => x[1]);
    const tags = {};
    for (const t of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"/g)) tags[un(t[1])] = un(t[2]);
    ways.push({ id: m[1], nds, tags });
  }
  return { nodes, ways };
}
