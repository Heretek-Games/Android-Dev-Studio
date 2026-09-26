/**
 * GameView — the fullscreen playable arena (menu → gameplay → win/lose → restart).
 *
 * Boots the engine scene from the SAME `fps_arena` scenario spec the headless QA
 * runs, wires the real `GameRuntime` (waves, weapon hit routing, damage, win/lose),
 * renders with a dedicated three.js renderer, and mounts the `GameShell` HUD.
 *
 * The player auto-aims at the nearest enemy and fires while playing, which keeps
 * the slice playable on touch-only devices without a second joystick.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  EngineContext,
  PhysicsWorld,
  GameRuntime,
  GameShell,
  SaveSystem,
  WeaponController,
  HealthComponent,
  MeshRenderer,
  EnemyAI,
  VehicleController,
  RigidBody3D,
  Collider3D,
  GameObject,
  ElementalReactionComponent,
  DialogueManager,
  MobileController,
  MeleeHitbox,
  Hurtbox,
  Telegraph,
  Quest,
  Party,
  Settlement,
  BUILDINGS,
  type BuildingType,
  type DialogueTree,
  type Scene as EngineScene
} from '@heretek/engine';
import { buildEngineScene } from '../services/HarnessSceneAdapter';
import type { HarnessScene } from '../services/SceneStore';
import fpsArenaSpec from '../../../harness/config/scenarios/fps_arena.json';
import drivingSliceSpec from '../../../harness/config/scenarios/driving_slice.json';
import dungeonSliceSpec from '../../../harness/config/scenarios/dungeon_slice.json';
import citySliceSpec from '../../../harness/config/scenarios/city_slice.json';
import tideSliceSpec from '../../../harness/config/scenarios/tide_cinder.json';

/** `?play=driving|dungeon|city|tide` boots those slices; anything else boots the arena. */
type GameKind = 'arena' | 'driving' | 'dungeon' | 'city' | 'tide';

const gameKindFromUrl = (): GameKind => {
  if (typeof window === 'undefined') return 'arena';
  const play = new URLSearchParams(window.location.search).get('play');
  if (play === 'driving') return 'driving';
  if (play === 'dungeon') return 'dungeon';
  if (play === 'city') return 'city';
  if (play === 'tide') return 'tide';
  return 'arena';
};

interface ArenaGameConfig {
  mode?: 'waves' | 'distance' | 'build';
  playerName?: string;
  settlement?: {
    gridSize?: number;
    targetPopulation?: number;
    startingGold?: number;
    startingFood?: number;
  };
  targetScore?: number;
  timeLimitSeconds?: number;
  totalWaves?: number;
  enemiesPerWave?: number | number[];
  spawnRadius?: number;
  scorePerKill?: number;
  interWaveDelaySeconds?: number;
  hitElement?: string;
  melee?: {
    damage?: number;
    range?: number;
    arcDegrees?: number;
    element?: string;
    gauge?: number;
    swingEveryFrames?: number;
    invulnSeconds?: number;
  };
  boss?: {
    wave?: number;
    name?: string;
    health?: number;
    size?: number[];
    color?: string;
    telegraph?: { windupSeconds?: number; strikeSeconds?: number; recoverSeconds?: number };
    strikeDamage?: number;
    strikeRange?: number;
  };
  enemy?: {
    shape?: string;
    size?: number[];
    color?: string;
    y?: number;
    health?: { maxHealth?: number; destroyOnDeath?: boolean };
    ai?: { moveSpeed?: number; attackRange?: number; attackDamage?: number; attackIntervalSeconds?: number };
  };
}

const PLAYER_START: [number, number, number] = [0, 1.5, 0];

export const GameView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const kind = gameKindFromUrl();
    const rawSpec =
      kind === 'driving'
        ? drivingSliceSpec
        : kind === 'dungeon'
          ? dungeonSliceSpec
          : kind === 'city'
            ? citySliceSpec
            : kind === 'tide'
              ? tideSliceSpec
              : fpsArenaSpec;
    const spec = rawSpec as unknown as HarnessScene;
    const gameConfig = (rawSpec as unknown as { game?: ArenaGameConfig }).game ?? {};
    const questSpec = (rawSpec as unknown as { quest?: { id: string; stages: never[] } }).quest ?? null;
    const playerName = gameConfig.playerName ?? (kind === 'driving' ? 'Player Car' : 'Player Hero');
    const isCity = kind === 'city';
    const isTide = kind === 'tide';

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let shell: GameShell | null = null;
    let runtime: GameRuntime | null = null;
    let context: EngineContext | null = null;

    const boot = async () => {
      const scene = buildEngineScene(spec) as EngineScene;
      const player = scene.findByName(playerName);
      if (!player && !isCity) throw new Error(`GameView: player "${playerName}" missing from the scenario spec`);
      const health = player?.getComponent(HealthComponent) ?? null;
      const weapon = player?.getComponent(WeaponController) ?? null;
      const vehicle = player?.getComponent(VehicleController) ?? null;
      const playerBody = player?.getComponent(RigidBody3D) ?? null;

      const physicsWorld = new PhysicsWorld();
      await physicsWorld.initialize();
      if (disposed) return; // StrictMode/unmount raced the async boot: abort cleanly
      scene.physicsWorld = physicsWorld;
      // instanceof dispatch: class names are mangled by the production minifier, so
      // `constructor.name` checks silently skip physics initialisation in the APK.
      for (const go of scene.gameObjects) {
        for (const component of go.components) {
          if (component instanceof RigidBody3D || component instanceof Collider3D) {
            (component as unknown as { initPhysics(w: PhysicsWorld): void }).initPhysics(physicsWorld);
          }
        }
      }

      const enemySpec = gameConfig.enemy ?? {};
      const enemyHealth = enemySpec.health ?? { maxHealth: 50, destroyOnDeath: true };
      const meleeSpec = gameConfig.melee ?? null;
      const bossSpec = gameConfig.boss ?? null;
      // Tide slice: melee kill/reaction tallies off Hurtbox resolutions.
      let meleeKills = 0;
      let meleeReactions = 0;
      // Tide slice: 2-hero single-player party (declared before buildEnemy).
      let party: Party | null = null;

      // City mode starts with an empty settlement on a wide founding grid: the
      // player founds the town. (The QA scenario ships its own small gridSize plus
      // scripted placements so the headless run is fast and deterministic; the
      // playable run shares only the economy targets and starting funds.)
      const settlementSpec = gameConfig.settlement ?? {};
      const settlement = isCity
        ? new Settlement(
            24,
            settlementSpec.targetPopulation ?? 6,
            settlementSpec.startingGold ?? 500,
            settlementSpec.startingFood ?? 20
          )
        : null;

      runtime = new GameRuntime({
        scene,
        mode: kind === 'driving' ? 'distance' : isCity ? 'build' : 'waves',
        playerName,
        settlement: settlement ?? undefined,
        targetScore: gameConfig.targetScore,
        timeLimitSeconds: gameConfig.timeLimitSeconds,
        totalWaves: gameConfig.totalWaves ?? 2,
        enemiesPerWave: (wave) =>
          Array.isArray(gameConfig.enemiesPerWave)
            ? (gameConfig.enemiesPerWave[Math.min(wave - 1, gameConfig.enemiesPerWave.length - 1)] ?? 1)
            : (gameConfig.enemiesPerWave ?? 1),
        spawnRadius: gameConfig.spawnRadius ?? 8,
        scorePerKill: gameConfig.scorePerKill ?? 100,
        interWaveDelaySeconds: gameConfig.interWaveDelaySeconds ?? 1,
        weapon: kind === 'driving' ? undefined : weapon ?? undefined,
        hitElement: (gameConfig as { hitElement?: string }).hitElement as never,
        buildEnemy: kind === 'driving' ? undefined : ({ name, position, wave }) => {
          // Tide slice: per-wave boss override (pool, frame, live telegraph).
          const boss = isTide && bossSpec && wave === bossSpec.wave ? bossSpec : null;
          const enemy = new GameObject(boss?.name ?? name);
          enemy.transform.setPosition(position[0], position[1] + (enemySpec.y ?? 0.8), position[2]);
          enemy.addComponent(
            new MeshRenderer({
              shape: (enemySpec.shape as 'box') ?? 'box',
              size: ((boss?.size ?? enemySpec.size) as [number, number, number]) ?? [1, 1.5, 1],
              color: boss?.color ?? enemySpec.color ?? '#ef4444',
              roughness: 0.5
            })
          );
          const elementalSpec = (enemySpec as { elemental?: { aura?: string; maxHealth?: number } }).elemental;
          const elementalHealth = boss?.health ?? elementalSpec?.maxHealth;
          if (elementalSpec) {
            const elemental = new ElementalReactionComponent(
              elementalSpec.aura ? { baseElement: elementalSpec.aura as never } : undefined
            );
            elemental.maxHealth = elementalHealth ?? 80;
            elemental.health = elemental.maxHealth;
            enemy.addComponent(elemental);
            scene.addGameObject(enemy);
          } else {
            enemy.addComponent(
              new HealthComponent({ maxHealth: boss?.health ?? enemyHealth.maxHealth ?? 50, destroyOnDeath: true })
            );
            scene.addGameObject(enemy);
          }
          if (isTide && meleeSpec) {
            const hurt = new Hurtbox({ invulnSeconds: meleeSpec.invulnSeconds ?? 0.2, faction: 'foe' });
            hurt.onResolved((resolution) => {
              if (resolution.fatal) meleeKills += 1;
              if (resolution.reaction && resolution.reaction !== 'None') meleeReactions += 1;
            });
            enemy.addComponent(hurt);
          }
          if (boss?.telegraph) {
            const tell = new Telegraph(boss.telegraph);
            const bossMesh = enemy.getComponent(MeshRenderer);
            const baseColor = bossMesh?.color ?? '#dc2626';
            tell.onTelegraph(() => {
              if (bossMesh) bossMesh.color = '#7f1d1d';
            });
            tell.onStrike(() => {
              if (bossMesh) bossMesh.color = baseColor;
              const hero = party?.active() ?? player;
              const heroHurt = hero?.getComponent(Hurtbox) ?? null;
              if (!hero || !heroHurt) return;
              const dx = hero.transform.position.x - enemy.transform.position.x;
              const dz = hero.transform.position.z - enemy.transform.position.z;
              if (Math.hypot(dx, dz) <= (boss.strikeRange ?? 4)) {
                heroHurt.takeHit(boss.strikeDamage ?? 10, enemy);
              }
            });
            enemy.addComponent(tell);
          }
          enemy.addComponent(new EnemyAI({ targetName: playerName, ...(enemySpec.ai ?? {}) }));
          return enemy;
        }
      });

      // Tide and Cinder: post-wave respite — clearing a wave restores 40 HP
      // to both party heroes (standard ARPG condolence for slow readers).
      if (isTide) {
        runtime.spawner.onWaveCleared(() => {
          for (const member of [player, squire]) {
            member?.getComponent(HealthComponent)?.heal(40);
          }
        });
      }

      const buildingMeshes = new Map<number, GameObject>();
      const resetArena = () => {
        for (const name of runtime!.spawner.getSpawnedNames()) {
          scene.findByName(name)?.destroy();
        }
        if (isCity) {
          settlement?.reset();
          for (const mesh of buildingMeshes.values()) mesh.destroy();
          buildingMeshes.clear();
          return;
        }
        player!.transform.setPosition(PLAYER_START[0], PLAYER_START[1], PLAYER_START[2]);
        player!.transform.setRotation(0, 0, 0);
        playerBody?.setPosition(PLAYER_START[0], PLAYER_START[1], PLAYER_START[2]);
        health?.heal(health.maxHealth);
        if (isTide && squire) {
          squire.transform.setPosition(2, 1.5, 2);
          squire.getComponent(HealthComponent)?.heal(100);
          if (party) {
            party.update(10); // expire any swap cooldown, then restore lead
            if (party.activeIndex !== 0) party.swapTo(0);
          }
        }
        if (vehicle) {
          vehicle.throttle = 0;
          vehicle.steering = 0;
          vehicle.brake = 0;
        }
      };

      const saveSystem = new SaveSystem();
      const SAVE_SLOT = isTide ? 'tide' : 'arena';
      runtime.prepare();

      // Tide and Cinder: hero blade (uninfused until the blessing), hurtbox,
      // AI companion squire, and the 2-hero single-player party.
      let blade: MeleeHitbox | null = null;
      let squire: GameObject | null = null;
      let quest: Quest | null = null;
      const questFlags = new Set<string>();
      if (isTide && player && meleeSpec) {
        const bladeOpts = {
          damage: meleeSpec.damage ?? 40,
          range: meleeSpec.range ?? 3.5,
          arcDegrees: meleeSpec.arcDegrees ?? 120,
          gaugeUnits: meleeSpec.gauge ?? 1,
          foeFactions: ['foe']
        };
        blade = new MeleeHitbox(bladeOpts);
        player.addComponent(blade);
        player.addComponent(new Hurtbox({ invulnSeconds: 0.5, faction: 'ally' }));
        squire = new GameObject('Squire');
        squire.transform.setPosition(2, 1.5, 2);
        squire.addComponent(new MeshRenderer({ shape: 'capsule', size: [1, 1.5, 1], color: '#a78bfa', roughness: 0.5 }));
        const squireBrain = new MobileController();
        squireBrain.enabled = false;
        squire.addComponent(squireBrain);
        squire.addComponent(new HealthComponent({ maxHealth: 100, destroyOnDeath: false }));
        // Each hero carries their own blade; swings resolve from the active hero.
        squire.addComponent(new MeleeHitbox(bladeOpts));
        squire.addComponent(new Hurtbox({ invulnSeconds: 0.5, faction: 'ally' }));
        scene.addGameObject(squire);
        party = new Party({ swapCooldownSeconds: 1.0 });
        party.setMembers([player, squire]);
      }
      if (isTide && questSpec) {
        quest = new Quest(questSpec as unknown as { id: string; stages: never[] });
      }

      // Dungeon dialogue: the keeper offers a Hydro blessing (drives hitElement).
      // Tide dialogue: the same blessing infuses the hero blade instead.
      const dialogue = kind === 'dungeon' || isTide ? new DialogueManager() : null;
      const dialogueTrees = (rawSpec as unknown as { dialogues?: Record<string, DialogueTree> }).dialogues;
      if (dialogue && dialogueTrees) {
        for (const tree of Object.values(dialogueTrees)) dialogue.registerTree(tree);
        dialogue.addEventListener((eventName) => {
          if (eventName === 'hydro_blessing' && !isTide) runtime!.setHitElement('Hydro');
          // Tide: the blessing infuses every party blade.
          if (eventName === 'hydro_blessing' && isTide) {
            for (const member of [player, squire]) {
              const memberBlade = member?.getComponent(MeleeHitbox) ?? null;
              if (memberBlade) memberBlade.element = 'Hydro' as never;
            }
          }
          if (isTide) questFlags.add(eventName);
        });
      }

      shell = new GameShell({
        flow: runtime.flow,
        session: runtime.session,
        title:
          kind === 'driving'
            ? 'Heretek Drive — Avenue Sprint'
            : kind === 'dungeon'
              ? 'Heretek Dungeon — Slime Hall'
              : isCity
                ? 'Heretek City — Founding'
                : isTide
                  ? 'Tide and Cinder'
                  : 'Heretek Arena — Wave Defense',
        hud:
          kind === 'driving'
            ? { scoreLabel: 'Distance', scoreSuffix: 'm', showWave: false, showKills: false, showHealth: false }
            : isCity
              ? { scoreLabel: 'Pop', showWave: false, showKills: false, showHealth: false }
              : isTide
                ? { scoreLabel: 'Score', showWave: true, showKills: false, showHealth: true }
                : undefined,
        root: container,
        getHealthFraction: () => (health ? health.healthFraction : 1),
        onStart: () => {
          resetArena();
          runtime!.start();
          if (dialogue && dialogueTrees) {
            const node = dialogue.startConversation('DungeonKeeper');
            if (node) showDialogueNode(node);
          }
        },
        onRestart: () => {
          resetArena();
          if (isTide) {
            meleeKills = 0;
            meleeReactions = 0;
            questFlags.clear();
            if (questSpec) quest = new Quest(questSpec as unknown as { id: string; stages: never[] });
            lastQuestStage = -1;
            lastQuestKills = -1;
            lastQuestReactions = -1;
            questBar.style.display = 'none';
            if (blade) blade.element = undefined;
            if (squire) {
              const squireBlade = squire.getComponent(MeleeHitbox) ?? null;
              if (squireBlade) squireBlade.element = undefined;
            }
            // Replay the keeper audience so the blessing (and its quest flag)
            // is earnable again; history resets on startConversation.
            if (dialogue) {
              dialogue.endConversation();
              const node = dialogue.startConversation('DungeonKeeper');
              if (node) showDialogueNode(node);
            }
          }
          runtime!.restart();
        },
        onQuit: () => {
          runtime!.stop();
          resetArena();
        },
        // Saves capture the session snapshot only; the settlement grid is not
        // serialized, so save slots stay an arena/dungeon feature.
        hasSave: () => !isCity && saveSystem.load(SAVE_SLOT) !== null,
        onSave: () => {
          if (isCity) return;
          saveSystem.save(
            SAVE_SLOT,
            runtime!.session.snapshot(),
            isTide && quest ? { quest: quest.toJSON() } : undefined
          );
        },
        onLoad: () => {
          if (isCity) return;
          const envelope = saveSystem.load(SAVE_SLOT);
          if (!envelope) return;
          resetArena();
          runtime!.session.restore(envelope.session);
          if (isTide && quest && envelope.data && (envelope.data as { quest?: unknown }).quest) {
            const restored = Quest.fromJSON((envelope.data as { quest: Record<string, unknown> }).quest as never);
            quest.completedStageIds = restored.completedStageIds;
            quest.complete = restored.complete;
          }
          if (runtime!.flow.getPhase() === 'menu') {
            runtime!.flow.transition('start');
          }
          runtime!.spawner.start();
        }
      });
      shell.mount();

      // City builder UI: build toolbar, treasury stats, and placement messages.
      const cityBar = document.createElement('div');
      cityBar.style.cssText =
        'position:absolute;left:12px;top:12px;display:flex;flex-direction:column;gap:6px;z-index:60;';
      const cityStats = document.createElement('div');
      cityStats.style.cssText =
        'padding:8px 12px;border-radius:8px;background:rgba(9,9,12,0.85);border:1px solid #3f3f46;' +
        'color:#e4e4e7;font-size:12px;font-family:system-ui,sans-serif;white-space:pre-line;';
      const cityMessage = document.createElement('div');
      cityMessage.style.cssText =
        'padding:8px 12px;border-radius:8px;background:rgba(127,29,29,0.92);color:#fecaca;' +
        'font-size:12px;font-family:system-ui,sans-serif;display:none;max-width:240px;';
      cityBar.append(cityStats, cityMessage);
      const buildButtons: Record<string, HTMLButtonElement> = {};
      let selectedBuilding: BuildingType = 'house';
      if (isCity && settlement) {
        for (const type of ['house', 'farm', 'market'] as BuildingType[]) {
          const button = document.createElement('button');
          const spec = BUILDINGS[type];
          button.textContent = `${type[0].toUpperCase() + type.slice(1)} (${spec.costGold}g)`;
          button.style.cssText =
            'padding:8px 14px;border-radius:8px;border:1px solid #3f3f46;background:rgba(24,24,27,0.9);' +
            'color:#e4e4e7;font-size:13px;cursor:pointer;font-family:system-ui,sans-serif;text-align:left;';
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            selectedBuilding = type;
            for (const [key, other] of Object.entries(buildButtons)) {
              other.style.borderColor = key === type ? '#22c55e' : '#3f3f46';
              other.style.background = key === type ? 'rgba(20,40,25,0.95)' : 'rgba(24,24,27,0.9)';
            }
          });
          buildButtons[type] = button;
          cityBar.append(button);
        }
        buildButtons.house.style.borderColor = '#22c55e';
        container.append(cityBar);
      }

      let messageTimer: ReturnType<typeof setTimeout> | null = null;
      const showCityMessage = (message: string) => {
        cityMessage.textContent = message;
        cityMessage.style.display = 'block';
        if (messageTimer) clearTimeout(messageTimer);
        messageTimer = setTimeout(() => {
          cityMessage.style.display = 'none';
        }, 2500);
      };

      const BUILDING_STYLE: Record<BuildingType, { color: string; size: [number, number, number]; y: number }> = {
        house: { color: '#f59e0b', size: [1.2, 1.2, 1.2], y: 0.6 },
        farm: { color: '#4ade80', size: [1.4, 0.3, 1.4], y: 0.15 },
        market: { color: '#38bdf8', size: [1.4, 1.6, 1.4], y: 0.8 }
      };

      const gridSize = 24;
      const cityBridge = (window as unknown as { AndroidBridge?: { log?: (tag: string, message: string) => void } })
        .AndroidBridge;
      const worldOf = (gx: number, gz: number): [number, number] => [gx - gridSize / 2 + 0.5, gz - gridSize / 2 + 0.5];

      const placeBuildingAt = (gx: number, gz: number): void => {
        if (!settlement || runtime!.flow.getPhase() !== 'playing') return;
        const result = settlement.place(selectedBuilding, gx, gz);
        cityBridge?.log?.(
          'CityPlace',
          JSON.stringify({ type: selectedBuilding, gx, gz, ok: result.id !== null, reason: result.reason ?? null })
        );
        if (result.id === null) {
          showCityMessage(result.reason ?? 'Cannot build here.');
          return;
        }
        const style = BUILDING_STYLE[selectedBuilding];
        const [wx, wz] = worldOf(gx, gz);
        const mesh = new GameObject(`${selectedBuilding} ${result.id}`);
        mesh.transform.setPosition(wx, style.y, wz);
        mesh.addComponent(
          new MeshRenderer({ shape: 'box', size: style.size, color: style.color, roughness: 0.6 })
        );
        scene.addGameObject(mesh);
        buildingMeshes.set(result.id, mesh);
      };

      // Minimal dialogue overlay driven by the real DialogueManager.
      const dialoguePanel = document.createElement('div');
      dialoguePanel.style.cssText =
        'position:absolute;left:50%;bottom:8%;transform:translateX(-50%);max-width:620px;padding:14px 18px;' +
        'border-radius:12px;background:rgba(12,10,20,0.92);border:1px solid #4c1d95;color:#ede9fe;' +
        'font-family:system-ui,sans-serif;display:none;z-index:60;text-align:center;';
      const dialogueSpeaker = document.createElement('div');
      dialogueSpeaker.style.cssText = 'font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#a78bfa;margin-bottom:6px;';
      const dialogueText = document.createElement('div');
      dialogueText.style.cssText = 'font-size:14px;line-height:1.5;margin-bottom:10px;';
      const dialogueChoices = document.createElement('div');
      dialogueChoices.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
      dialoguePanel.append(dialogueSpeaker, dialogueText, dialogueChoices);
      container.append(dialoguePanel);

      const showDialogueNode = (node: { speaker?: string; text?: string; choices?: Array<{ text: string }> } | null) => {
        if (!dialogue || !node) {
          dialoguePanel.style.display = 'none';
          return;
        }
        dialoguePanel.style.display = 'block';
        dialogueSpeaker.textContent = node.speaker ?? '';
        dialogueText.textContent = node.text ?? '';
        dialogueChoices.innerHTML = '';
        const choices = dialogue.getAvailableChoices();
        choices.forEach(({ choice, index }) => {
          const button = document.createElement('button');
          button.textContent = choice.text;
          button.style.cssText =
            'padding:8px 16px;border-radius:8px;border:1px solid #6d28d9;background:#4c1d95;color:#fff;' +
            'font-size:13px;cursor:pointer;';
          button.addEventListener('click', () => {
            const next = dialogue.chooseOption(index);
            if (next) showDialogueNode(next);
            else dialoguePanel.style.display = 'none';
          });
          dialogueChoices.append(button);
        });
      };

      // Tide and Cinder: quest tracker, attack + party-swap touch buttons.
      // Tagged for cleanup: StrictMode/HMR remounts must not stack buttons.
      container.querySelectorAll('[data-tide-ui]').forEach((node) => node.remove());
      const questBar = document.createElement('div');
      questBar.setAttribute('data-tide-ui', '1');
      questBar.style.cssText =
        'position:absolute;left:12px;top:12px;padding:8px 12px;border-radius:8px;background:rgba(9,9,12,0.85);' +
        'border:1px solid #6d28d9;color:#ede9fe;font-size:12px;font-family:system-ui,sans-serif;display:none;' +
        'z-index:60;max-width:280px;';
      if (isTide) container.append(questBar);
      let lastQuestStage = -1;
      let lastQuestKills = -1;
      let lastQuestReactions = -1;

      const tideButton = (label: string, right: string, onTap: () => void): void => {
        const button = document.createElement('button');
        button.setAttribute('data-tide-ui', '1');
        button.textContent = label;
        button.style.cssText =
          `position:absolute;right:${right};bottom:24px;width:76px;height:76px;border-radius:50%;` +
          'border:2px solid #6d28d9;background:rgba(76,29,149,0.9);color:#fff;font-size:13px;' +
          'cursor:pointer;z-index:60;font-family:system-ui,sans-serif;';
        button.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          onTap();
        });
        container.append(button);
      };

      let lastSwingAt = 0;
      const trySwing = (): void => {
        if (!isTide || !runtime || !player) return;
        if (!runtime.flow.isPlaying()) return;
        const now = performance.now();
        if (now - lastSwingAt < 450) return;
        lastSwingAt = now;
        // Soft lock-on: face the nearest living enemy, then resolve the
        // ACTIVE hero's swing from their own position.
        const hero = party?.active() ?? player;
        const heroBlade = hero.getComponent(MeleeHitbox) ?? blade;
        if (!heroBlade) return;
        let nearest: GameObject | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const name of runtime.spawner.getSpawnedNames()) {
          const enemy = scene.findByName(name);
          if (!enemy) continue;
          const distance = hero.transform.position.distanceTo(enemy.transform.position);
          if (distance < best) {
            best = distance;
            nearest = enemy;
          }
        }
        if (nearest) {
          const p = hero.transform.position;
          const e = nearest.transform.position;
          hero.transform.setRotation(0, Math.atan2(-(e.x - p.x), -(e.z - p.z)), 0);
        }
        heroBlade.beginSwing();
        heroBlade.tryHit();
      };

      if (isTide) {
        tideButton('⚔', '24px', trySwing);
        tideButton('⇄', '112px', () => {
          if (party && runtime?.flow.isPlaying()) party.swapTo((party.activeIndex + 1) % party.size);
        });
      }
      (window as unknown as Record<string, unknown>).__GAME_DEBUG__ = {
        phase: () => runtime!.flow.getPhase(),
        score: () => runtime!.session.getScore(),
        kills: () => runtime!.session.getKills(),
        wave: () => runtime!.spawner.getWave(),
        aliveEnemies: () => runtime!.spawner.getAliveCount(),
        weapon: () =>
          weapon
            ? { ammo: weapon.currentAmmo, reloading: weapon.isReloading, damage: weapon.damage, canFire: weapon.canFire() }
            : null,
        player: () => {
          if (!player) return null;
          const p = player.transform.position;
          const r = player.transform.rotation;
          const hero = party?.active() ?? player;
          const heroHealth = hero.getComponent(HealthComponent) ?? null;
          return {
            x: p.x, y: p.y, z: p.z, pitch: r.x, yaw: r.y,
            hp: heroHealth ? Math.ceil(heroHealth.health) : null,
            active: hero.name
          };
        },
        settlement: () => settlement?.snapshot() ?? null,
        enemies: () =>
          runtime!.spawner.getSpawnedNames().map((name) => {
            const e = scene.findByName(name);
            return e ? { name, x: e.transform.position.x, y: e.transform.position.y, z: e.transform.position.z } : { name, dead: true };
          }),
        /** Elemental reactions produced so far (dungeon slice). */
        reactions: () => runtime!.getReactionCount(),
        /** Active dialogue node id (dungeon slice). */
        dialogueNode: () => (dialogue?.getCurrentNode()?.id ?? null),
        /** Tide and Cinder: quest stage, melee tallies, party state. */
        quest: () =>
          quest
            ? { stage: quest.currentStage()?.id ?? null, stageIndex: quest.stageIndex, complete: quest.complete }
            : null,
        melee: () => (isTide ? { kills: meleeKills, reactions: meleeReactions } : null),
        party: () =>
          party
            ? { active: party.active()?.name ?? null, activeIndex: party.activeIndex, swaps: party.swapsTaken }
            : null,
        swing: () => {
          trySwing();
          return isTide ? { kills: meleeKills, reactions: meleeReactions } : null;
        },
        swap: () => {
          if (party) party.swapTo((party.activeIndex + 1) % party.size);
          return party?.active()?.name ?? null;
        },
        /** Driving telemetry (vehicle input + solver state). */
        vehicle: () =>
          vehicle
            ? {
                throttle: vehicle.throttle,
                steering: vehicle.steering,
                brake: vehicle.brake,
                grounded: vehicle.wheelStates.some((wheel) => wheel.grounded),
                wheelCount: vehicle.wheelStates.length
              }
            : null,
        /** Physics-body position (independent of the transform sync). */
        bodyPosition: () => {
          const body = playerBody?.rapierBody;
          if (!body) return null;
          const t = body.translation();
          return { x: Number(t.x.toFixed(2)), y: Number(t.y.toFixed(2)), z: Number(t.z.toFixed(2)) };
        },
        /** Raw handles for deep diagnostics (tests/agents). */
        _raw: () => ({ scene, player, weapon, flow: runtime!.flow, runtime: runtime! }),
        /** Fire one shot and return the raw HitResult (raycast diagnostics). */
        fire: () => (weapon ? weapon.fire() : null),
        /** Render-scene child transforms (raycast target diagnostics). */
        sceneProbe: () =>
          (scene.threeScene?.children ?? []).map((child) => ({
            name: child.userData?.gameObject?.name ?? child.name ?? child.type,
            type: child.type,
            position: child.position.toArray().map((v) => Number(v.toFixed(3))),
            visible: child.visible
          })),
        /** Scene graph size + mesh names in the render scene (raycast target list). */
        renderScene: () => ({
          objects: scene.gameObjects.length,
          threeChildren: scene.threeScene?.children.length ?? 0,
          named: (scene.threeScene?.children ?? []).map((child) => child.userData?.gameObject?.name ?? child.name ?? child.type)
        })
      };

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      container.prepend(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 300);
      const cameraTarget = new THREE.Vector3();
      if (isCity) {
        // Fixed high overview of the build grid; the player founds the town by clicking plots.
        camera.position.set(0, 26, 30);
        cameraTarget.set(0, 0, 0);
        camera.lookAt(cameraTarget);
        const groundMesh =
          scene.findByName('Settlement Ground')?.getComponent(MeshRenderer)?.threeMesh ?? null;
        const raycaster = new THREE.Raycaster();
        renderer!.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
          const phase = runtime!.flow.getPhase();
          if (!settlement || phase !== 'playing' || !groundMesh) {
            showCityMessage(`tap ignored (phase=${phase}, ground=${groundMesh ? 'ok' : 'missing'})`);
            cityBridge?.log?.('CityTap', JSON.stringify({ phase, ground: !!groundMesh }));
            return;
          }
          const rect = renderer!.domElement.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
          );
          raycaster.setFromCamera(ndc, camera);
          const hits = raycaster.intersectObject(groundMesh, false);
          cityBridge?.log?.(
            'CityTap',
            JSON.stringify({ ndc: [Number(ndc.x.toFixed(2)), Number(ndc.y.toFixed(2))], hits: hits.length })
          );
          if (!hits.length) {
            showCityMessage('No ground under that tap — aim for the green plane.');
            return;
          }
          const point = hits[0].point;
          placeBuildingAt(Math.floor(point.x + gridSize / 2), Math.floor(point.z + gridSize / 2));
        });
      }

      context = new EngineContext();
      context.setScene(scene);

      const clock = new THREE.Clock();

      // Driving input: keyboard steering/throttle plus touch steering by screen half.
      const keys = new Set<string>();
      let touchSteer: number | null = null;
      const onGameKeyDown = (event: KeyboardEvent) => keys.add(event.key.toLowerCase());
      const onGameKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
      const onPointer = (event: PointerEvent) => {
        if (kind !== 'driving') return;
        const half = container.clientWidth / 2;
        touchSteer = Math.max(-1, Math.min(1, (event.clientX - container.getBoundingClientRect().left - half) / (half * 0.6)));
      };
      const onPointerUp = () => { touchSteer = null; };
      window.addEventListener('keydown', onGameKeyDown);
      window.addEventListener('keyup', onGameKeyUp);
      container.addEventListener('pointerdown', onPointer);
      container.addEventListener('pointermove', onPointer);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointerleave', onPointerUp);

      const updateDrivingInput = () => {
        if (!vehicle) return;
        const throttleKey = keys.has('w') || keys.has('arrowup');
        const brakeKey = keys.has('s') || keys.has('arrowdown');
        let steer = 0;
        if (keys.has('a') || keys.has('arrowleft')) steer += 1;
        if (keys.has('d') || keys.has('arrowright')) steer -= 1;
        if (steer === 0 && touchSteer !== null && Math.abs(touchSteer) > 0.15) steer = -touchSteer;
        vehicle.steering = steer;
        vehicle.brake = brakeKey ? 1 : 0;
        // Auto-cruise keeps the slice playable on touch-only devices; releasing
        // the throttle keys simply coasts at a moderate speed.
        vehicle.throttle = brakeKey ? 0 : throttleKey ? 1 : 0.6;
      };

      const aimAndFire = () => {
        if (!weapon || !runtime || !player) return;
        let nearest: GameObject | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const name of runtime.spawner.getSpawnedNames()) {
          const enemy = scene.findByName(name);
          if (!enemy) continue;
          const distance = player.transform.position.distanceTo(enemy.transform.position);
          if (distance < best) {
            best = distance;
            nearest = enemy;
          }
        }
        if (!nearest) return;
        const p = player.transform.position;
        const e = nearest.transform.position;
        const dx = e.x - p.x;
        const dy = e.y - (p.y + 0.8);
        const dz = e.z - p.z;
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        player.transform.setRotation(pitch, yaw, 0);
        weapon.fire();
      };

      // On-device telemetry: mirror key state into logcat through the native bridge
      // (the packaged WebView has no devtools, so this is the only live view).
      const nativeBridge = (window as unknown as { AndroidBridge?: { log?: (tag: string, message: string) => void } })
        .AndroidBridge;
      let lastTelemetryAt = 0;

      renderer.setAnimationLoop(() => {
        if (disposed || !renderer || !context || !runtime || !shell) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        if (runtime.flow.isPlaying()) {
          if (kind === 'driving') {
            updateDrivingInput();
          } else if (!isCity && !isTide) {
            aimAndFire();
          }
          if (isTide) {
            // Active-hero aggro: living enemies chase whoever leads the party
            // (Genshin targeting); the benched hero catches a breath.
            party?.update(dt);
            const hero = party?.active() ?? player;
            for (const name of runtime.spawner.getSpawnedNames()) {
              const enemy = scene.findByName(name);
              const brain = enemy?.getComponent(EnemyAI) ?? null;
              // retarget() rebuilds the baked behavior tree; assigning
              // targetName alone never redirects aggro.
              if (brain && hero && brain.targetName !== hero.name) brain.retarget(hero.name);
            }
            const other = party && hero && squire
              ? (hero === player ? squire : player)
              : null;
            if (other && hero) {
              const target = hero.transform.position;
              const pos = other.transform.position;
              const dx = target.x - pos.x;
              const dz = target.z - pos.z;
              const dist = Math.hypot(dx, dz);
              if (dist > 3) {
                const step = Math.min(dist - 2, 6 * dt);
                pos.x += (dx / dist) * step;
                pos.z += (dz / dist) * step;
              }
            }
            if (quest && dialogue) {
              for (const id of dialogue.getHistory()) questFlags.add(id);
              quest.update({
                flags: [...questFlags],
                kills: meleeKills,
                reactions: meleeReactions,
                phase: runtime.flow.getPhase()
              });
              if (
                quest.stageIndex !== lastQuestStage ||
                meleeKills !== lastQuestKills ||
                meleeReactions !== lastQuestReactions
              ) {
                lastQuestStage = quest.stageIndex;
                lastQuestKills = meleeKills;
                lastQuestReactions = meleeReactions;
                const squireHealth = squire?.getComponent(HealthComponent) ?? null;
                const heroHealth = player?.getComponent(HealthComponent) ?? null;
                const hpLine =
                  heroHealth && squireHealth
                    ? ` · ❤ ${Math.ceil(heroHealth.health)}/${heroHealth.maxHealth} | Squire ${Math.ceil(squireHealth.health)}/${squireHealth.maxHealth}`
                    : squireHealth
                      ? ` · Squire ${Math.ceil(squireHealth.health)}/${squireHealth.maxHealth}`
                      : '';
                const stage = quest.currentStage();
                questBar.style.display = 'block';
                questBar.textContent =
                  (quest.complete
                    ? `✔ ${quest.id} complete`
                    : `Quest: ${stage?.id ?? '—'} (${quest.stageIndex + 1}/${quest.stages.length})`) +
                  ` · Foes ${meleeKills} · Reactions ${meleeReactions}${hpLine}`;
              }
            }
          }
          context.step(dt);
        }
        runtime.update(dt);
        if (isCity && settlement) {
          const snapshot = settlement.snapshot();
          runtime.session.syncScore(snapshot.population);
          cityStats.textContent =
            `Pop ${snapshot.population}/${settlement.getTargetPopulation()}\n` +
            `Gold ${Math.floor(snapshot.gold)} · Food ${Math.floor(snapshot.food)}`;
        }
        shell.update(dt);

        if (nativeBridge?.log && kind === 'driving') {
          const now = performance.now();
          if (now - lastTelemetryAt > 2000) {
            lastTelemetryAt = now;
            const body = playerBody?.rapierBody;
            const t = body?.translation();
            nativeBridge.log(
              'DriveTelemetry',
              JSON.stringify({
                phase: runtime.flow.getPhase(),
                distance: Number(runtime.getTraveledDistance().toFixed(2)),
                throttle: vehicle?.throttle ?? null,
                steering: vehicle?.steering ?? null,
                wheels: vehicle?.wheelStates.length ?? 0,
                grounded: vehicle?.wheelStates.filter((wheel) => wheel.grounded).length ?? 0,
                body: t ? { x: Number(t.x.toFixed(2)), z: Number(t.z.toFixed(2)) } : null
              })
            );
          }
        }

        if (isCity) {
          camera.position.lerp(new THREE.Vector3(0, 26, 30), 0.08);
          cameraTarget.lerp(new THREE.Vector3(0, 0, 0), 0.1);
        } else if (player) {
          // Tide camera trails the active party hero.
          const focus = isTide ? (party?.active() ?? player) : player;
          const p = focus.transform.position;
          if (kind === 'driving') {
            camera.position.lerp(new THREE.Vector3(p.x, p.y + 4.5, p.z + 9), 0.18);
            cameraTarget.lerp(new THREE.Vector3(p.x, p.y + 0.8, p.z - 4), 0.25);
          } else {
            camera.position.lerp(new THREE.Vector3(p.x, p.y + 7, p.z + 11), 0.12);
            cameraTarget.lerp(new THREE.Vector3(p.x, p.y + 1, p.z), 0.2);
          }
        }
        camera.lookAt(cameraTarget);
        renderer.render(scene.threeScene, camera);
      });

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          if (runtime!.flow.isPlaying()) runtime!.flow.transition('pause');
          else if (runtime!.flow.getPhase() === 'paused') runtime!.flow.transition('resume');
          return;
        }
        // Tide and Cinder: Space swings the active hero blade.
        if (isTide && (event.key === ' ' || event.code === 'Space')) {
          event.preventDefault();
          trySwing();
        }
      };
      window.addEventListener('keydown', onKeyDown);

      const onResize = () => {
        if (!renderer) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onGameKeyDown);
        window.removeEventListener('keyup', onGameKeyUp);
        container.removeEventListener('pointerdown', onPointer);
        container.removeEventListener('pointermove', onPointer);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointerleave', onPointerUp);
      };
    };

    const teardown = () => {
      renderer?.setAnimationLoop(null);
      runtime?.stop();
      shell?.destroy();
      renderer?.dispose();
      if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
      renderer = null;
      runtime = null;
      shell = null;
      context = null;
    };

    const bootPromise = boot();
    return () => {
      disposed = true;
      // If the async boot is still in flight, tear its resources down when it lands.
      void bootPromise.then(() => teardown()).catch(() => teardown());
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="fixed inset-0 bg-black overflow-hidden" data-game-view="true" />;
};

export default GameView;
