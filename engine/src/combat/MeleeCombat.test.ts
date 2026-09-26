import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { Hurtbox } from './Hurtbox.js';
import type { HurtResolution } from './Hurtbox.js';
import { ElementalReactionComponent } from './ElementalReactionComponent.js';
import { MeleeHitbox } from './MeleeHitbox.js';

function arena(): { scene: Scene; hero: GameObject; goblin: GameObject } {
  const scene = new Scene('Melee');
  const hero = new GameObject('Hero');
  hero.transform.setPosition(0, 0, 0);
  scene.addGameObject(hero);
  const goblin = new GameObject('Goblin');
  goblin.transform.setPosition(0, 0, -2);
  goblin.addComponent(new HealthComponent({ maxHealth: 100 }));
  goblin.addComponent(new Hurtbox({ invulnSeconds: 10 }));
  scene.addGameObject(goblin);
  return { scene, hero, goblin };
}

describe('Hurtbox — damage sink with i-frames', () => {
  test('first hit lands, immediate second is invulnerable', () => {
    const { goblin } = arena();
    const hurt = goblin.getComponent(Hurtbox)!;
    const first = hurt.takeHit(30, goblin);
    assert.deepStrictEqual([first.applied, first.blocked, first.reason], [30, false, 'hit']);
    const second = hurt.takeHit(30, goblin);
    assert.deepStrictEqual([second.applied, second.blocked, second.reason], [0, true, 'invulnerable']);
  });

  test('i-frames expire after the window', () => {
    const { goblin } = arena();
    const hurt = goblin.getComponent(Hurtbox)!;
    hurt.takeHit(10, goblin);
    for (let i = 0; i < 11; i++) hurt.update(1);
    const later = hurt.takeHit(10, goblin);
    assert.strictEqual(later.reason, 'hit');
  });

  test('dodge grants i-frames without a hit', () => {
    const { goblin } = arena();
    const hurt = goblin.getComponent(Hurtbox)!;
    hurt.grantInvuln(5);
    assert.strictEqual(hurt.invulnerable, true);
    assert.strictEqual(hurt.takeHit(99, goblin).reason, 'invulnerable');
  });

  test('missing health fails explicitly', () => {
    const scene = new Scene('NoHealth');
    const ghost = new GameObject('Ghost');
    ghost.addComponent(new Hurtbox());
    scene.addGameObject(ghost);
    assert.strictEqual(ghost.getComponent(Hurtbox)!.takeHit(10, ghost).reason, 'no-health');
  });
});

describe('MeleeHitbox — arc strikes with one-hit-per-swing', () => {
  test('frontal target in range takes the hit', () => {
    const { hero, goblin } = arena();
    const blade = hero.addComponent(new MeleeHitbox({ damage: 25, range: 2.5, arcDegrees: 120 }));
    const seen: string[] = [];
    blade.onHit(hit => seen.push(hit.targetName));
    blade.beginSwing();
    const hits = blade.tryHit();
    assert.strictEqual(hits.length, 1);
    assert.deepStrictEqual(seen, ['Goblin']);
    assert.strictEqual(hits[0].applied, 25);
    const health = goblin.getComponent(HealthComponent)!;
    assert.strictEqual(health.health, 75);
  });

  test('same swing never double-hits (i-frames would also block)', () => {
    const { hero } = arena();
    const blade = hero.addComponent(new MeleeHitbox({ damage: 25, range: 5 }));
    blade.beginSwing();
    assert.strictEqual(blade.tryHit().length, 1);
    assert.strictEqual(blade.tryHit().length, 0);
    blade.beginSwing();
    assert.strictEqual(blade.tryHit().length, 0); // i-frames (10s) still hold
  });

  test('targets behind the arc are spared', () => {
    const { hero, goblin } = arena();
    goblin.transform.setPosition(0, 0, 2); // behind facing (-Z)
    const blade = hero.addComponent(new MeleeHitbox({ damage: 25, range: 2.5, arcDegrees: 90 }));
    blade.beginSwing();
    assert.strictEqual(blade.tryHit().length, 0);
  });

  test('out-of-range targets are spared', () => {
    const { hero, goblin } = arena();
    goblin.transform.setPosition(0, 0, -9);
    const blade = hero.addComponent(new MeleeHitbox({ damage: 25, range: 2.5 }));
    blade.beginSwing();
    assert.strictEqual(blade.tryHit().length, 0);
  });
});

describe('Elemental melee — infusion strikes through the Hurtbox', () => {
  function elementalDuel(): { hero: GameObject; slime: GameObject } {
    const scene = new Scene('ElementalMelee');
    const hero = new GameObject('Hero');
    hero.transform.setPosition(0, 0, 0);
    scene.addGameObject(hero);
    const slime = new GameObject('Pyro Slime');
    slime.transform.setPosition(0, 0, -2);
    slime.addComponent(new ElementalReactionComponent({
      baseElement: 'Pyro', maxHealth: 100
    }));
    slime.addComponent(new Hurtbox({ invulnSeconds: 0 }));
    scene.addGameObject(slime);
    return { hero, slime };
  }

  test('hydro sword on a pyro aura triggers Vaporize with amplified damage', () => {
    const { hero, slime } = elementalDuel();
    const blade = hero.addComponent(new MeleeHitbox({
      damage: 25, range: 2.5, arcDegrees: 360, element: 'Hydro'
    }));
    blade.beginSwing();
    const hits = blade.tryHit();
    assert.strictEqual(hits.length, 1);
    assert.notStrictEqual(hits[0].reaction, 'None');
    assert.ok(hits[0].applied > 25, `vaporize amplifies: applied=${hits[0].applied}`);
    assert.strictEqual(hits[0].fatal, false);
  });

  test('element-less strikes deal physical damage to the elemental pool', () => {
    const { hero, slime } = elementalDuel();
    const blade = hero.addComponent(new MeleeHitbox({
      damage: 30, range: 2.5, arcDegrees: 360
    }));
    blade.beginSwing();
    const hits = blade.tryHit();
    assert.strictEqual(hits.length, 1);
    assert.deepStrictEqual([hits[0].applied, hits[0].reaction], [30, 'None']);
    assert.strictEqual(slime.getComponent(ElementalReactionComponent)!.health, 70);
  });

  test('lethal strikes report fatal and destroy the target', () => {
    const { hero, slime } = elementalDuel();
    const scene = slime.scene!;
    const blade = hero.addComponent(new MeleeHitbox({
      damage: 500, range: 2.5, arcDegrees: 360
    }));
    const resolutions: HurtResolution[] = [];
    slime.getComponent(Hurtbox)!.onResolved(r => resolutions.push(r));
    blade.beginSwing();
    const hits = blade.tryHit();
    assert.strictEqual(hits[0].fatal, true);
    assert.deepStrictEqual(resolutions.map(r => [r.targetName, r.fatal]), [['Pyro Slime', true]]);
    assert.strictEqual(scene.findByName('Pyro Slime'), null); // destroyed out of the scene
  });

  test('physical kills report fatal through the HealthComponent path', () => {
    const { hero, goblin } = arena();
    goblin.getComponent(HealthComponent)!.takeDamage(90); // 10 HP left
    const hurt = goblin.getComponent(Hurtbox)!;
    hurt.update(11); // expire the 10s arena i-frames
    const blade = hero.addComponent(new MeleeHitbox({ damage: 25, range: 2.5 }));
    blade.beginSwing();
    const hits = blade.tryHit();
    assert.strictEqual(hits[0].fatal, true);
    assert.strictEqual(hits[0].applied, 10); // clamped to remaining health
  });
});
