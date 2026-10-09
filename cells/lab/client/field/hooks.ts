/**
 * Set before the wood is placed (this module is imported first): the anomalies clear the wood in
 * their hearts (mistwood/world.ts `clearing`) — nothing grows where the crystals break out of the
 * ground or the giants stand, and the wood thins out about them.
 */
import { clearing } from '../mistwood/world';
import { clearedAt } from './finds';

clearing.at = clearedAt;
