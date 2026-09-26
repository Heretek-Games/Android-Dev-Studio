import { test, describe } from 'node:test';
import assert from 'node:assert';
import { FakeStoreBackend } from './Store.js';

const CATALOG = [
  { sku: 'coins100', kind: 'consumable' as const, title: '100 Coins', priceMicros: 990000, currency: 'USD' },
  { sku: 'pro', kind: 'non_consumable' as const, title: 'Pro', priceMicros: 4990000, currency: 'USD' },
  { sku: 'season', kind: 'subscription' as const, title: 'Season', priceMicros: 9990000, currency: 'USD' }
];

describe('FakeStoreBackend — purchase flows (headless Play/Steam stand-in)', () => {
  test('auth gates achievements and scores', async () => {
    const store = new FakeStoreBackend({ catalog: CATALOG });
    assert.strictEqual(store.authState().signedIn, false);
    assert.strictEqual(await store.unlockAchievement('first_win'), false);
    await store.signIn(true);
    assert.strictEqual(store.authState().signedIn, true);
    assert.strictEqual(await store.unlockAchievement('first_win'), true);
    assert.strictEqual(store.hasAchievement('first_win'), true);
    assert.strictEqual(await store.submitScore('arena', 1500), true);
    assert.strictEqual(store.bestScore('arena'), 1500);
    assert.strictEqual(await store.submitScore('arena', 900), true);
    assert.strictEqual(store.bestScore('arena'), 1500); // best kept
    await store.signOut();
    assert.strictEqual(store.authState().signedIn, false);
  });

  test('approved purchase grants, acknowledges, consumes once', async () => {
    const store = new FakeStoreBackend({ catalog: CATALOG });
    const products = await store.fetchProducts(['coins100', 'missing']);
    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].sku, 'coins100');
    const record = await store.purchase('coins100');
    assert.strictEqual(record.state, 'purchased');
    assert.ok(record.orderId.length > 0);
    assert.strictEqual(record.acknowledged, false);
    assert.strictEqual(await store.acknowledge(record.orderId), true);
    assert.strictEqual(await store.acknowledge(record.orderId), false); // once
    assert.strictEqual(await store.consume(record.orderId), true);
    assert.strictEqual(await store.consume(record.orderId), false); // once
    assert.strictEqual(store.ledgerSize, 1);
  });

  test('unknown sku fails without grant; non-consumables cannot consume', async () => {
    const store = new FakeStoreBackend({ catalog: CATALOG });
    const bad = await store.purchase('nope');
    assert.strictEqual(bad.state, 'failed');
    assert.strictEqual(bad.orderId, '');
    const pro = await store.purchase('pro');
    assert.strictEqual(pro.state, 'purchased');
    assert.strictEqual(await store.consume(pro.orderId), false);
  });

  test('cancelled purchases never grant; restore replays entitlements', async () => {
    const store = new FakeStoreBackend({ catalog: CATALOG, forcedState: 'cancelled' });
    const cancelled = await store.purchase('pro');
    assert.strictEqual(cancelled.state, 'cancelled');
    assert.strictEqual((await store.restorePurchases()).length, 0);
    const live = new FakeStoreBackend({ catalog: CATALOG });
    await live.purchase('pro');
    const coins = await live.purchase('coins100');
    await live.consume(coins.orderId);
    const restored = await live.restorePurchases();
    assert.strictEqual(restored.length, 1); // consumed coin excluded
    assert.strictEqual(restored[0].sku, 'pro');
  });

  test('injected failures throw; cloud put/get round-trips', async () => {
    const store = new FakeStoreBackend({ catalog: CATALOG, failNext: 1 });
    await assert.rejects(store.signIn(true), /injected failure/);
    assert.strictEqual((await store.signIn(true)).signedIn, true); // budget spent
    assert.strictEqual(await store.cloudPut('save1', '{"level":3}'), true);
    assert.strictEqual(await store.cloudGet('save1'), '{"level":3}');
    assert.strictEqual(await store.cloudGet('missing'), null);
    assert.strictEqual(await store.cloudPut('', 'x'), false);
  });

  test('serialization preserves catalog, ledger, and cloud', () => {
    const store = new FakeStoreBackend({ catalog: CATALOG });
    const json = store.toJSON();
    assert.strictEqual(json.type, 'FakeStoreBackend');
    const other = new FakeStoreBackend();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.ledgerSize, 0);
    return other.fetchProducts(['season']).then(products => {
      assert.strictEqual(products.length, 1);
      assert.strictEqual(products[0].currency, 'USD');
    });
  });
});
