import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { retargetClip, retargetCoverage, splitTrackName } from './RigRetarget.js';

function sourceClip(): THREE.AnimationClip {
  return new THREE.AnimationClip('Slash', 1.0, [
    new THREE.QuaternionKeyframeTrack(
      'Hips.quaternion',
      [0, 0.5, 1.0],
      [0, 0, 0, 1, 0, 0.38, 0, 0.92, 0, 0.71, 0, 0.71]
    ),
    new THREE.VectorKeyframeTrack(
      'Spine.position',
      [0, 1.0],
      [0, 0, 0, 0, 0.2, 0]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Tail.quaternion',
      [0, 1.0],
      [0, 0, 0, 1, 0, 0, 0, 1]
    )
  ]);
}

const MAP = { Hips: 'Pelvis', Spine: 'Torso' };

describe('RigRetarget — data-level clip remap', () => {
  test('renames tracks through the joint map, preserving data', () => {
    const { clip, dropped } = retargetClip(sourceClip(), MAP);
    assert.strictEqual(clip.name, 'Slash_retargeted');
    assert.strictEqual(clip.duration, 1.0);
    assert.deepStrictEqual(
      clip.tracks.map(t => t.name),
      ['Pelvis.quaternion', 'Torso.position']
    );
    assert.deepStrictEqual(dropped, ['Tail.quaternion']);
    const quat = clip.tracks[0] as THREE.QuaternionKeyframeTrack;
    assert.deepStrictEqual([...quat.times], [0, 0.5, 1.0]);
    assert.strictEqual(quat.values.length, 12);
  });

  test('keep mode retains unmapped tracks untouched', () => {
    const { clip, dropped } = retargetClip(sourceClip(), MAP, { dropUnmapped: false });
    assert.strictEqual(clip.tracks.length, 3);
    assert.deepStrictEqual(dropped, ['Tail.quaternion']);
  });

  test('unparseable track names fail loudly', () => {
    const bad = new THREE.AnimationClip('Bad', 1.0, [
      new THREE.VectorKeyframeTrack('mystery', [0], [1, 2, 3])
    ]);
    assert.throws(() => retargetClip(bad, MAP), /unparseable track name/);
  });

  test('coverage reports the mappable fraction', () => {
    assert.strictEqual(retargetCoverage(sourceClip(), MAP), 2 / 3);
    assert.strictEqual(retargetCoverage(sourceClip(), { Hips: 'P', Spine: 'T', Tail: 'Tl' }), 1);
    assert.strictEqual(
      retargetCoverage(new THREE.AnimationClip('Empty', 0, []), MAP), 1);
  });

  test('splitTrackName tolerates dots in node names', () => {
    assert.deepStrictEqual(splitTrackName('Rig.Hips.quaternion'),
      { node: 'Rig.Hips', property: 'quaternion' });
    assert.strictEqual(splitTrackName('mystery'), null);
  });
});
