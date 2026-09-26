import { test, describe } from 'node:test';
import assert from 'node:assert';
import { HitstopClock } from './HitstopClock.js';
import { DamageFeed } from './DamageFeed.js';

describe('HitstopClock — freeze-frame juice', () => {
  test('freezes N frames then restores full speed', () => {
    const clock = new HitstopClock();
    clock.request(3);
    assert.strictEqual(clock.active, true);
    assert.deepStrictEqual([clock.advance(), clock.advance(), clock.advance()], [0, 0, 0]);
    assert.strictEqual(clock.active, false);
    assert.strictEqual(clock.advance(), 1);
  });

  test('stacked requests take the max, invalid input ignored', () => {
    const clock = new HitstopClock();
    clock.request(2);
    clock.request(4);
    clock.request(-1);
    clock.request(NaN);
    let zeros = 0;
    for (let i = 0; i < 6; i++) if (clock.advance() === 0) zeros++;
    assert.strictEqual(zeros, 4);
  });

  test('cancel restores immediately', () => {
    const clock = new HitstopClock();
    clock.request(60);
    clock.cancel();
    assert.strictEqual(clock.advance(), 1);
  });
});

describe('DamageFeed — headless damage numbers', () => {
  test('records hits newest-first with sequence order', () => {
    const feed = new DamageFeed();
    feed.push('Goblin', 25);
    feed.push('Goblin', 30, 'Pyro');
    feed.push('Slime', 10);
    const latest = feed.latest(2);
    assert.deepStrictEqual(latest.map(e => e.target), ['Slime', 'Goblin']);
    assert.ok(latest[0].seq > latest[1].seq, 'newest entry has the highest seq');
    assert.strictEqual(feed.totalDealt(), 65);
    assert.strictEqual(feed.totalTo('Goblin'), 55);
  });

  test('ring capacity drops oldest entries', () => {
    const feed = new DamageFeed(3);
    for (let i = 0; i < 5; i++) feed.push(`T${i}`, 10);
    assert.strictEqual(feed.size, 3);
    assert.deepStrictEqual(feed.latest(5).map(e => e.target), ['T4', 'T3', 'T2']);
    assert.strictEqual(feed.totalDealt(), 30);
  });
});
