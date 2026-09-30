/**
 * Mechanics Index - Registers all extracted mechanics
 *
 * Import this module to initialize the mechanic registry with
 * all available mechanics.
 */

import { mechanicRegistry } from './registry';
import { actionPointsMechanic } from './action-points';
import { incomeMechanic } from './income';
import { handManagementMechanic } from './hand-management';
import { cardTypeRulesMechanic } from './card-type-rules';
import { cardMatchingMechanic } from './card-matching';
import { takeThatMechanic } from './take-that';
import { loseATurnMechanic } from './lose-a-turn';
import { gridMovementMechanic } from './grid-movement';
import { placeLocationMechanic } from './place-location';
import { boardStateMechanic } from './board-state';
import { placeCardMechanic } from './place-card';
import { tradingMechanic } from './trading';
import { openDraftingMechanic } from './open-drafting';
import { setCollectionMechanic } from './set-collection';
import { pushYourLuckMechanic } from './push-your-luck';
import { auctionEnglishMechanic } from './auction-english';
import { variablePlayerPowersMechanic } from './variable-player-powers';

// New mechanics (Phase 1 expansion)
import { closedDraftingMechanic } from './closed-drafting';
import { trickTakingMechanic } from './trick-taking';
import { movementPointsMechanic } from './movement-points';
import { automaticResourceGrowthMechanic } from './automatic-resource-growth';
import { eventsMechanic } from './events';
import { ladderClimbingMechanic } from './ladder-climbing';
import { oncePerGameAbilitiesMechanic } from './once-per-game-abilities';
import { chainingMechanic } from './chaining';
import { catchTheLeaderMechanic } from './catch-the-leader';
import { areaMovementMechanic } from './area-movement';
import { deckBuildingMechanic } from './deck-building';
import { multiUseCardsMechanic } from './multi-use-cards';
import { pointToPointMovementMechanic } from './point-to-point-movement';

// Phase 4: Visibility System mechanics
import { hiddenRolesMechanic } from './hidden-roles';
import { traitorGameMechanic } from './traitor-game';
import { hiddenVictoryPointsMechanic } from './hidden-victory-points';

// Phase 2: Dice System mechanics
import { diceRollingMechanic } from './dice-rolling';
import { rerollingAndLockingMechanic } from './re-rolling-and-locking';

// Phase 3: Dynamic Turn Order mechanics
import { turnOrderRandomMechanic } from './turn-order-random';
import { turnOrderStatBasedMechanic } from './turn-order-stat-based';
import { turnOrderProgressiveMechanic } from './turn-order-progressive';

// Phase 5: Voting & Social mechanics
import { votingMechanic } from './voting';
import { negotiationMechanic } from './negotiation';
import { communicationLimitsMechanic } from './communication-limits';

// Phase 2: Additional Dice mechanics
import { rollSpinAndMoveMechanic } from './roll-spin-and-move';
import { differentDiceMovementMechanic } from './different-dice-movement';

// Phase 3: Additional Turn Order mechanics
import { turnOrderPassOrderMechanic } from './turn-order-pass-order';

// Phase 4: Additional Visibility mechanics
import { hiddenMovementMechanic } from './hidden-movement';
import { hiddenObjectivesMechanic } from './hidden-objectives';

// Phase 1: Additional Auction mechanics
import { auctionSealedBidMechanic } from './auction-sealed-bid';
import { auctionOnceAroundMechanic } from './auction-once-around';

// Phase 2: Additional Dice mechanics (die-icon-resolution)
import { dieIconResolutionMechanic } from './die-icon-resolution';

// Phase 3: Additional Turn Order mechanics
import { turnOrderAuctionMechanic } from './turn-order-auction';
import { turnOrderClaimMechanic } from './turn-order-claim';
import { turnOrderTimeTrackMechanic } from './turn-order-time-track';
import { turnOrderRoleMechanic } from './turn-order-role';

// Phase 4: Additional Visibility mechanics (deduction, memory, clues, asymmetric)
import { deductionMechanic } from './deduction';
import { memoryMechanic } from './memory';
import { targetedCluesMechanic } from './targeted-clues';
import { rolesAsymmetricInfoMechanic } from './roles-asymmetric-info';

// Phase 5: Additional Social mechanics
import { playerJudgeMechanic } from './player-judge';
import { iCutYouChooseMechanic } from './i-cut-you-choose';
import { briberyMechanic } from './bribery';

// Phase 6: Combat System mechanics
import { criticalHitsMechanic } from './critical-hits';
import { zoneOfControlMechanic } from './zone-of-control';
import { ratioCRTMechanic } from './ratio-crt';
import { forceCommitmentMechanic } from './force-commitment';
import { areaImpulseMechanic } from './area-impulse';
import { chitPullSystemMechanic } from './chit-pull-system';
import { secretUnitDeploymentMechanic } from './secret-unit-deployment';
import { killStealMechanic } from './kill-steal';

// Win condition mechanics
import {
  reachStateWinMechanic,
  scoreThresholdWinMechanic,
  emptyHandWinMechanic,
  eliminationWinMechanic,
  timeoutWinnerMechanic,
  raceWinMechanic,
  suddenDeathMechanic,
  endGameBonusesMechanic,
  kingOfTheHillMechanic,
  victoryPointsAsResourceMechanic,
  highestLowestScoringMechanic,
  finaleEndingMechanic,
  singleLoserGameMechanic
} from './win-conditions/index';

// Core mechanics (always available)
import { passMechanic } from './core/pass';
import { cardsMechanic } from './core/cards';
import { resourcesMechanic } from './core/resources-mechanic';
import { diceMechanic } from './core/dice-mechanic';
import { boardMechanic } from './core/board-mechanic';
import { effectsMechanic } from './core/effects-mechanic';
import { visibilityMechanic } from './core/visibility-mechanic';
import { socialMechanic } from './core/social-mechanic';

// Effect handling mechanics
import { locationEffectsMechanic } from './location-effects';
import { placedCardEffectsMechanic } from './placed-card-effects';
import { effectDispatcherMechanic } from './core/effect-dispatcher';
import { eventEffectsMechanic } from './event-effects';

// Phase 7: Worker Placement mechanics
import { workersMechanic } from './core/workers-mechanic';
import { workerPlacementMechanic } from './worker-placement';

// Phase 6: Combat Core mechanic
import { combatMechanic } from './core/combat-mechanic';

// Multi-category expansion mechanics
import { differentWorkerTypesMechanic } from './worker-placement-different-worker-types';
import { auctionDutchMechanic } from './auction-dutch';
import { simultaneousActionSelectionMechanic } from './simultaneous-action-selection';
import { marketMechanic } from './market';
import { tableauBuildingMechanic } from './tableau-building';
import { actionProgrammingMechanic } from './action-programming';
import { cooperativeActionsMechanic } from './cooperative-actions';

// Economic mechanics
import { contractsMechanic } from './contracts';
import { loansMechanic } from './loans';

// Player elimination process mechanic
import { playerEliminationProcessMechanic } from './player-elimination-process';

// Phase 8: New mechanics expansion
import { auctionMechanic } from './core/auction-mechanic';
import { buildingMechanic } from './core/building-mechanic';
import { actionDraftingMechanic } from './action-drafting';
import { actionEventMechanic } from './action-event';
import { actionRetrievalMechanic } from './action-retrieval';
import { bettingAndBluffingMechanic } from './betting-and-bluffing';
import { cooperativeGameMechanic } from './cooperative-game';
import { alliancesMechanic } from './alliances';
import { networkAndRouteBuildingMechanic } from './network-and-route-building';
import { techTreesMechanic } from './tech-trees';
import { areaMajorityInfluenceMechanic } from './area-majority-influence';
import { teamBasedGameMechanic } from './team-based-game';
import { variableSetUpMechanic } from './variable-set-up';
import { advantageTokenMechanic } from './advantage-token';
import { randomProductionMechanic } from './random-production';
import { followMechanic } from './follow';
import { storytellingMechanic } from './storytelling';
import { tilePlacementMechanic } from './tile-placement';

// Experimental mechanics
import { freeplayMechanic } from './freeplay';

// Phase 15: Category completers
import { semiCooperativeGameMechanic } from './semi-cooperative-game';
import { actionQueueMechanic } from './action-queue';
import { actionTimerMechanic } from './action-timer';
import { workerPlacementDiceWorkersMechanic } from './worker-placement-dice-workers';
import { rolePlayingMechanic } from './role-playing';
import { actingMechanic } from './acting';
import { prisonersDilemmaMechanic } from './prisoners-dilemma';
import { inductionMechanic } from './induction';
import { patternRecognitionMechanic } from './pattern-recognition';
import { questionsAndAnswersMechanic } from './questions-and-answers';
import { elapsedRealTimeEndingMechanic } from './elapsed-real-time-ending';

// Phase 15: Economic mechanics
import { stockHoldingMechanic } from './stock-holding';
import { investmentMechanic } from './investment';
import { commoditySpeculationMechanic } from './commodity-speculation';
import { ownershipMechanic } from './ownership';

// Phase 15: Building mechanics
import { patternBuildingMechanic } from './pattern-building';
import { connectionsMechanic } from './connections';
import { enclosureMechanic } from './enclosure';
import { mapAdditionMechanic } from './map-addition';

// Phase 15: Auction mechanics
import { auctionCompensationMechanic } from './auction-compensation';
import { auctionFixedPlacementMechanic } from './auction-fixed-placement';
import { auctionMultipleLotMechanic } from './auction-multiple-lot';
import { auctionBiddingMechanic } from './auction-bidding';
import { auctionDutchPriorityMechanic } from './auction-dutch-priority';
import { auctionTurnOrderUntilPassMechanic } from './auction-turn-order-until-pass';

// Phase 15: Movement mechanics
import { hexagonGridMechanic } from './hexagon-grid';
import { rondelMechanic } from './rondel';
import { trackMovementMechanic } from './track-movement';
import { squareGridMechanic } from './square-grid';
import { gridCoverageMechanic } from './grid-coverage';

// Phase 15: Cards mechanics
import { meldingAndSplayingMechanic } from './melding-and-splaying';
import { commandCardsMechanic } from './command-cards';
import { deckConstructionMechanic } from './deck-construction';

// Phase 15: Other mechanics
import { pickUpAndDeliverMechanic } from './pick-up-and-deliver';
import { modularBoardMechanic } from './modular-board';
import { variablePhaseOrderMechanic } from './variable-phase-order';
import { tugOfWarMechanic } from './tug-of-war';
import { matchingMechanic } from './matching';
import { interruptsMechanic } from './interrupts';
import { scoreAndResetMechanic } from './score-and-reset';

// Register all extracted mechanics
mechanicRegistry.register(actionPointsMechanic);
mechanicRegistry.register(incomeMechanic);
mechanicRegistry.register(handManagementMechanic);
mechanicRegistry.register(cardTypeRulesMechanic);
mechanicRegistry.register(cardMatchingMechanic);
mechanicRegistry.register(takeThatMechanic);
mechanicRegistry.register(loseATurnMechanic);
mechanicRegistry.register(gridMovementMechanic);
mechanicRegistry.register(placeLocationMechanic);
mechanicRegistry.register(boardStateMechanic);
mechanicRegistry.register(placeCardMechanic);
mechanicRegistry.register(tradingMechanic);
mechanicRegistry.register(openDraftingMechanic);
mechanicRegistry.register(setCollectionMechanic);
mechanicRegistry.register(pushYourLuckMechanic);
mechanicRegistry.register(auctionEnglishMechanic);
mechanicRegistry.register(variablePlayerPowersMechanic);

// Register new mechanics (Phase 1 expansion)
mechanicRegistry.register(closedDraftingMechanic);
mechanicRegistry.register(trickTakingMechanic);
mechanicRegistry.register(movementPointsMechanic);
mechanicRegistry.register(automaticResourceGrowthMechanic);
mechanicRegistry.register(eventsMechanic);
mechanicRegistry.register(ladderClimbingMechanic);
mechanicRegistry.register(oncePerGameAbilitiesMechanic);
mechanicRegistry.register(chainingMechanic);
mechanicRegistry.register(catchTheLeaderMechanic);
mechanicRegistry.register(areaMovementMechanic);
mechanicRegistry.register(deckBuildingMechanic);
mechanicRegistry.register(multiUseCardsMechanic);
mechanicRegistry.register(pointToPointMovementMechanic);

// Register Phase 4: Visibility System mechanics
mechanicRegistry.register(hiddenRolesMechanic);
mechanicRegistry.register(traitorGameMechanic);
mechanicRegistry.register(hiddenVictoryPointsMechanic);

// Register Phase 2: Dice System mechanics
mechanicRegistry.register(diceRollingMechanic);
mechanicRegistry.register(rerollingAndLockingMechanic);

// Register Phase 3: Dynamic Turn Order mechanics
mechanicRegistry.register(turnOrderRandomMechanic);
mechanicRegistry.register(turnOrderStatBasedMechanic);
mechanicRegistry.register(turnOrderProgressiveMechanic);

// Register Phase 5: Voting & Social mechanics
mechanicRegistry.register(votingMechanic);
mechanicRegistry.register(negotiationMechanic);
mechanicRegistry.register(communicationLimitsMechanic);

// Register Phase 2: Additional Dice mechanics
mechanicRegistry.register(rollSpinAndMoveMechanic);
mechanicRegistry.register(differentDiceMovementMechanic);

// Register Phase 3: Additional Turn Order mechanics
mechanicRegistry.register(turnOrderPassOrderMechanic);

// Register Phase 4: Additional Visibility mechanics
mechanicRegistry.register(hiddenMovementMechanic);
mechanicRegistry.register(hiddenObjectivesMechanic);

// Register Phase 1: Additional Auction mechanics
mechanicRegistry.register(auctionSealedBidMechanic);
mechanicRegistry.register(auctionOnceAroundMechanic);

// Register Phase 2: Additional Dice mechanics
mechanicRegistry.register(dieIconResolutionMechanic);

// Register Phase 3: Additional Turn Order mechanics
mechanicRegistry.register(turnOrderAuctionMechanic);
mechanicRegistry.register(turnOrderClaimMechanic);
mechanicRegistry.register(turnOrderTimeTrackMechanic);
mechanicRegistry.register(turnOrderRoleMechanic);

// Register Phase 4: Additional Visibility mechanics
mechanicRegistry.register(deductionMechanic);
mechanicRegistry.register(memoryMechanic);
mechanicRegistry.register(targetedCluesMechanic);
mechanicRegistry.register(rolesAsymmetricInfoMechanic);

// Register Phase 5: Additional Social mechanics
mechanicRegistry.register(playerJudgeMechanic);
mechanicRegistry.register(iCutYouChooseMechanic);
mechanicRegistry.register(briberyMechanic);

// Register Phase 6: Combat System mechanics
mechanicRegistry.register(criticalHitsMechanic);
mechanicRegistry.register(zoneOfControlMechanic);
mechanicRegistry.register(ratioCRTMechanic);
mechanicRegistry.register(forceCommitmentMechanic);
mechanicRegistry.register(areaImpulseMechanic);
mechanicRegistry.register(chitPullSystemMechanic);
mechanicRegistry.register(secretUnitDeploymentMechanic);
mechanicRegistry.register(killStealMechanic);

// Register win condition mechanics
mechanicRegistry.register(reachStateWinMechanic);
mechanicRegistry.register(scoreThresholdWinMechanic);
mechanicRegistry.register(emptyHandWinMechanic);
mechanicRegistry.register(eliminationWinMechanic);
mechanicRegistry.register(timeoutWinnerMechanic);
mechanicRegistry.register(raceWinMechanic);
mechanicRegistry.register(suddenDeathMechanic);
mechanicRegistry.register(endGameBonusesMechanic);
mechanicRegistry.register(kingOfTheHillMechanic);
mechanicRegistry.register(victoryPointsAsResourceMechanic);
mechanicRegistry.register(highestLowestScoringMechanic);
mechanicRegistry.register(finaleEndingMechanic);
mechanicRegistry.register(singleLoserGameMechanic);

// Register core mechanics (always available)
mechanicRegistry.register(cardsMechanic);
mechanicRegistry.register(resourcesMechanic);
mechanicRegistry.register(diceMechanic);
mechanicRegistry.register(boardMechanic);
mechanicRegistry.register(effectsMechanic);
mechanicRegistry.register(visibilityMechanic);
mechanicRegistry.register(socialMechanic);
mechanicRegistry.register(passMechanic);

// Register effect handling mechanics
mechanicRegistry.register(locationEffectsMechanic);
mechanicRegistry.register(placedCardEffectsMechanic);
// Event effects: targeted events (peek, steal, block, sabotage, teleport…) and held reactions
mechanicRegistry.register(eventEffectsMechanic);
// Effect dispatcher: catch-all for card effects not handled by specialized mechanics
mechanicRegistry.register(effectDispatcherMechanic);

// Register Phase 7: Worker Placement mechanics
mechanicRegistry.register(workersMechanic);
mechanicRegistry.register(workerPlacementMechanic);

// Register Phase 6: Combat Core mechanic
mechanicRegistry.register(combatMechanic);

// Register multi-category expansion mechanics
mechanicRegistry.register(differentWorkerTypesMechanic);
mechanicRegistry.register(auctionDutchMechanic);
mechanicRegistry.register(simultaneousActionSelectionMechanic);
mechanicRegistry.register(marketMechanic);
mechanicRegistry.register(tableauBuildingMechanic);
mechanicRegistry.register(actionProgrammingMechanic);
mechanicRegistry.register(cooperativeActionsMechanic);

// Register economic mechanics
mechanicRegistry.register(contractsMechanic);
mechanicRegistry.register(loansMechanic);

// Register player elimination process mechanic
mechanicRegistry.register(playerEliminationProcessMechanic);

// Register Phase 8: New mechanics expansion
mechanicRegistry.register(auctionMechanic);
mechanicRegistry.register(buildingMechanic);
mechanicRegistry.register(actionDraftingMechanic);
mechanicRegistry.register(actionEventMechanic);
mechanicRegistry.register(actionRetrievalMechanic);
mechanicRegistry.register(bettingAndBluffingMechanic);
mechanicRegistry.register(cooperativeGameMechanic);
mechanicRegistry.register(alliancesMechanic);
mechanicRegistry.register(networkAndRouteBuildingMechanic);
mechanicRegistry.register(techTreesMechanic);
mechanicRegistry.register(areaMajorityInfluenceMechanic);
mechanicRegistry.register(teamBasedGameMechanic);
mechanicRegistry.register(variableSetUpMechanic);
mechanicRegistry.register(advantageTokenMechanic);
mechanicRegistry.register(randomProductionMechanic);
mechanicRegistry.register(followMechanic);
mechanicRegistry.register(storytellingMechanic);
mechanicRegistry.register(tilePlacementMechanic);

// Register experimental mechanics
mechanicRegistry.register(freeplayMechanic);

// Register Phase 15: Category completers
mechanicRegistry.register(semiCooperativeGameMechanic);
mechanicRegistry.register(actionQueueMechanic);
mechanicRegistry.register(actionTimerMechanic);
mechanicRegistry.register(workerPlacementDiceWorkersMechanic);
mechanicRegistry.register(rolePlayingMechanic);
mechanicRegistry.register(actingMechanic);
mechanicRegistry.register(prisonersDilemmaMechanic);
mechanicRegistry.register(inductionMechanic);
mechanicRegistry.register(patternRecognitionMechanic);
mechanicRegistry.register(questionsAndAnswersMechanic);
mechanicRegistry.register(elapsedRealTimeEndingMechanic);

// Register Phase 15: Economic mechanics
mechanicRegistry.register(stockHoldingMechanic);
mechanicRegistry.register(investmentMechanic);
mechanicRegistry.register(commoditySpeculationMechanic);
mechanicRegistry.register(ownershipMechanic);

// Register Phase 15: Building mechanics
mechanicRegistry.register(patternBuildingMechanic);
mechanicRegistry.register(connectionsMechanic);
mechanicRegistry.register(enclosureMechanic);
mechanicRegistry.register(mapAdditionMechanic);

// Register Phase 15: Auction mechanics
mechanicRegistry.register(auctionCompensationMechanic);
mechanicRegistry.register(auctionFixedPlacementMechanic);
mechanicRegistry.register(auctionMultipleLotMechanic);
mechanicRegistry.register(auctionBiddingMechanic);
mechanicRegistry.register(auctionDutchPriorityMechanic);
mechanicRegistry.register(auctionTurnOrderUntilPassMechanic);

// Register Phase 15: Movement mechanics
mechanicRegistry.register(hexagonGridMechanic);
mechanicRegistry.register(rondelMechanic);
mechanicRegistry.register(trackMovementMechanic);
mechanicRegistry.register(squareGridMechanic);
mechanicRegistry.register(gridCoverageMechanic);

// Register Phase 15: Cards mechanics
mechanicRegistry.register(meldingAndSplayingMechanic);
mechanicRegistry.register(commandCardsMechanic);
mechanicRegistry.register(deckConstructionMechanic);

// Register Phase 15: Other mechanics
mechanicRegistry.register(pickUpAndDeliverMechanic);
mechanicRegistry.register(modularBoardMechanic);
mechanicRegistry.register(variablePhaseOrderMechanic);
mechanicRegistry.register(tugOfWarMechanic);
mechanicRegistry.register(matchingMechanic);
mechanicRegistry.register(interruptsMechanic);
mechanicRegistry.register(scoreAndResetMechanic);

// Re-export for convenience
export { mechanicRegistry, applyStateChanges, getRegisteredMechanicsMetadata, getMechanicRequires } from './registry';
export type { MechanicValidationError, MechanicMetadata } from './registry';
export type {
  MechanicHooks,
  MechanicConfigSchema,
  HookDefinition,
  HookContext,
  TurnStartContext,
  TurnEndContext,
  PlayerInitContext,
  ValidationResult,
  StateChanges,
  PlayerInitResult,
  // Win condition types
  WinCheckContext,
  WinCheckResult,
  // Action execution & registration types
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  // Core operation hook types
  DrawContext,
  DrawHookResult,
  AfterDrawContext,
  DiscardContext,
  HandAddContext,
  HandAddHookResult,
  HandRemoveContext,
  // Visibility system types (Phase 4)
  VisibilityContext,
  RevealContext,
  VisibleState,
  // Dice system types (Phase 2)
  DiceRollContext,
  AfterRollContext,
  DiceRollHookResult,
  // Turn order types (Phase 3)
  TurnOrderContext,
  TurnOrderResult,
  PassPriorityResult,
  // Agnosticism types
  SharedStateInitContext,
  SharedStateInitResult,
  EffectApplicationContext,
  EffectApplicationResult,
  ActionSchema,
  // Combat system types (Phase 6)
  CombatHookContext,
  CombatModifierResult,
  CombatHookResult,
  CombatCasualties
} from './types';
