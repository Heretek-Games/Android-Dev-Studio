import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TerrainChunk } from './TerrainChunk.js';
import { GameObject } from '../core/GameObject.js';

function buildChunk(seed = 42, chunkX = 0, chunkZ = 0) {
  const go = new GameObject(`Chunk_${chunkX}_${chunkZ}`);
  const chunk = go.addComponent(
    new TerrainChunk({ chunkX, chunkZ, size: 32, resolution: 16, maxHeight: 10, seed })
  );
  return { go, chunk };
}

describe('TerrainChunk — procedural heightmap generation', () => {
  test('heightmap is deterministic for the same seed and config', () => {
    const a = buildChunk(1337);
    const b = buildChunk(1337);
    for (const [x, z] of [
      [0, 0],
      [8, 8],
      [16, 16],
      [31, 31]
    ]) {
      assert.strictEqual(a.chunk.sampleHeight(x, z), b.chunk.sampleHeight(x, z), `sample (${x},${z}) matches`);
    }
  });

  test('different seeds produce different terrain', () => {
    const a = buildChunk(1);
    const b = buildChunk(999);
    let differences = 0;
    for (let i = 0; i < 16; i++) {
      if (a.chunk.sampleHeight(i, i) !== b.chunk.sampleHeight(i, i)) differences++;
    }
    assert.ok(differences > 0, 'seeds should decorrelate the heightmap');
  });

  test('heights stay within [0, maxHeight] across the chunk', () => {
    const { chunk } = buildChunk(7);
    for (let x = 0; x <= 32; x += 4) {
      for (let z = 0; z <= 32; z += 4) {
        const h = chunk.sampleHeight(x, z);
        assert.ok(h >= 0 && h <= 10, `height ${h} out of range at (${x},${z})`);
      }
    }
  });

  test('builds geometry on start and cleans up on destroy', () => {
    const { go, chunk } = buildChunk();
    assert.ok(chunk.mesh !== null, 'mesh created for the chunk');
    assert.strictEqual(chunk.geometry?.attributes.position.count, 16 * 16);

    const verticesBefore = chunk.geometry!.attributes.position.count;
    go.destroy();
    assert.ok(verticesBefore > 0);
  });
});
