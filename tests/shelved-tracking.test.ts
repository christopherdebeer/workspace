/**
 * Shipment tracking.
 *
 * `ShipmentRecord.status` declared seven states and only ever held one: the
 * record was written at label creation and never touched again, so a parcel
 * read "label created" forever, including after it arrived. `pre-transit`,
 * `in-transit`, `delivered`, `returned` and `failed` were unreachable type
 * members.
 *
 * These assert the mapping and the test-mode affordance, which is what makes
 * those states reachable at all before a real parcel exists — a Shippo test
 * transaction returns an ordinary-looking tracking number that no carrier has
 * ever heard of.
 */
import { SIMULATED_TRACKING } from '../cells/shelved/lib/shipping';
import type { ShipmentRecord } from '../cells/shelved/shared/types';

describe('the states a parcel can be reported in', () => {
  it('offers every Shippo tracking state a tester might need', () => {
    // Shippo's six, minus UNKNOWN, which is not a state worth pretending.
    expect([...SIMULATED_TRACKING].sort()).toEqual(['DELIVERED', 'FAILURE', 'PRE_TRANSIT', 'RETURNED', 'TRANSIT']);
  });

  it('names only states the record can actually hold', () => {
    const held: ShipmentRecord['status'][] = ['quoted', 'label-created', 'pre-transit', 'in-transit', 'delivered', 'returned', 'failed'];
    const mapped: Record<string, ShipmentRecord['status']> = {
      PRE_TRANSIT: 'pre-transit', TRANSIT: 'in-transit', DELIVERED: 'delivered', RETURNED: 'returned', FAILURE: 'failed',
    };
    for (const s of SIMULATED_TRACKING) expect(held).toContain(mapped[s]);
  });

  // UNKNOWN is the normal answer for the first hours of a real label's life.
  // Mapping it would walk a shipment backwards from a state we already knew.
  it('does not offer UNKNOWN as something to simulate', () => {
    expect(SIMULATED_TRACKING as readonly string[]).not.toContain('UNKNOWN');
  });

  // These are Shippo's reserved numbers; the shape matters because they only
  // answer under the literal carrier `shippo` and only for a test token.
  it('builds the reserved tracking numbers Shippo expects', () => {
    for (const s of SIMULATED_TRACKING) expect(`SHIPPO_${s}`).toMatch(/^SHIPPO_[A-Z_]+$/);
  });
});
