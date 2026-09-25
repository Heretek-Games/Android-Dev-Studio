"""
Prompt builders for the autonomous iterate-until-green loop.

The generation prompt teaches the model the exact action vocabulary (shared with
the studio's AI Harness) and the flat scene schema; the repair prompt hands back
the precise QA failures, the current scene, and the telemetry so the model can
apply minimal corrective actions.
"""

from typing import Any, Dict, List

# Rule type -> human-readable line used in prompts and run logs.
RULE_DESCRIPTIONS = {
    "entity_exists": lambda r: f"an object named '{r.get('target')}' must exist",
    "entity_component": lambda r: (
        f"'{r.get('target')}' must have component {r.get('component')}"
    ),
    "event_attached": lambda r: f"'{r.get('target')}' must have an EventSheet event",
    "object_count": lambda r: (
        f"the scene must contain exactly {r.get('count')} objects"
    ),
    "transform_changes": lambda r: (
        f"'{r.get('target')}' must move/rotate during the run"
    ),
    "transform_bounds": lambda r: (
        f"'{r.get('target')}' must stay within bounds {r.get('bounds')}"
    ),
    "distance_traveled": lambda r: (
        f"'{r.get('target')}' must travel at least {r.get('minDistance')} units"
    ),
    "speed_min": lambda r: (
        f"'{r.get('target')}' must reach speed >= {r.get('minSpeed')}"
    ),
    "no_nan_transforms": lambda r: "no transform may become NaN/Infinity",
    "draw_call_budget": lambda r: (
        f"draw calls must stay <= {r.get('maxDrawCalls', 100)}"
    ),
    "fps_min": lambda r: f"simulated FPS must stay >= {r.get('minFps', 30)}",
}


def format_rule(rule: Dict[str, Any]) -> str:
    formatter = RULE_DESCRIPTIONS.get(str(rule.get("type")))
    described = formatter(rule) if formatter else f"custom rule {rule}"
    return f"- [{rule.get('id', rule.get('type'))}] {described}"


def format_rules(rules: List[Dict[str, Any]]) -> str:
    if not rules:
        return "(no acceptance rules supplied)"
    return "\n".join(format_rule(rule) for rule in rules)


ACTION_SCHEMA = """Action vocabulary (a JSON array named "actions"):
  - {"type": "spawn", "name": "...", "shape": "box"|"sphere"|"cylinder"|"capsule"|"plane"|"torus",
     "size": [x,y,z], "position": [x,y,z], "color": "#rrggbb", "physics": "dynamic"|"fixed"|"none", "mass": 1.0,
     "vehicle": {"throttle": 1.0, "wheels": [{"offset": [-0.8,0,1.2]}, {"offset": [0.8,0,1.2]}, {"offset": [-0.8,0,-1.2]}, {"offset": [0.8,0,-1.2]}]} (optional: adds a VehicleController; wheels is REQUIRED when vehicle is present),
     "streamer": {"chunkSize": 16, "renderDistance": 1, "resolution": 8} (optional: adds a WorldStreamer that generates terrain chunks around the object),
     "biome": "sand rim" (optional: tags the object for the biome_coverage_min composition audit),
     "weapon": {"damage": 50, "fireRate": 8, "range": 100, "maxAmmo": 30} (optional: adds a WeaponController for combat quests),
     "health": {"maxHealth": 100} (optional: adds a HealthComponent; destroyOnDeath defaults true),
     "ai": {"targetName": "Player Hero", "moveSpeed": 2.5} (optional: adds an EnemyAI NPC routine that chases/attacks the named target),
     "elemental": {"aura": "Pyro", "maxHealth": 80} (optional: seeds an elemental aura for reaction quests; aura is one of Pyro|Hydro|Cryo|Electro|Anemo|Geo|Dendro),
     "cel": {"baseColor": "#38bdf8", "shadowColor": "#1e3a8a", "rimPower": 3.5} (optional: calibrates an AnimeCelShader look-dev pass; colors #rgb/#rrggbb, outlineThickness/rimPower non-negative numbers)}
  - {"type": "light", "name": "...", "lightType": "directional"|"point"|"ambient",
     "color": "#rrggbb", "intensity": 2.0, "position": [x,y,z]}
  - {"type": "modify", "target": "...", "position": [x,y,z], "color": "#rrggbb",
     "size": [x,y,z], "physics": "...", "mass": 1.0, "lightType": "...", "intensity": 1.0,
     "vehicle": {"throttle": 1.0, "wheels": [{"offset": [x,y,z]}, ...]} (optional: adds/replaces the VehicleController; wheels REQUIRED)}
  - {"type": "delete", "target": "..."}
  - {"type": "game", "config": {"mode": "waves", "playerName": "Player Hero",
     "totalWaves": 2, "enemiesPerWave": 2, "hitDamage": 50} (quest/combat setup: spawns a
     GameRuntime that runs wave defense or settlement-build around the named player object;
     "mode": "build" with a "settlement" block runs the settlement path instead.
     Settlement blocks take ONLY gridSize, targetPopulation, startingGold, startingFood,
     and placements (no name/description keys); placements is an array of {type, x, z}
     with type house|farm|market and integer x/z plots inside the grid, e.g.
     "settlement": {"gridSize": 8, "targetPopulation": 6, "placements": [{"type": "house", "x": 0, "z": 0}]})
  - {"type": "dialogue", "tree": {"id": "Keeper", "startNodeId": "greet", "nodes": {
     "greet": {"id": "greet", "type": "choice", "speaker": "Keeper", "text": "...",
      "choices": [{"id": "bless", "text": "...", "nextNodeId": "blessed"}]},
     "blessed": {"id": "blessed", "type": "action",
      "action": {"setVariables": {"blessed": true}}, "nextNodeId": "farewell"},
     "farewell": {"id": "farewell", "type": "end"}}}
     (quest dialogue: every nextNodeId/choice/condition ref must resolve; headless
     auto-play takes the first available choice, so put the golden path first;
     action nodes take ONLY setVariables/emitEvent/nextNodeId — the engine fires
     "action": {"emitEvent": {"eventName": "hydro_blessing"}} and silently ignores
     bare "event"/"fireEvent" keys, so a blessing that sets its flag but never fires
     always means a malformed emitEvent)}
  - {"type": "light", "name": "...", "lightType": "directional"|"point"|"ambient",
     "color": "#rrggbb", "intensity": 2.0, "position": [x,y,z]}
  - {"type": "modify", "target": "...", "position": [x,y,z], "color": "#rrggbb",
     "size": [x,y,z], "physics": "...", "mass": 1.0, "lightType": "...", "intensity": 1.0,
     "vehicle": {"throttle": 1.0, "wheels": [{"offset": [x,y,z]}, ...]} (optional: adds/replaces the VehicleController; wheels REQUIRED)}
  - {"type": "delete", "target": "..."}
  - {"type": "event", "target": "...", "event_name": "...",
     "condition": "OnStart"|"EveryFrame"|"OnTouchTap"|"OnButtonPress"|"Timer"|"TagNear",
     "condition_params": {"name": "...", "interval": 0.5},
     "action": "Translate"|"RotateY"|"ApplyImpulse"|"SetColor"|"Destroy"|"SetScale",
     "params": {"speed": 1.0} or {"degrees": 20} or {"x":0,"y":0,"z":0} or {"color": "#rrggbb"}}

How acceptance rules map onto the schema (the QA runner checks these exact components):
  - "RigidBody3D"/"Collider3D" component -> the spawn has "physics": "dynamic" (or "fixed")
  - "MobileController" component -> the spawn has "controller": true
  - "VehicleController" component -> the spawn (or a "modify") has "vehicle" with a
    REQUIRED non-empty "wheels" array, e.g. "vehicle": {"throttle": 1.0, "wheels": [{"offset": [-0.8,0,1.2]}, {"offset": [0.8,0,1.2]}]}
  - "WorldStreamer" component -> the spawn has "streamer", e.g. "streamer": {"chunkSize": 16, "renderDistance": 1, "resolution": 8} (all fields optional positive numbers)
  - biome_coverage_min rules -> tag objects with "biome": "<brief biome name>" so each brief biome has enough live objects inside its region
  - "WeaponController" component -> the spawn (or a "modify") has "weapon", e.g. "weapon": {"damage": 50, "fireRate": 8, "range": 100, "maxAmmo": 30}
  - "HealthComponent" component -> the spawn (or a "modify") has "health", e.g. "health": {"maxHealth": 100}
  - "EnemyAI" component -> the spawn (or a "modify") has "ai" naming its target, e.g. "ai": {"targetName": "Player Hero", "moveSpeed": 2.5, "attackRange": 2.2}.
    IMPORTANT: AI movers must use "physics": "none" — the behavior tree drives the transform
    directly, while dynamic bodies are physics-owned (Rapier overwrites the transform every
    step, so an "ai" + "physics": "dynamic" NPC stands still). Give the NPC "health" too if
    anything should damage it.
  - game_reactions_min rules -> BOTH sides of the reaction, or nothing fires: (1) the "game"
    config carries "hitElement" + "hitGauge", e.g. {"mode": "waves", "hitElement": "Hydro",
    "hitGauge": 1, ...}, AND (2) the enemies carry the opposing aura, either hand-placed via
    spawn "elemental": {"aura": "Pyro", "maxHealth": 80} or GameRuntime-spawned via the game
    config "enemy": {"elemental": {"aura": "Pyro", ...}}. Hydro hits on Pyro auras =
    Vaporize; without both halves the reaction count stays 0.
  - game_* rules (game_phase, game_score_min, game_kills_min, game_wave_reached, ...) ->
    ALL of these: (1) spawn the named player object (physics dynamic + controller, plus weapon/health
    for combat quests), AND (2) emit one "game" action whose config names that player, e.g.
    {"type": "game", "config": {"mode": "waves", "playerName": "Player Hero", "totalWaves": 2,
    "enemiesPerWave": 2, "hitDamage": 50}}. Without the "game" action every game_* rule fails
    with "no game config in scenario".
  - dialogue_* rules (dialogue_reaches, dialogue_sets_variable, dialogue_event_fired) ->
    emit one "dialogue" action per tree BEFORE anything can pass: the headless auto-play
    registers spec.dialogues and walks each tree, so without the action every dialogue_*
    rule fails with 'no dialogue transcript'. NOTE: action/condition nodes self-resolve and
    never appear as visits — prove blessings via dialogue_event_fired / dialogue_sets_variable,
    and reserve dialogue_reaches for stable choice/text nodes.
  - Quest-critical heroes/NPCs must survive the whole run: entity rules evaluate POST-run,
    and HealthComponent destroys its owner at 0 HP by default — so a hero chewed down by
    its own quest enemies reads as 'missing "Hero"'. Give the hero generous maxHealth
    (or weaker/slower attackers) with margin, e.g. "health": {"maxHealth": 500}.
  - "AnimeCelShader" component (look-dev calibration) -> the spawn (or a "modify") has
    "cel", e.g. "cel": {"baseColor": "#38bdf8", "shadowColor": "#1e3a8a", "rimPower": 3.5}.
    Headless QA verifies calibration presence + budget, never taste — true aesthetics
    stay critic-owned.
  - "EventSheet" / event_attached rules -> emit an "event" action targeting that object
  - "LightComponent" -> emit a "light" action
  - object_count rules count every entry in gameObjects (lights included)

Constraints enforced by the scene invariant gate (violations are rejected):
  - unique, non-empty object names; finite transforms; positive mass on dynamic bodies
  - <= 100 unbatched draw calls per scene (prefer few objects; instanced foliage is not available here)
  - dynamic bodies must not spawn intersecting fixed geometry
"""

OUTPUT_FORMAT = """Respond with a single JSON object and nothing else:
{"summary": "<one sentence>", "actions": [ ... ]}
Do not wrap it in markdown fences."""


def generation_messages(
    goal: str,
    rules: List[Dict[str, Any]],
    seed_objects: List[Dict[str, Any]] | None = None,
) -> List[Dict[str, str]]:
    """First-iteration prompt: build the whole scene from the goal + rules."""
    seed_note = ""
    if seed_objects:
        seed_note = (
            "\nA base scene already exists; keep its objects and ADD to them with spawn/event actions:\n"
            f"{seed_objects}\n"
        )
    system = (
        "You are the autonomous world builder for Heretek 3D Android Studio, a mobile game engine.\n"
        "You design complete, playable scenes and emit them as machine-applicable actions.\n\n"
        f"{ACTION_SCHEMA}\n"
        f"{OUTPUT_FORMAT}"
    )
    user = (
        f"Build a playable 3D scene for this goal:\n{goal}\n\n"
        "The scene must satisfy ALL of these acceptance rules (QA will verify each one):\n"
        f"{format_rules(rules)}\n"
        f"{seed_note}\n"
        "Entity names referenced by the rules MUST match exactly. Include a ground plane, "
        "the player/actor, and all props required by the rules. Keep the scene small enough "
        "to stay within the 100 draw-call mobile budget."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def repair_messages(
    goal: str,
    rules: List[Dict[str, Any]],
    scene: Dict[str, Any],
    failed_rules: List[Dict[str, Any]],
    metrics: Dict[str, Any],
    iteration: int,
    vision_notes: List[str] | None = None,
    rejected: List[str] | None = None,
) -> List[Dict[str, str]]:
    """Repair prompt: minimal corrective actions for the observed failures.

    `rejected` carries the previous iteration's rejected-action details
    (invalid applier outcomes, e.g. schema violations). These never reach the
    scene or QA, so without this channel the model only sees downstream
    symptoms ("no game config in scenario") and cannot fix the actual offense.
    """
    import json

    system = (
        "You are the autonomous repair engineer for Heretek 3D Android Studio.\n"
        "A generated scene failed QA. Emit ONLY the corrective actions (a patch) that fix the "
        "failing rules without breaking passing ones.\n\n"
        f"{ACTION_SCHEMA}\n"
        f"{OUTPUT_FORMAT}"
    )

    failure_lines = []
    for rule in failed_rules:
        detail = rule.get("detail") or "(no detail)"
        failure_lines.append(
            f"- [{rule.get('id')}] {format_rule(rule)} -- observed: {detail}"
        )
    failures = (
        "\n".join(failure_lines) if failure_lines else "- (no rule details captured)"
    )

    vision_note = ""
    if vision_notes:
        vision_note = "\nVisual/layout critique of the current scene:\n" + "\n".join(
            f"- {note}" for note in vision_notes
        )

    rejected_note = ""
    if rejected:
        rejected_note = (
            "\nYour last patch had REJECTED actions that were never applied "
            "(fix these first — the scene below does NOT contain them):\n"
            + "\n".join(f"- {line}" for line in rejected)
            + "\n"
        )

    user = (
        f"Goal:\n{goal}\n\n"
        f"Iteration {iteration} QA failures:\n{failures}\n\n"
        f"Telemetry: {json.dumps(metrics)}\n"
        f"{vision_note}\n"
        f"{rejected_note}"
        "Current scene (JSON):\n"
        f"{json.dumps(scene, separators=(',', ':'))}\n\n"
        "Acceptance rules (all must eventually pass):\n"
        f"{format_rules(rules)}\n\n"
        "Patch rules: do not delete entities required by the rules; do not duplicate names; "
        "use 'modify' to adjust existing objects instead of re-spawning them. "
        'Return the patch as {"summary": ..., "actions": [...]}.'
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
