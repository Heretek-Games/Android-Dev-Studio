import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { Hurtbox } from './Hurtbox.js';
import { Telegraph } from './Telegraph.js';
import { DodgeRoll } from './DodgeRoll.js';

const DT = 1 / 60;

function duelist(): { scene: Scene; hero: GameObject; ogre: GameObject } {
  const scene = new Scene('Duel');
  const hero = new GameObject('Hero');
  scene.addGameObject(hero);
  const ogre = new GameObject('Ogre');
  ogre.addComponent(new HealthComponent({ maxHealth: 100 }));
  ogre.addComponent(new Hurtbox({ invulnSeconds: 0.1 }));
  scene.addGameObject(ogre);
  return { scene, hero, ogre };
}

describe('Telegraph — readable enemy attacks', () => {
  test('windup -> strike -> recover -> idle with signals', () => {
    const { ogre } = duelist();
    const tell = ogre.addComponent(new Telegraph({
      windupSeconds: 0.6, strikeSeconds: 0.2, recoverSeconds: 0.5
    }));
    const events: string[] = [];
    tell.onTelegraph(() => events.push('tell'));
    tell.onStrike(() => events.push('strike'));

    assert.strictEqual(tell.start(), true);
    assert.strictEqual(tell.start(), false); // no overlapping tells
    assert.deepStrictEqual(events, ['tell']);
    for (let i = 0; i < 36; i++) tell.update(DT); // 0.6s windup
    assert.strictEqual(tell.phase, 'strike');
    assert.deepStrictEqual(events, ['tell', 'strike']);
    for (let i = 0; i < 12; i++) tell.update(DT); // 0.2s strike
    assert.strictEqual(tell.phase, 'recover');
    for (let i = 0; i < 30; i++) tell.update(DT); // 0.5s recover
    assert.strictEqual(tell.phase, 'idle');
  });

  test('cancel aborts back to idle', () => {
    const { ogre } = duelist();
    const tell = ogre.addComponent(new Telegraph({ windupSeconds: 1 }));
    tell.start();
    tell.update(DT);
    tell.cancel();
    assert.strictEqual(tell.phase, 'idle');
    assert.strictEqual(tell.phaseProgress(), 1);
  });

  test('phase progress tracks the windup for progress-driven tells', () => {
    const { ogre } = duelist();
    const tell = ogre.addComponent(new Telegraph({ windupSeconds: 1 }));
    tell.start();
    for (let i = 0; i < 30; i++) tell.update(DT);
    const progress = tell.phaseProgress();
    assert.ok(progress > 0.4 && progress < 0.6, `progress=${progress}`);
  });
});

describe('DodgeRoll — directional dodge with i-frames', () => {
  test('roll displaces with ease-out and grants i-frames', () => {
    const { hero } = duelist();
    hero.addComponent(new Hurtbox());
    const dodge = hero.addComponent(new DodgeRoll({ distance: 4, duration: 0.3 }));
    assert.strictEqual(dodge.dodge(1, 0), true);
    assert.strictEqual(dodge.dodging, true);
    assert.strictEqual(hero.getComponent(Hurtbox)!.invulnerable, true);
    for (let i = 0; i < 18; i++) dodge.update(DT); // 0.3s
    assert.strictEqual(dodge.dodging, false);
    assert.ok(Math.abs(hero.transform.position.x - 4) < 1e-6);
  });

  test('cooldown blocks chained dodges, recovers after', () => {
    const { hero } = duelist();
    const dodge = hero.addComponent(new DodgeRoll({ cooldownSeconds: 0.8 }));
    assert.strictEqual(dodge.dodge(0, 1), true);
    for (let i = 0; i < 21; i++) dodge.update(DT); // finish 0.35s roll
    assert.strictEqual(dodge.dodge(0, 1), false); // cooling down
    for (let i = 0; i < 60; i++) dodge.update(DT);
    assert.strictEqual(dodge.dodge(0, 1), true);
  });

  test('zero direction is rejected', () => {
    const { hero } = duelist();
    const dodge = hero.addComponent(new DodgeRoll());
    assert.strictEqual(dodge.dodge(0, 0), false);
  });
});
