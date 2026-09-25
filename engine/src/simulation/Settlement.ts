/**
 * Settlement — headless city-builder core for the Anno-style vertical slice.
 *
 * Owns a plot grid, building placement with costs, and a fixed-step simulation
 * (1 simulated second per step, accumulator pattern) where buildings produce
 * resources, housing caps growth, and mouths consume food. Surplus food grows the
 * population toward the housing cap; shortages shrink it. Deterministic for a
 * given sequence of placements and elapsed time.
 *
 * Pure compute: no rendering, physics, or DOM dependencies (Strict Decoupling).
 */

export type BuildingType = 'house' | 'farm' | 'market';

export interface BuildingSpec {
  costGold: number;
  upkeepGoldPerStep: number;
  housing?: number;
  foodPerStep?: number;
  goldPerStep?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  house: { costGold: 50, upkeepGoldPerStep: 1, housing: 6 },
  farm: { costGold: 40, upkeepGoldPerStep: 1, foodPerStep: 4 },
  market: { costGold: 80, upkeepGoldPerStep: 2, goldPerStep: 6 }
};

export interface PlacedBuilding {
  id: number;
  type: BuildingType;
  x: number;
  z: number;
}

export interface SettlementSnapshot {
  gold: number;
  food: number;
  population: number;
  housing: number;
  buildings: PlacedBuilding[];
  simTime: number;
  steps: number;
}

export class Settlement {
  private gold: number;
  private food: number;
  private population: number;
  private readonly startingGold: number;
  private readonly startingFood: number;
  private buildings = new Map<number, PlacedBuilding>();  private occupied = new Set<string>();
  private nextId = 1;
  private simTime = 0;
  private steps = 0;
  private accumulator = 0;

  constructor(
    private readonly gridSize: number = 16,
    private readonly targetPopulation: number = 30,
    startingGold: number = 300,
    startingFood: number = 20
  ) {
    if (gridSize < 1) throw new Error('Settlement gridSize must be >= 1');
    this.startingGold = startingGold;
    this.startingFood = startingFood;
    this.gold = startingGold;
    this.food = startingFood;
    this.population = 0;
  }

  /** Restore the initial treasury/stores and clear all buildings (run restart). */
  public reset(): void {
    this.gold = this.startingGold;
    this.food = this.startingFood;
    this.population = 0;
    this.buildings.clear();
    this.occupied.clear();
    this.nextId = 1;
    this.simTime = 0;
    this.steps = 0;
    this.accumulator = 0;
  }

  public getTargetPopulation(): number {
    return this.targetPopulation;
  }

  /** Place a building; returns the building id, or null with a reason when illegal. */
  public place(type: BuildingType, x: number, z: number): { id: number | null; reason?: string } {
    const spec = BUILDINGS[type];
    if (!spec) return { id: null, reason: `unknown building type '${type}'` };
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= this.gridSize || z >= this.gridSize) {
      return { id: null, reason: `plot (${x},${z}) is outside the ${this.gridSize}x${this.gridSize} grid` };
    }
    const key = `${x},${z}`;
    if (this.occupied.has(key)) return { id: null, reason: `plot (${x},${z}) is occupied` };
    if (this.gold < spec.costGold) {
      return { id: null, reason: `insufficient gold (need ${spec.costGold}, have ${Math.floor(this.gold)})` };
    }
    this.gold -= spec.costGold;
    const id = this.nextId++;
    this.buildings.set(id, { id, type, x, z });
    this.occupied.add(key);
    return { id };
  }

  public demolish(id: number): boolean {
    const building = this.buildings.get(id);
    if (!building) return false;
    this.buildings.delete(id);
    this.occupied.delete(`${building.x},${building.z}`);
    return true;
  }

  /** Advance the simulation (fixed 1-second steps, frame-rate independent). */
  public advance(realDeltaSeconds: number): void {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return;
    this.accumulator += realDeltaSeconds;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      this.step();
    }
  }

  public hasWon(): boolean {
    return this.population >= this.targetPopulation;
  }

  public snapshot(): SettlementSnapshot {
    return {
      gold: this.gold,
      food: this.food,
      population: this.population,
      housing: this.housingCapacity(),
      buildings: [...this.buildings.values()],
      simTime: this.simTime,
      steps: this.steps
    };
  }

  private housingCapacity(): number {
    let housing = 0;
    for (const building of this.buildings.values()) {
      housing += BUILDINGS[building.type].housing ?? 0;
    }
    return housing;
  }

  private step(): void {
    let goldDelta = 0;
    let foodDelta = 0;
    for (const building of this.buildings.values()) {
      const spec = BUILDINGS[building.type];
      goldDelta -= spec.upkeepGoldPerStep;
      goldDelta += spec.goldPerStep ?? 0;
      foodDelta += spec.foodPerStep ?? 0;
    }
    this.gold += goldDelta;
    this.food += foodDelta;

    // Mouths eat before growth is evaluated.
    const consumption = this.population * 1;
    this.food -= consumption;

    const housing = this.housingCapacity();
    if (this.food > 0 && this.population < housing) {
      this.population += 1;
    } else if (this.food < 0) {
      // Starvation: lose one mouth per step and clamp the deficit so recovery
      // is possible once food production catches up.
      this.population = Math.max(0, this.population - 1);
      this.food = 0;
    }

    this.simTime += 1;
    this.steps += 1;
  }
}
