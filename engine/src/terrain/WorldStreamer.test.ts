import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { WorldStreamer } from './WorldStreamer.js';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';

function buildStreamer(renderDistance = 1) {
  const scene = new Scene('StreamScene');
  const go = new GameObject('World');
  const streamer = go.addComponent(
    new WorldStreamer({
      chunkSize: 32,
      renderDistance,
      resolution: 8,
      maxHeight: 6,
      seed: 7,
      target: new THREE.Vector3(0, 0, 0)
    })
  );
  scene.addGameObject(go);
  return { scene, go, streamer };
}

/** Drains the frame-budgeted chunk queue (max 1 chunk per update). */
function drain(streamer: WorldStreamer, maxFrames = 200) {
  for (let i = 0; i < maxFrames; i++) {
    streamer.update(1 / 60);
    if ((streamer as any).pendingQueue.length === 0 && (streamer as any).lastChunkX !== undefined) break;
  }
  // One more pass to spawn the final queued chunk
  for (let i = 0; i < 10; i++) streamer.update(1 / 60);
}

describe('WorldStreamer — frame-budgeted terrain chunk streaming', () => {
  test('start() streams a full chunk ring around the target', () => {
    const { streamer } = buildStreamer(1);
    streamer.start();
    drain(streamer);

    // renderDistance 1 → 3x3 ring
    assert.strictEqual(streamer.activeChunks.size, 9, `expected 9 chunks, got ${streamer.activeChunks.size}`);
    for (const [, chunkGo] of streamer.activeChunks) {
      assert.ok(chunkGo.name.startsWith('TerrainChunk_'));
    }
  });

  test('incremental streaming is frame-budgeted (at most one chunk spawn per update)', () => {
    const { streamer } = buildStreamer(1);
    streamer.start(); // immediate: initial ring spawns synchronously
    drain(streamer);
    const initial = streamer.activeChunks.size;
    assert.strictEqual(initial, 9);

    // Teleport far away: the new ring must stream in at one chunk per frame
    (streamer.target as THREE.Vector3).set(320, 0, 0);
    streamer.update(1 / 60); // detects chunk change, re-queues (unloads stale immediately)
    assert.strictEqual(streamer.activeChunks.size, 0, 'stale ring unloads immediately');

    streamer.update(1 / 60);
    const afterOneFrame = streamer.activeChunks.size;
    assert.ok(afterOneFrame <= 1, `budget allows at most 1 spawn per frame, got ${afterOneFrame}`);
  });

  test('moving the target far away unloads stale chunks and streams new ones', () => {
    const { streamer } = buildStreamer(1);
    streamer.start();
    drain(streamer);
    const before = [...streamer.activeChunks.keys()];

    // Teleport 320m away (10 chunks over)
    (streamer.target as THREE.Vector3).set(320, 0, 0);
    streamer.update(1 / 60); // detects chunk change, re-queues
    drain(streamer);

    const after = [...streamer.activeChunks.keys()];
    assert.strictEqual(after.length, 9);
    const overlap = after.filter(k => before.includes(k));
    assert.strictEqual(overlap.length, 0, 'all previous chunks should unload');
    // New ring centered on chunk (10, 0)
    assert.ok(after.includes('10,0'), `expected ring around 10,0 — got ${after.join(' | ')}`);
  });

  test('onDestroy unloads every chunk', () => {
    const { streamer } = buildStreamer(0);
    streamer.start();
    drain(streamer);
    assert.strictEqual(streamer.activeChunks.size, 1);

    streamer.onDestroy();
    assert.strictEqual(streamer.activeChunks.size, 0);
  });
});
