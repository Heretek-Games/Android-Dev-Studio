/**
 * sceneGraphCanonical — canonical static scene-graph form shared by the
 * Phase 1 parity invariant (HarnessSceneAdapter ≡ qa_scenario_runner).
 *
 * Canonical form: [{ name, components: [sorted constructor names] }],
 * sorted by object name. It captures the STATIC build output only —
 * object identity and attached component types — never runtime state
 * (transforms, health, quest stages, spawned waves).
 *
 * Structural typing (no engine import) keeps this usable from plain Node
 * dump scripts as well as studio docks.
 */

export interface CanonicalGraphNode {
  name: string;
  components: string[];
}

interface GraphLike {
  gameObjects: Array<{
    name: string;
    components: Array<{ constructor: { name: string } }>;
  }>;
}

/** Canonical static graph of a built engine scene. */
export function canonicalSceneGraph(scene: GraphLike): CanonicalGraphNode[] {
  return scene.gameObjects
    .map((go) => ({
      name: go.name,
      components: go.components.map((c) => c.constructor.name).sort(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
