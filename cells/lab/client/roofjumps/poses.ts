/**
 * Poses held, to be looked at: a body standing at (x, y, z) facing +z, in a move and that far through it, with what its
 * hands would be on put where it would be (scaled to the character's reach). The page's study sheets draw them
 * (`sheet=`, `study=`), and devtools/roofjumps-poses.mjs draws and checks them, for every character.
 */
import type { Body, Move } from './runner';

/** the moves a sheet can show: every move, and a landing, a stand, the two-handed vault */
export const POSE_MOVES = ['stand', 'run', 'dash', 'ledge', 'land', 'roll', 'vault', 'vault2', 'hop', 'bound', 'spring', 'flip', 'sideflip', 'dive', 'glide', 'fall', 'kick', 'climb', 'hang', 'wallrun', 'chimney', 'underbar', 'swing'];

export function heldBody(at0: { x: number; y: number; z: number }, move: string, mu: number, lead = 1, wallSide = 1, reachScale = 1): Body {
  const ground = ['run', 'dash', 'ledge', 'roll', 'land', 'stand'].includes(move), move2 = move === 'vault2';
  if (move2) move = 'vault';
  const k = reachScale;
  /** a point by the figure (it faces +z, its left is +x): `a` ahead, `s` to its left, `h` up (scaled to its reach) */
  const at = (a: number, s: number, h: number): [number, number, number] => [at0.x + s * k, at0.y + h * k, at0.z + a * k];
  return {
    x: at0.x, y: at0.y, z: at0.z, heading: 0, turn: 0, lead, wallSide, mu,
    move: (move === 'land' || move === 'stand' ? 'run' : move) as Move,
    state: ground ? 'ground' : move === 'climb' || move === 'hang' ? 'climb' : move === 'wallrun' ? 'wall' : move === 'chimney' ? 'chimney' : move === 'swing' ? 'swing' : 'air',
    speed: move === 'stand' ? 0 : move === 'land' ? 5 : move === 'dash' ? 18 : move === 'ledge' ? 8 : 12,
    phase: mu * 2 * Math.PI, climbT: mu * 0.42, wallT: mu * 0.45, land: move === 'land' ? 1 - mu : 0,
    // (a pose held has nothing real to hold: what its hands would be on is put where it would be)
    reach: move === 'vault' ? (move2 ? { hl: at(0.45, 0.2, -0.05), hr: at(0.45, -0.2, -0.05) } : lead ? { hr: at(0.3, -0.3, -0.05) } : { hl: at(0.3, 0.3, -0.05) })
      : move === 'climb' ? { hl: at(0.42, 0.22, 1.5 + 0.9 * (1 - mu)), hr: at(0.42, -0.22, 1.5 + 0.9 * (1 - mu)) }
      : move === 'hang' ? { hl: at(0.4, 0.2, 2.05), hr: at(0.4, -0.2, 2.05) }
      : move === 'swing' ? { hl: at(0.15, 0.25, 1.9) }
      : move === 'wallrun' ? (wallSide > 0 ? { hl: at(0.25, 0.4, 1.3) } : { hr: at(0.25, -0.4, 1.3) })
      : move === 'land' && mu < 0.5 ? { hr: at(0.38, -0.26, 0) } : move === 'roll' && mu < 0.28 ? { hl: at(0.45, 0.16, 0), hr: at(0.45, -0.16, 0) } : {},
  } as Body;
}
