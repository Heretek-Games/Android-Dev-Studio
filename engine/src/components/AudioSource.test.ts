import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AudioSource } from './AudioSource.js';
import { AudioManager } from '../audio/AudioManager.js';
import { NullAudioBackend } from '../audio/AudioBackend.js';
import { GameObject } from '../core/GameObject.js';

async function makeSource(options: Partial<ConstructorParameters<typeof AudioSource>[0]> = {}) {
  const backend = new NullAudioBackend();
  const manager = new AudioManager(backend);
  await manager.registerClip('laser');
  const go = new GameObject('Turret');
  const source = go.addComponent(
    new AudioSource({ clipId: 'laser', manager, ...options } as ConstructorParameters<typeof AudioSource>[0])
  );
  return { backend, manager, go, source };
}

describe('AudioSource — component lifecycle and playback', () => {
  test('playOnStart plays a voice on start()', async () => {
    const { backend, source } = await makeSource({ playOnStart: true, volume: 0.6 });
    source.start();
    assert.strictEqual(source.isPlaying(), true);
    assert.strictEqual(backend.played.length, 1);
    assert.strictEqual(backend.played[0].clipId, 'laser');
    assert.strictEqual(backend.played[0].volume, 0.6);
  });

  test('playOnStart=false does not play on start()', async () => {
    const { backend, source } = await makeSource({ playOnStart: false });
    source.start();
    assert.strictEqual(source.isPlaying(), false);
    assert.strictEqual(backend.played.length, 0);
  });

  test('playing twice stops the previous voice', async () => {
    const { backend, source } = await makeSource();
    source.play();
    const firstVoice = source.getVoiceId()!;
    source.play();
    const secondVoice = source.getVoiceId()!;
    assert.notStrictEqual(firstVoice, secondVoice);
    assert.deepStrictEqual(backend.stopped, [firstVoice]);
    assert.strictEqual(source.isPlaying(), true);
  });

  test('unknown clip: play() returns false and creates no voice', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    const go = new GameObject('Turret');
    const source = go.addComponent(new AudioSource({ clipId: 'missing', manager }));
    assert.strictEqual(source.play(), false);
    assert.strictEqual(source.isPlaying(), false);
    assert.strictEqual(backend.played.length, 0);
  });

  test('spatial sources push their world position every update', async () => {
    const { backend, manager, go, source } = await makeSource({
      spatial: true,
      refDistance: 0,
      maxDistance: 100,
      volume: 1
    });
    manager.setListenerPosition(0, 0, 0);
    go.transform.setPosition(0, 0, 0);
    source.play();
    const voice = source.getVoiceId()!;
    assert.strictEqual(backend.volumes.get(voice), 1);

    go.transform.setPosition(50, 0, 0);
    source.update(0.016);
    assert.ok(Math.abs(backend.volumes.get(voice)! - 0.5) < 1e-9, 'expected half volume at half max distance');
  });

  test('non-spatial sources do not push positions', async () => {
    const { backend, go, source } = await makeSource({ spatial: false });
    go.transform.setPosition(50, 0, 0);
    source.play();
    const voice = source.getVoiceId()!;
    source.update(0.016);
    assert.strictEqual(backend.volumes.get(voice), 1);
  });

  test('onDestroy stops the voice', async () => {
    const { backend, source } = await makeSource();
    source.play();
    const voice = source.getVoiceId()!;
    source.onDestroy();
    assert.deepStrictEqual(backend.stopped, [voice]);
    assert.strictEqual(source.isPlaying(), false);
  });

  test('stop() is a no-op when not playing', async () => {
    const { backend, source } = await makeSource({ playOnStart: false });
    source.stop();
    assert.strictEqual(backend.stopped.length, 0);
  });

  test('toJSON serializes the playable fields', async () => {
    const { source } = await makeSource({ loop: true, spatial: true, refDistance: 2, maxDistance: 20 });
    const json = source.toJSON();
    assert.strictEqual(json.type, 'AudioSource');
    assert.strictEqual(json.clipId, 'laser');
    assert.strictEqual(json.loop, true);
    assert.strictEqual(json.spatial, true);
    assert.strictEqual(json.refDistance, 2);
    assert.strictEqual(json.maxDistance, 20);
  });
});
