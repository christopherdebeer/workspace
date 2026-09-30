/**
 * Win Condition Mechanics Index
 *
 * Exports all win condition mechanics for registration.
 *
 * Win conditions respond to the onCheckWin hook and determine
 * when a player has won the game. Multiple win conditions can be
 * enabled simultaneously for composition.
 *
 * Available mechanics and their config keys:
 *
 * - win_reach_state: Win by reaching a specific board state
 *   ```yaml
 *   engine_mechanics:
 *     win_reach_state:
 *       target_state: "Victory"
 *   ```
 *
 * - win_score_threshold: Win by reaching a score threshold
 *   ```yaml
 *   engine_mechanics:
 *     win_score_threshold:
 *       threshold: 100
 *       operator: ">="  # Optional, defaults to ">="
 *   ```
 *
 * - win_empty_hand: Win by emptying your hand (like UNO)
 *   ```yaml
 *   engine_mechanics:
 *     win_empty_hand: true
 *   ```
 *
 * - win_elimination: Win by being the last player standing
 *   ```yaml
 *   engine_mechanics:
 *     win_elimination: true
 *   ```
 *
 * - win_timeout: Determine winner on timeout (max_rounds)
 *   ```yaml
 *   engine_mechanics:
 *     win_timeout:
 *       type: highest_score  # Or: role, specific_player, no_winner
 *   ```
 *
 * Example composition (multiple win conditions):
 * ```yaml
 * engine_mechanics:
 *   win_score_threshold:
 *     threshold: 100
 *   win_reach_state:
 *     target_state: "Victory"
 *   win_timeout:
 *     type: highest_score
 * ```
 */

export { reachStateWinMechanic } from './reach-state';
export { scoreThresholdWinMechanic } from './score-threshold';
export { emptyHandWinMechanic } from './empty-hand';
export { eliminationWinMechanic } from './elimination';
export { timeoutWinnerMechanic } from './timeout-winner';
export { raceWinMechanic } from './race';
export { suddenDeathMechanic } from './sudden-death';
export { endGameBonusesMechanic } from './end-game-bonuses';
export { kingOfTheHillMechanic } from './king-of-the-hill';
export { victoryPointsAsResourceMechanic } from './victory-points-as-resource';
export { highestLowestScoringMechanic } from './highest-lowest-scoring';
export { finaleEndingMechanic } from './finale-ending';
export { singleLoserGameMechanic } from './single-loser-game';
