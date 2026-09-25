import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EconomyTick } from './EconomyTick.js';

describe('EconomyTick Simulation Loop', () => {
  it('accumulates resources based on rule interval', () => {
    const sim = new EconomyTick(1.0); // 1.0s fixed steps
    sim.addRule({
      id: 'gold_mine',
      intervalSeconds: 2.0,
      effects: [{ resource: 'gold', delta: 5 }]
    });

    // Advance 1.5s: interval 2.0 not reached yet
    sim.advance(1.5);
    assert.strictEqual(sim.get('gold'), 0);

    // Advance another 1.0s (total 2.5s): 2.0 reached, fires once
    sim.advance(1.0);
    assert.strictEqual(sim.get('gold'), 5);

    // Advance 4.0s (total 6.5s): fires 2 more times (at 4.0s and 6.0s)
    sim.advance(4.0);
    assert.strictEqual(sim.get('gold'), 15);
  });

  it('checks prerequisites before applying rule effects', () => {
    const sim = new EconomyTick(1.0);
    sim.addRule({
      id: 'forge',
      intervalSeconds: 1.0,
      requires: [{ resource: 'iron', min: 2 }],
      effects: [
        { resource: 'iron', delta: -2 },
        { resource: 'swords', delta: 1 }
      ]
    });

    // Without iron, rule cannot fire
    sim.advance(2.0);
    assert.strictEqual(sim.get('swords'), 0);

    // Provide iron
    sim.set('iron', 5);
    sim.advance(1.0);
    assert.strictEqual(sim.get('iron'), 3);
    assert.strictEqual(sim.get('swords'), 1);
  });
});
