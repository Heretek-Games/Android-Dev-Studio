import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AudioManager } from './AudioManager.js';
import { NullAudioBackend } from './AudioBackend.js';
import { AudioMixer, dbToLinear, linearToDb } from './AudioMixer.js';

function mixer(): AudioMixer {
  return new AudioMixer({
    buses: {
      music: { gainDb: -6 },
      sfx: {},
      dialogue: { send: 'master' }
    },
    duckRules: [{ trigger: 'dialogue', target: 'music', depthDb: -12, attack: 0.1, release: 0.4 }],
    snapshots: { quiet: { music: -24, sfx: -24, dialogue: 0 } }
  });
}

describe('AudioMixer — buses, ducking, snapshots', () => {
  test('dB helpers invert', () => {
    assert.ok(Math.abs(dbToLinear(0) - 1) < 1e-12);
    assert.ok(Math.abs(dbToLinear(-6) - 0.5011872336272722) < 1e-9);
    assert.ok(Math.abs(linearToDb(0.5) + 6.020599913279624) < 1e-9);
    assert.strictEqual(dbToLinear(-Infinity), 0);
  });

  test('bus gains sum along the send chain', () => {
    const m = mixer();
    // music -6 dB over master 0 dB.
    assert.ok(Math.abs(m.effectiveGainDb('music') + 6) < 1e-9);
    assert.strictEqual(m.voiceGain('music', 1), dbToLinear(-6));
    assert.strictEqual(m.voiceGain(undefined, 0.5), 0.5);
    assert.strictEqual(m.voiceGain('nope', 1), 0);
  });

  test('mute and solo gate audibility with reasons', () => {
    const m = mixer();
    m.setMute('music', true);
    assert.strictEqual(m.getAudibility('music').audible, false);
    assert.match(m.getAudibility('music').reason, /muted/);
    m.setMute('music', false);
    m.setSolo('sfx', true);
    assert.strictEqual(m.getAudibility('music').audible, false);
    assert.match(m.getAudibility('music').reason, /solo/);
    assert.strictEqual(m.getAudibility('sfx').audible, true);
    assert.strictEqual(m.getAudibility('master').audible, true);
    assert.strictEqual(m.getAudibility('ghost').audible, false);
  });

  test('ducking ramps to depth on activity and releases cleanly', () => {
    const m = mixer();
    const dt = 1 / 60;
    // Sustained dialogue: attack 0.1s lands exactly on -12 dB.
    for (let i = 0; i < 30; i++) m.update(dt, { dialogue: true });
    assert.ok(Math.abs(m.effectiveGainDb('music') + 18) < 1e-9);
    assert.match(m.getAudibility('music').reason, /ducked/);
    // Release 0.4s returns to the -6 dB base exactly.
    for (let i = 0; i < 60; i++) m.update(dt, {});
    assert.ok(Math.abs(m.effectiveGainDb('music') + 6) < 1e-9);
  });

  test('snapshot transitions land on target gains', () => {
    const m = mixer();
    assert.strictEqual(m.transitionTo('quiet', 1.0), true);
    assert.strictEqual(m.activeTransition(), 'quiet');
    assert.strictEqual(m.transitionTo('missing', 1.0), false);
    for (let i = 0; i < 60; i++) m.update(1 / 60, {});
    assert.strictEqual(m.activeTransition(), null);
    assert.ok(Math.abs(m.getGainDb('music') + 24) < 1e-9);
    assert.ok(Math.abs(m.getGainDb('sfx') + 24) < 1e-9);
  });

  test('send cycles throw; removal re-parents children to master', () => {
    const m = new AudioMixer();
    m.defineBus('a', { send: 'master' });
    m.defineBus('b', { send: 'a' });
    assert.throws(() => m.defineBus('a', { send: 'b' }), /cycle/);
    assert.strictEqual(m.removeBus('master'), false);
    assert.strictEqual(m.removeBus('a'), true);
    // b now routes straight to master.
    assert.ok(Math.abs(m.effectiveGainDb('b')) < 1e-12);
  });

  test('voices route through the attached manager mixer', () => {
    const backend = new NullAudioBackend();
    const manager = new AudioManager(backend);
    manager.registerClip('song');
    const m = mixer();
    manager.setMixer(m);
    const voice = manager.play('song', { bus: 'music' });
    assert.ok(voice !== null);
    assert.ok(Math.abs(m.voiceGain('music', 1) - dbToLinear(-6)) < 1e-9);
    m.setMute('music', true);
    manager.update(1 / 60, {});
    assert.strictEqual(m.getAudibility('music').audible, false);
    manager.setMixer(null);
    manager.stopAll();
  });

  test('serialization round-trips buses, ducks, and snapshots', () => {
    const m = mixer();
    m.setGainDb('sfx', -3);
    for (let i = 0; i < 10; i++) m.update(1 / 60, { dialogue: true });
    const json = m.toJSON();
    assert.strictEqual(json.type, 'AudioMixer');
    const other = new AudioMixer();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.deepStrictEqual(other.busNames(), m.busNames());
    assert.ok(Math.abs(other.getGainDb('sfx') + 3) < 1e-9);
    assert.deepStrictEqual(other.snapshotNames(), ['quiet']);
    // Duck depth survived: both keep ducking music identically.
    other.update(1 / 60, { dialogue: true });
    m.update(1 / 60, { dialogue: true });
    assert.ok(Math.abs(other.effectiveGainDb('music') - m.effectiveGainDb('music')) < 1e-9);
  });
});
