import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AudioManager, getAudioManager, setAudioManager } from './AudioManager.js';
import { NullAudioBackend } from './AudioBackend.js';

describe('AudioManager — clip registry, volumes, spatial attenuation', () => {
  test('play on an unregistered clip returns null and does not call the backend', () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    const voice = manager.play('missing');
    assert.strictEqual(voice, null);
    assert.strictEqual(backend.played.length, 0);
  });

  test('play on a registered clip returns a voice with master * base volume', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    await manager.registerClip('hit');
    manager.setMasterVolume(0.5);

    const voice = manager.play('hit', { volume: 0.8 });
    assert.ok(voice !== null);
    assert.strictEqual(backend.played.length, 1);
    assert.ok(Math.abs(backend.played[0].volume - 0.4) < 1e-9, 'expected 0.5 * 0.8 = 0.4');
  });

  test('volume clamps to 0..1 and non-finite values collapse to 0', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    await manager.registerClip('clip');
    manager.setMasterVolume(5);
    manager.play('clip', { volume: 5 });
    assert.strictEqual(backend.played[0].volume, 1);

    manager.setMasterVolume(Number.NaN);
    manager.play('clip', { volume: 1 });
    assert.strictEqual(backend.played[1].volume, 0);
  });

  test('attenuation: 1 inside refDistance, linear rolloff, 0 beyond maxDistance', () => {
    assert.strictEqual(AudioManager.attenuation(0, 5, 40), 1);
    assert.strictEqual(AudioManager.attenuation(5, 5, 40), 1);
    assert.ok(Math.abs(AudioManager.attenuation(22.5, 5, 40) - 0.5) < 1e-9);
    assert.strictEqual(AudioManager.attenuation(40, 5, 40), 0);
    assert.strictEqual(AudioManager.attenuation(100, 5, 40), 0);
    assert.strictEqual(AudioManager.attenuation(1, 5, 5), 1, 'degenerate range: inside ref is audible');
    assert.strictEqual(AudioManager.attenuation(6, 5, 5), 0, 'degenerate range: outside ref is silent');
  });

  test('spatial voices attenuate by distance to the listener and track position', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    await manager.registerClip('engine');
    manager.setListenerPosition(0, 0, 0);

    const voice = manager.play('engine', { spatial: true, refDistance: 5, maxDistance: 45, volume: 1 });
    assert.ok(voice !== null);
    assert.strictEqual(backend.played[0].volume, 1, 'starts at the listener');

    manager.updateVoicePosition(voice, 25, 0, 0);
    assert.ok(Math.abs(backend.volumes.get(voice)! - 0.5) < 1e-9, '25 units: halfway through the rolloff');

    manager.updateVoicePosition(voice, 100, 0, 0);
    assert.strictEqual(backend.volumes.get(voice), 0);
  });

  test('non-spatial voices ignore position updates', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    await manager.registerClip('ui');
    const voice = manager.play('ui', { volume: 0.7 });
    manager.updateVoicePosition(voice!, 100, 0, 0);
    assert.strictEqual(backend.volumes.get(voice!), 0.7);
  });

  test('master volume updates every active voice', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    await manager.registerClip('a');
    await manager.registerClip('b');
    const first = manager.play('a', { volume: 1 });
    const second = manager.play('b', { volume: 0.5 });

    manager.setMasterVolume(0.5);
    assert.strictEqual(backend.volumes.get(first!), 0.5);
    assert.ok(Math.abs(backend.volumes.get(second!)! - 0.25) < 1e-9);
  });

  test('stop removes the voice; stopAll and dispose clear state', async () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    await manager.registerClip('clip');

    const voice = manager.play('clip');
    manager.stop(voice!);
    assert.deepStrictEqual(backend.stopped, [voice]);
    assert.strictEqual(manager.getVoiceCount(), 0);

    manager.play('clip');
    manager.play('clip');
    assert.strictEqual(manager.getVoiceCount(), 2);
    manager.stopAll();
    assert.strictEqual(manager.getVoiceCount(), 0);
    assert.strictEqual(backend.stopAllCount, 1);

    manager.dispose();
    assert.strictEqual(backend.disposed, true);
    assert.strictEqual(manager.hasClip('clip'), false);
  });

  test('default manager falls back to the null backend when headless', () => {
    setAudioManager(null);
    const manager = getAudioManager();
    assert.ok(manager.getBackend() instanceof NullAudioBackend);
    setAudioManager(null);
  });
});
