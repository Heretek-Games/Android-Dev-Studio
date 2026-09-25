import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { AnimFSM } from '../animation/AnimFSM.js';
import { TimelineLite } from './TimelineLite.js';

const DT = 1 / 60;

function timeline(options?: Record<string, unknown>): { scene: Scene; tl: TimelineLite } {
  const scene = new Scene('Test');
  const mover = new GameObject('Mover');
  mover.transform.setPosition(0, 0, 0);
  scene.addGameObject(mover);
  const actor = new GameObject('Actor');
  actor.addComponent(new AnimFSM({
    states: { Idle: { clip: 'idle' }, Run: { clip: 'run' } },
    transitions: [{ from: 'Idle', to: 'Run', conditions: [{ param: 'go', op: 'trigger' }] }]
  }));
  scene.addGameObject(actor);
  const host = new GameObject('Director');
  const tl = host.addComponent(new TimelineLite(options as never));
  scene.addGameObject(host);
  return { scene, tl };
}

function step(tl: TimelineLite, frames: number): void {
  for (let i = 0; i < frames; i++) tl.update(DT);
}

describe('TimelineLite — tracks, clips, seeking', () => {
  test('move clip interpolates the target across its window', () => {
    const { scene, tl } = timeline({
      duration: 4,
      tracks: [{ target: 'Mover', clips: [{ id: 'm1', start: 1, dur: 2, type: 'move', data: { to: [6, 0, 0] } }] }]
    });
    step(tl, 60); // t=1: window opens at the origin
    assert.ok(Math.abs(scene.findByName('Mover')!.transform.position.x) < 1e-9);
    step(tl, 60); // t=2: halfway
    assert.ok(Math.abs(scene.findByName('Mover')!.transform.position.x - 3) < 1e-9);
    step(tl, 120); // t=4: arrived, timeline finished
    assert.strictEqual(scene.findByName('Mover')!.transform.position.x, 6);
    assert.strictEqual(tl.finished, true);
    assert.strictEqual(tl.playing, false);
  });

  test('event clips emit once per pass with names', () => {
    const { tl } = timeline({
      duration: 4,
      tracks: [{ target: 'Mover', clips: [{ id: 'e1', start: 1, type: 'event', data: { name: 'boom' } }] }]
    });
    // emitted drains every pass by design: collect across steps.
    const seen: Array<{ name: string; target: string }> = [];
    for (let i = 0; i < 30; i++) {
      tl.update(DT);
      seen.push(...tl.emitted);
    }
    assert.strictEqual(seen.length, 0);
    for (let i = 0; i < 40; i++) {
      tl.update(DT);
      seen.push(...tl.emitted);
    }
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].name, 'boom');
    assert.strictEqual(seen[0].target, 'Mover');
    for (let i = 0; i < 100; i++) {
      tl.update(DT);
      seen.push(...tl.emitted);
    }
    assert.strictEqual(seen.length, 1); // no refire without rewind
  });

  test('anim clips drive the target FSM', () => {
    const { scene, tl } = timeline({
      duration: 4,
      tracks: [{ target: 'Actor', clips: [{ id: 'a1', start: 0.5, type: 'anim', data: { trigger: 'go' } }] }]
    });
    const fsm = scene.findByName('Actor')!.getComponent(AnimFSM)!;
    // Timeline pokes the trigger; the FSM consumes it on its own update.
    for (let i = 0; i < 60; i++) {
      tl.update(DT);
      fsm.update(DT);
    }
    assert.strictEqual(fsm.current, 'Run');
  });

  test('seek re-arms events; restart replays the timeline', () => {
    const { tl } = timeline({
      duration: 4,
      tracks: [{ target: 'Mover', clips: [{ id: 'e1', start: 1, type: 'event', data: { name: 'ping' } }] }]
    });
    const seen: string[] = [];
    const drain = (frames: number): void => {
      for (let i = 0; i < frames; i++) {
        tl.update(DT);
        for (const e of tl.emitted) seen.push(e.name);
      }
    };
    drain(120);
    assert.deepStrictEqual(seen, ['ping']);
    tl.seek(0);
    drain(120);
    assert.deepStrictEqual(seen, ['ping', 'ping']); // fired again after rewind
    tl.restart();
    assert.strictEqual(tl.time, 0);
    assert.strictEqual(tl.finished, false);
  });

  test('missing targets skip silently; loop wraps the clock', () => {
    const { tl } = timeline({
      duration: 2,
      loop: true,
      tracks: [
        { target: 'Ghost', clips: [{ id: 'g1', start: 0.5, type: 'event', data: { name: 'boo' } }] },
        { target: 'Mover', clips: [{ id: 'm1', start: 0, dur: 2, type: 'move', data: { to: [4, 0, 0] } }] }
      ]
    });
    step(tl, 240); // two full loops: no throw, clock wrapped
    assert.strictEqual(tl.finished, false);
    assert.ok(tl.time < 2);
  });

  test('serializes clock and tracks', () => {
    const { tl } = timeline({
      duration: 4,
      tracks: [{ target: 'Mover', clips: [{ id: 'm1', start: 1, dur: 2, type: 'move', data: { to: [6, 0, 0] } }] }]
    });
    step(tl, 90);
    const json = tl.toJSON();
    assert.strictEqual(json.type, 'TimelineLite');
    const other = new TimelineLite();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.time, tl.time);
    assert.strictEqual(other.tracks.length, 1);
    assert.strictEqual(other.tracks[0].clips[0].id, 'm1');
  });
});
