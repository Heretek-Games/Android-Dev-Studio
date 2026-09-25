import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MemoryStorage, SaveSystem, SAVE_VERSION, type StorageAdapter } from './SaveSystem.js';

const SESSION = { score: 300, wave: 2, kills: 3, elapsedSeconds: 12.5, phase: 'playing' as const };

describe('SaveSystem — slot save/load with explicit failures', () => {
  test('save/load round-trips the envelope', () => {
    const system = new SaveSystem(new MemoryStorage());
    assert.strictEqual(system.save('slot1', SESSION, { level: 'arena' }), true);

    const loaded = system.load('slot1');
    assert.ok(loaded);
    assert.strictEqual(loaded!.version, SAVE_VERSION);
    assert.strictEqual(loaded!.slot, 'slot1');
    assert.deepStrictEqual(loaded!.session, SESSION);
    assert.deepStrictEqual(loaded!.data, { level: 'arena' });
    assert.ok(loaded!.savedAt > 0);
    assert.strictEqual(system.getLastError(), null);
  });

  test('loading an empty slot returns null with a reason', () => {
    const system = new SaveSystem(new MemoryStorage());
    assert.strictEqual(system.load('nope'), null);
    assert.match(system.getLastError() ?? '', /no save in slot/);
  });

  test('corrupt JSON loads as null with a reason', () => {
    const storage = new MemoryStorage();
    storage.setItem('heretek.save.broken', '{not json');
    const system = new SaveSystem(storage);
    assert.strictEqual(system.load('broken'), null);
    assert.match(system.getLastError() ?? '', /corrupt save/);
  });

  test('malformed envelope loads as null', () => {
    const storage = new MemoryStorage();
    storage.setItem('heretek.save.shape', JSON.stringify({ version: SAVE_VERSION, slot: 'shape' }));
    const system = new SaveSystem(storage);
    assert.strictEqual(system.load('shape'), null);
    assert.match(system.getLastError() ?? '', /malformed save envelope/);
  });

  test('version mismatch loads as null', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'heretek.save.old',
      JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 1, slot: 'old', session: SESSION })
    );
    const system = new SaveSystem(storage);
    assert.strictEqual(system.load('old'), null);
    assert.match(system.getLastError() ?? '', /unsupported save version/);
  });

  test('empty slot name is rejected', () => {
    const system = new SaveSystem(new MemoryStorage());
    assert.strictEqual(system.save('', SESSION), false);
    assert.match(system.getLastError() ?? '', /non-empty/);
  });

  test('delete removes a slot and reports missing slots', () => {
    const system = new SaveSystem(new MemoryStorage());
    system.save('slot1', SESSION);
    assert.strictEqual(system.delete('slot1'), true);
    assert.strictEqual(system.load('slot1'), null);
    assert.strictEqual(system.delete('slot1'), false);
  });

  test('list enumerates prefixed slots when the adapter supports keys()', () => {
    class KeyedStorage extends MemoryStorage implements StorageAdapter {
      public keys(): string[] {
        return Array.from({ length: this.size }, (_, index) => `heretek.save.slot${index + 1}`);
      }
    }
    const system = new SaveSystem(new KeyedStorage());
    system.save('slot1', SESSION);
    system.save('slot2', SESSION);
    assert.deepStrictEqual(system.list().sort(), ['slot1', 'slot2']);
  });

  test('list returns empty for adapters without keys()', () => {
    const system = new SaveSystem(new MemoryStorage());
    system.save('slot1', SESSION);
    assert.deepStrictEqual(system.list(), []);
  });

  test('default storage falls back to memory when headless', () => {
    assert.ok(SaveSystem.defaultStorage() instanceof MemoryStorage);
  });

  test('storage write failures are reported, not thrown', () => {
    const failing: StorageAdapter = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {}
    };
    const system = new SaveSystem(failing);
    assert.strictEqual(system.save('slot1', SESSION), false);
    assert.match(system.getLastError() ?? '', /storage write failed: Error: quota exceeded/);
  });
});
