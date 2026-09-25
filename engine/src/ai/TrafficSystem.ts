import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { BTNode, BTStatus, BehaviorTreeComponent, SequenceNode } from './BehaviorTree.js';
import type { Scene } from '../core/Scene.js';
import type { SpatialGrid } from '../spatial/SpatialGrid.js';

/**
 * TrafficSystem — autonomous ambient traffic and pedestrian navigation for the
 * urban-sandbox genre (GTA-style ambience).
 *
 * Decision layer: every agent carries a real `BehaviorTreeComponent` whose tree
 * advances the agent's waypoint route when the current waypoint is reached.
 * Motion layer: a steering solver (seek + separation) provides dynamic obstacle
 * avoidance against neighbours, optionally queried through a `SpatialGrid` for
 * near-constant perception cost at scale.
 *
 * Agents can be pure data or bound to scene GameObjects (spawned on register).
 * Works headless: no GPU, no physics bodies required.
 */

export interface TrafficWaypoint {
  x: number;
  z: number;
}

export interface TrafficAgentConfig {
  id: string;
  name?: string;
  kind?: 'vehicle' | 'pedestrian';
  position: { x: number; y: number; z: number };
  /** Cruise speed in m/s (default: vehicle 9, pedestrian 1.6). */
  speed?: number;
  /** Collision/avoidance radius in meters (default: vehicle 1.6, pedestrian 0.5). */
  radius?: number;
  /** Ordered route; when omitted the agent idles in place. */
  waypoints?: TrafficWaypoint[];
  /** Loop back to the first waypoint after the last (default false). */
  loop?: boolean;
}

export interface TrafficAgentState {
  id: string;
  name: string;
  kind: 'vehicle' | 'pedestrian';
  position: { x: number; y: number; z: number };
  heading: number;
  speed: number;
  currentSpeed: number;
  /** Collision/avoidance radius in meters. */
  radius: number;
  waypointIndex: number;
  waypoints: TrafficWaypoint[];
  arrived: boolean;
  gameObjectId?: string;
}

export interface TrafficStats {
  total: number;
  moving: number;
  arrived: number;
  waypointsReached: number;
}

/** BT leaf: succeeds when the bound agent has reached its current waypoint. */
class WaypointReachedNode extends BTNode {
  constructor(private lookup: (actor: GameObject) => TrafficAgentState | undefined, private arriveRadius = 1.5) {
    super();
  }

  public override tick(actor: GameObject): BTStatus {
    const agent = this.lookup(actor);
    if (!agent || agent.waypoints.length === 0) return BTStatus.FAILURE;
    const wp = agent.waypoints[agent.waypointIndex];
    const dx = wp.x - agent.position.x;
    const dz = wp.z - agent.position.z;
    return dx * dx + dz * dz <= this.arriveRadius * this.arriveRadius ? BTStatus.SUCCESS : BTStatus.FAILURE;
  }
}

/** BT leaf: advances the bound agent's waypoint index (route completion bookkeeping). */
class AdvanceWaypointNode extends BTNode {
  constructor(private lookup: (actor: GameObject) => TrafficAgentState | undefined, private onAdvance?: () => void) {
    super();
  }

  public override tick(actor: GameObject): BTStatus {
    const agent = this.lookup(actor);
    if (!agent) return BTStatus.FAILURE;
    if (agent.waypointIndex < agent.waypoints.length - 1) {
      agent.waypointIndex++;
      agent.arrived = false;
    } else {
      agent.arrived = true;
    }
    this.onAdvance?.();
    return BTStatus.SUCCESS;
  }
}

export class TrafficSystem {
  private agents: Map<string, TrafficAgentState> = new Map();
  private behaviors: Map<string, BehaviorTreeComponent> = new Map();
  private configs: Map<string, TrafficAgentConfig> = new Map();
  private waypointsReached = 0;
  private arriveRadius = 1.5;
  private avoidWeight = 1.6;

  constructor(private scene?: Scene) {}

  public registerAgent(config: TrafficAgentConfig): TrafficAgentState {
    const kind = config.kind ?? 'vehicle';
    const state: TrafficAgentState = {
      id: config.id,
      name: config.name ?? config.id,
      kind,
      position: { ...config.position },
      heading: 0,
      speed: config.speed ?? (kind === 'vehicle' ? 9 : 1.6),
      currentSpeed: 0,
      radius: config.radius ?? (kind === 'vehicle' ? 1.6 : 0.5),
      waypointIndex: 0,
      waypoints: config.waypoints ? config.waypoints.map(w => ({ ...w })) : [],
      arrived: config.waypoints?.length ? false : true
    };
    this.agents.set(config.id, state);
    this.configs.set(config.id, config);

    // Real behavior tree: advance the route when the current waypoint is reached.
    const lookup = (actor: GameObject) => this.agents.get(config.id);
    const behavior = new BehaviorTreeComponent(
      new SequenceNode([
        new WaypointReachedNode(lookup, this.arriveRadius),
        new AdvanceWaypointNode(lookup, () => {
          this.waypointsReached++;
        })
      ])
    );
    this.behaviors.set(config.id, behavior);

    if (this.scene) {
      const go = new GameObject(`Traffic: ${state.name}`);
      go.transform.setPosition(state.position.x, state.position.y, state.position.z);
      const isVehicle = kind === 'vehicle';
      go.addComponent(
        new MeshRenderer({
          shape: isVehicle ? 'box' : 'capsule',
          size: isVehicle ? [1.8, 1.2, 4] : [0.5, 1.7, 0.5],
          color: isVehicle ? '#64748b' : '#a78bfa'
        })
      );
      go.addComponent(behavior);
      this.scene.addGameObject(go);
      state.gameObjectId = go.id;
    }
    return state;
  }

  public unregisterAgent(id: string): boolean {
    const state = this.agents.get(id);
    if (!state) return false;
    if (this.scene && state.gameObjectId) {
      const go = this.scene.findById(state.gameObjectId);
      if (go) go.destroy();
    }
    this.agents.delete(id);
    this.behaviors.delete(id);
    this.configs.delete(id);
    return true;
  }

  public getAgent(id: string): TrafficAgentState | undefined {
    return this.agents.get(id);
  }

  public getAllAgents(): TrafficAgentState[] {
    return [...this.agents.values()];
  }

  /**
   * Advances every agent: behavior-tree decisions (waypoint advance) followed
   * by seek + separation steering with dynamic obstacle avoidance.
   */
  public update(dt: number, spatialGrid?: SpatialGrid): TrafficStats {
    const states = [...this.agents.values()];

    for (const agent of states) {
      // --- Decision layer (real BehaviorTreeComponent tick) ---
      const behavior = this.behaviors.get(agent.id);
      if (behavior && this.scene && agent.gameObjectId) {
        const go = this.scene.findById(agent.gameObjectId);
        if (go) behavior.update(dt);
      } else {
        // Scene-less agents still evaluate their tree against a proxy GameObject
        // so route-advance logic stays identical in headless mode.
        const proxy = this.proxyFor(agent);
        behavior?.root?.tick(proxy, dt);
      }

      if (agent.waypoints.length === 0 || agent.arrived) {
        agent.currentSpeed = Math.max(0, agent.currentSpeed - 6 * dt);
        continue;
      }

      // --- Motion layer: seek current waypoint ---
      const wp = agent.waypoints[agent.waypointIndex];
      let desiredX = wp.x - agent.position.x;
      let desiredZ = wp.z - agent.position.z;
      const distance = Math.hypot(desiredX, desiredZ);
      if (distance > 1e-6) {
        desiredX /= distance;
        desiredZ /= distance;
      }

      // --- Dynamic obstacle avoidance: separation from neighbours ---
      let sepX = 0;
      let sepZ = 0;
      const avoidRadius = agent.radius * 3.5;
      const neighbours = spatialGrid
        ? spatialGrid.queryRadius(agent.position.x, agent.position.y, agent.position.z, avoidRadius).map(e => e.ref as TrafficAgentState).filter(Boolean)
        : states.filter(other => other.id !== agent.id);
      for (const other of neighbours) {
        if (!other || other.id === agent.id) continue;
        const ox = agent.position.x - other.position.x;
        const oz = agent.position.z - other.position.z;
        const dist = Math.hypot(ox, oz);
        const minGap = agent.radius + other.radius;
        if (dist > 1e-6 && dist < avoidRadius) {
          const strength = Math.max(0, (avoidRadius - dist) / avoidRadius) * (dist < minGap ? 2.0 : 1.0);
          sepX += (ox / dist) * strength;
          sepZ += (oz / dist) * strength;
        }
      }

      let vx = desiredX + sepX * this.avoidWeight;
      let vz = desiredZ + sepZ * this.avoidWeight;
      const vLen = Math.hypot(vx, vz);
      if (vLen > 1e-6) {
        vx = (vx / vLen) * agent.speed;
        vz = (vz / vLen) * agent.speed;
      }

      // Smooth acceleration toward the desired velocity
      agent.currentSpeed = Math.min(agent.speed, agent.currentSpeed + agent.speed * 2.5 * dt);
      const moveX = vx * dt;
      const moveZ = vz * dt;
      agent.position.x += moveX;
      agent.position.z += moveZ;
      if (Math.hypot(moveX, moveZ) > 1e-6) {
        agent.heading = Math.atan2(moveX, moveZ);
      }

      // --- Bind back to the scene GameObject ---
      if (this.scene && agent.gameObjectId) {
        const go = this.scene.findById(agent.gameObjectId);
        if (go) {
          go.transform.setPosition(agent.position.x, agent.position.y, agent.position.z);
          go.transform.setRotation(0, agent.heading, 0);
        }
      }

      // Update the spatial grid with the new position when provided
      spatialGrid?.update(agent.id, agent.position.x, agent.position.y, agent.position.z);
    }

    const moving = states.filter(a => !a.arrived && a.waypoints.length > 0).length;
    return {
      total: states.length,
      moving,
      arrived: states.filter(a => a.arrived).length,
      waypointsReached: this.waypointsReached
    };
  }

  private proxyPool: Map<string, GameObject> = new Map();

  /** Stable proxy GameObject so scene-less agents can tick their trees. */
  private proxyFor(agent: TrafficAgentState): GameObject {
    let proxy = this.proxyPool.get(agent.id);
    if (!proxy) {
      proxy = new GameObject(`TrafficProxy: ${agent.name}`);
      this.proxyPool.set(agent.id, proxy);
    }
    proxy.transform.setPosition(agent.position.x, agent.position.y, agent.position.z);
    return proxy;
  }

  public getStats(): TrafficStats {
    const states = [...this.agents.values()];
    return {
      total: states.length,
      moving: states.filter(a => !a.arrived && a.waypoints.length > 0).length,
      arrived: states.filter(a => a.arrived).length,
      waypointsReached: this.waypointsReached
    };
  }

  public clear(): void {
    if (this.scene) {
      for (const state of this.agents.values()) {
        if (state.gameObjectId) {
          const go = this.scene.findById(state.gameObjectId);
          if (go) go.destroy();
        }
      }
    }
    this.agents.clear();
    this.behaviors.clear();
    this.configs.clear();
    this.proxyPool.clear();
    this.waypointsReached = 0;
  }
}
