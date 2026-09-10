// Stand-in for @dgreenheck/ez-tree in the offline bundles (see
// ../offline-deps.mjs). The flora-ez lab is the only reach; opening that lab
// offline fails here, saying why, instead of every page failing to link.
const missing = () => new Error('@dgreenheck/ez-tree is not bundled offline: the deployed cell fetches it from esm.sh '
  + '(client/imports.json). Open /lab/flora-ez on the deployed cell instead.');

export class Tree {
  constructor() { throw missing(); }
}
export const TreePreset = {};
