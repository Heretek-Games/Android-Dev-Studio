import { GameObject } from '../core/GameObject.js';
import type { Scene } from '../core/Scene.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';

export interface ALifePosition {
  x: number;
  y: number;
  z: number;
}

export type ALifeGoal = 'patrol' | 'trade' | 'attack' | 'idle' | 'flee' | 'scavenge';

export interface ALifeAgent {
  id: string;
  name: string;
  faction: string;
  health: number;
  maxHealth: number;
  position: ALifePosition;
  goal: ALifeGoal;
  speed: number;
  inventory: Record<string, number>;
  isOnline: boolean;
  gameObjectId?: string;
  assignedWaypoint?: ALifePosition;
  hostileFactions?: string[];
}

export interface ALifeSimStats {
  totalAgents: number;
  onlineCount: number;
  offlineCount: number;
  factionCounts: Record<string, number>;
  simulationTicks: number;
}

export interface ALifeSimOptions {
  /** Distance (world units) around player where agents become full 3D GameObjects. Default: 120. */
  onlineRadius?: number;
  /** Hysteresis multiplier to avoid rapid online/offline thrashing at boundary. Default: 1.25. */
  hysteresisFactor?: number;
  /** Offline simulation tick cadence in seconds. Default: 3.0s. */
  offlineTickSeconds?: number;
}

/**
 * ALifeSimulator — S.T.A.L.K.E.R. OpenXRay inspired dual-tier artificial life simulation.
 *
 * Divides large-scale entity populations into two distinct simulation tiers:
 * 1. **Online Simulation (within `onlineRadius`):** Real-time 3D GameObjects with meshes,
 *    transforms, Rapier3D physics colliders, and full visual representations.
 * 2. **Offline Simulation (beyond `onlineRadius`):** Lightweight mathematical simulation
 *    tracking thousands of characters, factions, trade, and combat encounters across the
 *    world with near-zero CPU/GPU footprint.
 *
 * Seamlessly promotes agents to 3D GameObjects when entering the player's bubble,
 * and serializes/demotes them back to offline state when leaving.
 */
export class ALifeSimulator {
  public readonly onlineRadius: number;
  public readonly offlineRadius: number;
  public readonly offlineTickSeconds: number;

  private agents: Map<string, ALifeAgent> = new Map();
  private timeAccumulator = 0;
  private totalTicks = 0;

  constructor(options: ALifeSimOptions = {}) {
    this.onlineRadius = Math.max(10, options.onlineRadius ?? 120);
    const hysteresis = options.hysteresisFactor ?? 1.25;
    this.offlineRadius = this.onlineRadius * hysteresis;
    this.offlineTickSeconds = Math.max(0.1, options.offlineTickSeconds ?? 3.0);
  }

  public registerAgent(agentConfig: Omit<ALifeAgent, 'isOnline'>): ALifeAgent {
    const agent: ALifeAgent = {
      ...agentConfig,
      isOnline: false,
      inventory: { ...(agentConfig.inventory || {}) },
      hostileFactions: [...(agentConfig.hostileFactions || [])]
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  public unregisterAgent(id: string, scene?: Scene): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;

    if (agent.isOnline && agent.gameObjectId && scene) {
      const go = scene.findById(agent.gameObjectId);
      if (go) go.destroy();
    }

    return this.agents.delete(id);
  }

  public getAgent(id: string): ALifeAgent | undefined {
    return this.agents.get(id);
  }

  public getAllAgents(): ALifeAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Main simulation tick called from the game loop.
   * Updates offline agent behaviors and manages seamless online/offline promotion.
   */
  public update(playerPos: ALifePosition, dt: number, scene?: Scene): void {
    this.timeAccumulator += dt;

    // Run offline simulation step if tick interval elapsed
    if (this.timeAccumulator >= this.offlineTickSeconds) {
      this.stepOfflineSimulation(this.timeAccumulator);
      this.timeAccumulator = 0;
      this.totalTicks++;
    }

    // Manage online/offline bubble transitions
    this.reconcileOnlineBubble(playerPos, scene);
  }

  /** Lightweight offline simulation: moves agents, checks faction encounters, executes macro goals. */
  private stepOfflineSimulation(elapsedTime: number): void {
    const agentList = Array.from(this.agents.values());

    for (const agent of agentList) {
      if (agent.health <= 0) continue;

      // Only simulate macro behaviors for agents that are offline
      if (!agent.isOnline) {
        this.stepOfflineAgent(agent, elapsedTime);
      }
    }

    // Resolve offline faction skirmishes
    this.resolveOfflineEncounters(agentList);
  }

  private stepOfflineAgent(agent: ALifeAgent, dt: number): void {
    // If agent has a waypoint, move toward it
    if (agent.assignedWaypoint) {
      const dx = agent.assignedWaypoint.x - agent.position.x;
      const dz = agent.assignedWaypoint.z - agent.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 2.0) {
        // Reached waypoint: pick new random patrol waypoint in radius
        agent.assignedWaypoint = {
          x: agent.position.x + (Math.random() - 0.5) * 60,
          y: agent.position.y,
          z: agent.position.z + (Math.random() - 0.5) * 60
        };
      } else {
        const step = Math.min(dist, agent.speed * dt);
        agent.position.x += (dx / dist) * step;
        agent.position.z += (dz / dist) * step;
      }
    } else {
      // Default patrol initialization
      agent.assignedWaypoint = {
        x: agent.position.x + (Math.random() - 0.5) * 40,
        y: agent.position.y,
        z: agent.position.z + (Math.random() - 0.5) * 40
      };
    }
  }

  private resolveOfflineEncounters(agentList: ALifeAgent[]): void {
    // Coarse spatial interaction: check agents within 15 units of each other
    for (let i = 0; i < agentList.length; i++) {
      const a = agentList[i];
      if (a.isOnline || a.health <= 0) continue;

      for (let j = i + 1; j < agentList.length; j++) {
        const b = agentList[j];
        if (b.isOnline || b.health <= 0) continue;

        const dx = a.position.x - b.position.x;
        const dz = a.position.z - b.position.z;
        if (dx * dx + dz * dz < 225) { // 15m radius
          const isHostile = (a.hostileFactions?.includes(b.faction)) || (b.hostileFactions?.includes(a.faction));
          if (isHostile) {
            // Lightweight combat roll
            a.health = Math.max(0, a.health - 5);
            b.health = Math.max(0, b.health - 5);
          } else if (a.goal === 'trade' && b.goal === 'trade') {
            // Lightweight trade exchange
            a.inventory['gold'] = (a.inventory['gold'] || 0) + 1;
            b.inventory['gold'] = (b.inventory['gold'] || 0) + 1;
          }
        }
      }
    }
  }

  /** Promotes agents within `onlineRadius` to real GameObjects, and demotes agents outside `offlineRadius`. */
  private reconcileOnlineBubble(playerPos: ALifePosition, scene?: Scene): void {
    const onlineRadiusSq = this.onlineRadius * this.onlineRadius;
    const offlineRadiusSq = this.offlineRadius * this.offlineRadius;

    for (const agent of this.agents.values()) {
      if (agent.health <= 0) {
        if (agent.isOnline && agent.gameObjectId && scene) {
          const go = scene.findById(agent.gameObjectId);
          if (go) go.destroy();
          agent.isOnline = false;
          agent.gameObjectId = undefined;
        }
        continue;
      }

      // If online, sync position from active GameObject
      if (agent.isOnline && agent.gameObjectId && scene) {
        const go = scene.findById(agent.gameObjectId);
        if (go) {
          agent.position.x = go.transform.position.x;
          agent.position.y = go.transform.position.y;
          agent.position.z = go.transform.position.z;
        }
      }

      const dx = agent.position.x - playerPos.x;
      const dz = agent.position.z - playerPos.z;
      const distSq = dx * dx + dz * dz;

      if (!agent.isOnline && distSq <= onlineRadiusSq) {
        // Promote to Online
        agent.isOnline = true;
        if (scene) {
          const go = this.createOnlineEntity(agent);
          scene.addGameObject(go);
          agent.gameObjectId = go.id;
        }
      } else if (agent.isOnline && distSq > offlineRadiusSq) {
        // Demote to Offline
        agent.isOnline = false;
        if (scene && agent.gameObjectId) {
          const go = scene.findById(agent.gameObjectId);
          if (go) go.destroy();
          agent.gameObjectId = undefined;
        }
      }
    }
  }

  private createOnlineEntity(agent: ALifeAgent): GameObject {
    const go = new GameObject(`ALife: ${agent.name} [${agent.faction}]`);
    go.transform.setPosition(agent.position.x, agent.position.y, agent.position.z);

    // Color by faction
    const color = agent.faction === 'bandit' ? '#ef4444' : agent.faction === 'military' ? '#10b981' : '#3b82f6';

    go.addComponent(
      new MeshRenderer({
        shape: 'capsule',
        size: [0.8, 1.8, 0.8],
        color,
        roughness: 0.5
      })
    );

    go.addComponent(
      new RigidBody3D({
        bodyType: 'dynamic',
        mass: 1.0
      })
    );

    go.addComponent(
      new Collider3D({
        shape: 'capsule',
        size: [0.8, 1.8, 0.8]
      })
    );

    return go;
  }

  public getStats(): ALifeSimStats {
    let onlineCount = 0;
    let offlineCount = 0;
    const factionCounts: Record<string, number> = {};

    for (const agent of this.agents.values()) {
      if (agent.isOnline) onlineCount++;
      else offlineCount++;

      factionCounts[agent.faction] = (factionCounts[agent.faction] || 0) + 1;
    }

    return {
      totalAgents: this.agents.size,
      onlineCount,
      offlineCount,
      factionCounts,
      simulationTicks: this.totalTicks
    };
  }

  public clear(scene?: Scene): void {
    if (scene) {
      for (const agent of this.agents.values()) {
        if (agent.isOnline && agent.gameObjectId) {
          const go = scene.findById(agent.gameObjectId);
          if (go) go.destroy();
        }
      }
    }
    this.agents.clear();
    this.totalTicks = 0;
    this.timeAccumulator = 0;
  }
}
