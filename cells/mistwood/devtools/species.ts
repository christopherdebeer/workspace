/**
 * A wood's species and its places: each species' genome (archetype, bark, lichen, moss …), the
 * relief, and what stands within 80 m of the start, by kind.
 *
 *   node cells/mistwood/devtools/species.mjs [seed = moss-ford-7]
 */
import { Wood } from '../client/world';
import { seedFrom } from '../client/rng';

const name = process.argv[2] ?? 'moss-ford-7';
const wood = new Wood(seedFrom(name)!);
console.log(name, 'relief', wood.relief.map((v) => +v.toFixed(3)), 'openness', +wood.openness.toFixed(2), 'fog', +wood.density.toFixed(3));
for (const s of wood.species) {
  const g = s.genome;
  console.log(` ${s.id.padEnd(3)} ${g.archetype.padEnd(8)} per ${s.per.toFixed(2)}  lichen ${g.lichen.toFixed(2)}  moss ${g.moss.toFixed(2)}  rough ${g.barkRough.toFixed(2)}  bark ${g.bark.map((v) => v.toFixed(2)).join(',')}`);
}
const kinds: Record<string, number> = {};
for (const p of wood.around(0, 14, 80)) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
console.log('within 80 m:', kinds);
