import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Settlement } from './Settlement.js';

describe('Settlement — placement, economy, growth', () => {
  test('placement validates bounds, occupancy, and funds', () => {
    const settlement = new Settlement(4, 30, 100, 20);
    assert.deepStrictEqual(settlement.place('house', 4, 0).id, null);
    assert.deepStrictEqual(settlement.place('house', -1, 0).id, null);

    const first = settlement.place('house', 0, 0);
    assert.ok(first.id !== null);
    const duplicate = settlement.place('farm', 0, 0);
    assert.strictEqual(duplicate.id, null);
    assert.match(duplicate.reason ?? '', /occupied/);

    const poor = new Settlement(4, 30, 10, 20);
    const rejected = poor.place('house', 0, 0);
    assert.strictEqual(rejected.id, null);
    assert.match(rejected.reason ?? '', /insufficient gold/);
  });

  test('demolish frees the plot', () => {
    const settlement = new Settlement(4, 30, 200, 20);
    const placed = settlement.place('house', 1, 1);
    assert.strictEqual(settlement.demolish(placed.id!), true);
    assert.strictEqual(settlement.demolish(placed.id!), false);
    assert.ok(settlement.place('farm', 1, 1).id !== null);
  });

  test('farms feed growth toward the housing cap and the target wins', () => {
    const settlement = new Settlement(8, 6, 500, 20);
    assert.ok(settlement.place('house', 0, 0).id !== null);
    assert.ok(settlement.place('farm', 1, 0).id !== null);
    assert.ok(settlement.place('farm', 2, 0).id !== null);
    assert.ok(settlement.place('market', 3, 0).id !== null);

    settlement.advance(30);
    const snapshot = settlement.snapshot();
    assert.strictEqual(snapshot.housing, 6);
    assert.ok(snapshot.population >= 6, `population=${snapshot.population}`);
    assert.strictEqual(settlement.hasWon(), true);
  });

  test('starvation shrinks the population and clamps the deficit', () => {
    const settlement = new Settlement(8, 30, 500, 0);
    assert.ok(settlement.place('house', 0, 0).id !== null);
    // No farms: the first mouth starves immediately and growth stalls.
    settlement.advance(5);
    const snapshot = settlement.snapshot();
    assert.strictEqual(snapshot.population, 0);
    assert.strictEqual(snapshot.food, 0);
  });

  test('upkeep drains the treasury over time', () => {
    const settlement = new Settlement(8, 30, 200, 50);
    assert.ok(settlement.place('house', 0, 0).id !== null);
    const before = settlement.snapshot().gold;
    settlement.advance(10);
    // House upkeep is 1 gold/step with no income.
    assert.ok(Math.abs(settlement.snapshot().gold - (before - 10)) < 1e-9);
  });

  test('advance is deterministic and ignores invalid deltas', () => {
    const run = () => {
      const settlement = new Settlement(8, 6, 500, 20);
      settlement.place('house', 0, 0);
      settlement.place('farm', 1, 0);
      settlement.advance(12);
      return settlement.snapshot();
    };
    assert.deepStrictEqual(run(), run());

    const settlement = new Settlement(8, 6, 500, 20);
    settlement.advance(0);
    settlement.advance(-1);
    settlement.advance(Number.NaN);
    assert.strictEqual(settlement.snapshot().steps, 0);
  });
});
