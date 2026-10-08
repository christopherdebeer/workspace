/**
 * The fungi of the wood's anomalies, from the Hat-throwers' genome (fungi/genome.ts): its capped
 * forms — inkcaps (a pleated bell, its rim dissolving into ink), mottlegills (a grey cone, black
 * gills showing at the rim, mottled) and fieldcaps (a slimy yolk-yellow dome that flares out) —
 * each species' own proportions, colours, pleats, ink and slime (giantfungi.ts grows them).
 */
import { hash } from '../kit/rng';
import { species, type Form, type Genome } from '../fungi/genome';

export const MUSHROOM_FORMS: Form[] = ['inkcap', 'mottlegill', 'fieldcap'];
/** a find's form, from its seed (so the card's live view grows the same species) */
export const formOf = (seed: number): Form => MUSHROOM_FORMS[hash(seed, 0x5f0) % MUSHROOM_FORMS.length];
export const mushroomSpecies = (seed: number): Genome => species(seed, formOf(seed));
