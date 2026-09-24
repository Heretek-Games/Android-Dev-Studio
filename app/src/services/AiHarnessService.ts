import {
  Scene,
  GameObject,
  MeshRenderer,
  LightComponent,
  CameraComponent,
  RigidBody3D,
  Collider3D,
  EventSheet,
  MobileController
} from '@heretek/engine';

export interface AiGenerationResult {
  summary: string;
  reasoning?: string;
  actionsApplied: string[];
  rawResponse?: string;
  isSelfHealed?: boolean;
}

export interface StreamProgressCallback {
  (progress: {
    reasoningChunk?: string;
    contentChunk?: string;
    accumulatedReasoning: string;
    accumulatedContent: string;
  }): void;
}

export class AiHarnessService {
  private static instance: AiHarnessService | null = null;

  public static getInstance(): AiHarnessService {
    if (!AiHarnessService.instance) {
      AiHarnessService.instance = new AiHarnessService();
    }
    return AiHarnessService.instance;
  }

  /**
   * Generates or mutates 3D scene elements and game logic using the live LLM endpoint.
   * Supports real-time streaming of thought reasoning tokens (mimotp/mimo-v2.6-flash).
   */
  public async generateWorld(
    prompt: string,
    scene: Scene,
    onProgress?: StreamProgressCallback
  ): Promise<AiGenerationResult> {
    const sceneOverview = scene.gameObjects.map(g => ({
      name: g.name,
      pos: [g.transform.position.x, g.transform.position.y, g.transform.position.z],
      components: g.components.map(c => c.constructor.name)
    }));

    const systemPrompt = `You are the AI World & Logic Copilot for Heretek 3D Android Studio.
The developer wants you to build or modify a 3D scene targeting modern Android mobile hardware (Three.js PBR + Rapier3D WASM physics).
Active Scene Summary: ${JSON.stringify(sceneOverview)}

Given the user prompt, you MUST return a valid JSON object with:
1. "summary": A brief description of what you generated.
2. "actions": An array of scene operations:
   - {"type": "spawn", "name": "...", "shape": "box"|"sphere"|"cylinder"|"capsule"|"plane", "size": [x,y,z], "position": [x,y,z], "color": "#hex", "physics": "dynamic"|"fixed"|"none", "mass": 1.0}
   - {"type": "light", "name": "...", "lightType": "directional"|"point"|"ambient", "color": "#hex", "intensity": number, "position": [x,y,z]}
   - {"type": "event", "target": "...", "event_name": "...", "condition": "EveryFrame"|"OnStart"|"OnButtonPress"|"Timer", "action": "RotateY"|"ApplyImpulse"|"Translate"|"SetColor", "params": {...}}
   - {"type": "modify", "target": "...", "position": [x,y,z], "color": "#hex"}
   - {"type": "delete", "target": "..."}

Respond ONLY with the JSON object wrapped in \`\`\`json ... \`\`\` or raw JSON.`;

    const requestPayload = {
      model: typeof __LLM_MODEL__ !== 'undefined' ? __LLM_MODEL__ : 'mimotp/mimo-v2.6-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1800,
      stream: false // Can fallback to streaming if response supports SSE
    };

    try {
      const response = await fetch('/api/llm/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        throw new Error(`LLM API returned HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      const message = choice?.message || {};
      const reasoning = message.reasoning_content || '';
      const content = message.content || '';

      if (onProgress) {
        onProgress({
          reasoningChunk: reasoning,
          contentChunk: content,
          accumulatedReasoning: reasoning,
          accumulatedContent: content
        });
      }

      // Parse JSON from codeblocks or raw string
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
      const jsonStr = jsonMatch[1].trim();
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = {
          summary: content.slice(0, 140) || reasoning.slice(0, 100) || 'Scene generation executed.',
          actions: []
        };
      }

      const actionsApplied = this.applyActionsToScene(parsed.actions || [], scene);

      return {
        summary: parsed.summary || 'Generated world elements successfully.',
        reasoning,
        actionsApplied,
        rawResponse: content
      };
    } catch (err: any) {
      console.warn('Live LLM fetch failed, falling back to local heuristic generator:', err.message);
      return this.fallbackHeuristic(prompt, scene, err.message);
    }
  }

  /**
   * Autonomous Self-Healing Loop:
   * Takes runtime exceptions, physics boundary bugs, or Logcat traces, sends them with
   * scene diagnostics to the reasoning LLM, and automatically applies restorative patches.
   */
  public async selfHeal(
    errorContext: { error: string; source?: string; stack?: string },
    scene: Scene,
    onProgress?: StreamProgressCallback
  ): Promise<AiGenerationResult> {
    const errorDetails = `Error in subsystem [${errorContext.source || 'Runtime'}]: ${errorContext.error}\nStack: ${errorContext.stack || 'N/A'}`;
    const activeObjects = scene.gameObjects.map(g => ({
      name: g.name,
      pos: [g.transform.position.x, g.transform.position.y, g.transform.position.z],
      components: g.components.map(c => c.constructor.name)
    }));

    const systemPrompt = `You are the Autonomous Self-Healing Engine for Heretek 3D Android Studio.
A critical runtime exception or game stability failure occurred during execution.
Examine the error stack and active scene hierarchy:
Scene State: ${JSON.stringify(activeObjects)}
Error Log:
${errorDetails}

Diagnose the root cause (e.g. collision mesh clipping, uninitialized transform, division by zero, invalid event target, memory pressure).
Provide corrective recovery actions to patch and restore game stability.
Return a valid JSON object:
{
  "summary": "Root cause diagnosis and applied resolution",
  "actions": [
    {"type": "modify", "target": "Player Hero", "position": [0, 2, 0]},
    {"type": "spawn", "name": "Recovery Ground Safezone", "shape": "plane", "size": [10, 0.2, 10], "position": [0, 0, 0], "physics": "fixed"}
  ]
}`;

    const requestPayload = {
      model: typeof __LLM_MODEL__ !== 'undefined' ? __LLM_MODEL__ : 'mimotp/mimo-v2.6-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Please diagnose and self-heal: ${errorDetails}` }
      ],
      temperature: 0.2,
      max_tokens: 1200
    };

    try {
      const response = await fetch('/api/llm/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        throw new Error(`LLM API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message || {};
      const reasoning = message.reasoning_content || '';
      const content = message.content || '';

      if (onProgress) {
        onProgress({
          reasoningChunk: reasoning,
          contentChunk: content,
          accumulatedReasoning: reasoning,
          accumulatedContent: content
        });
      }

      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
      const parsed = JSON.parse(jsonMatch[1].trim());
      const actionsApplied = this.applyActionsToScene(parsed.actions || [], scene);

      return {
        summary: `Self-Healed: ${parsed.summary || 'Corrected scene anomalies and restored stability.'}`,
        reasoning,
        actionsApplied,
        rawResponse: content,
        isSelfHealed: true
      };
    } catch {
      // Heuristic Self-Healing fallback
      return this.heuristicSelfHeal(errorContext, scene);
    }
  }

  private applyActionsToScene(actions: any[], scene: Scene): string[] {
    const actionsApplied: string[] = [];

    for (const act of actions) {
      if (act.type === 'spawn') {
        const go = new GameObject(act.name || 'AI Spawned Object');
        const pos = act.position || [0, 2, 0];
        const sz = act.size || [1.5, 1.5, 1.5];
        go.transform.setPosition(pos[0], pos[1], pos[2]);

        go.addComponent(new MeshRenderer({
          shape: act.shape || 'box',
          size: sz,
          color: act.color || '#3b82f6',
          roughness: 0.4
        }));

        if (act.physics && act.physics !== 'none') {
          go.addComponent(new RigidBody3D({
            bodyType: act.physics,
            mass: act.mass || 1.0
          }));
          go.addComponent(new Collider3D({
            shape: act.shape || 'box',
            size: sz
          }));
        }

        scene.addGameObject(go);
        actionsApplied.push(`Spawned ${go.name} (${act.shape}) at [${pos.join(', ')}]`);
      } else if (act.type === 'light') {
        const lightGo = new GameObject(act.name || 'AI Light');
        const pos = act.position || [5, 10, 5];
        lightGo.transform.setPosition(pos[0], pos[1], pos[2]);
        lightGo.addComponent(new LightComponent({
          type: act.lightType || 'directional',
          color: act.color || '#ffffff',
          intensity: act.intensity || 2.0
        }));
        scene.addGameObject(lightGo);
        actionsApplied.push(`Added ${act.lightType || 'directional'} light (intensity: ${act.intensity})`);
      } else if (act.type === 'modify') {
        const targetGo = scene.findByName(act.target);
        if (targetGo) {
          if (act.position) {
            targetGo.transform.setPosition(act.position[0], act.position[1], act.position[2]);
          }
          if (act.color) {
            const mr = targetGo.getComponent(MeshRenderer);
            if (mr) mr.setMaterial(act.color);
          }
          actionsApplied.push(`Modified properties on ${targetGo.name}`);
        }
      } else if (act.type === 'delete') {
        const targetGo = scene.findByName(act.target);
        if (targetGo) {
          targetGo.destroy();
          actionsApplied.push(`Safely removed entity ${targetGo.name}`);
        }
      } else if (act.type === 'event') {
        const targetGo = scene.findByName(act.target);
        if (targetGo) {
          let es = targetGo.getComponent(EventSheet);
          if (!es) {
            es = targetGo.addComponent(new EventSheet());
          }
          es.addEvent({
            id: 'ev_' + Math.random().toString(36).substring(2, 7),
            name: act.event_name || 'AI Restorative Event',
            enabled: true,
            conditions: [{ type: act.condition || 'EveryFrame' }],
            actions: [{ type: act.action || 'RotateY', params: act.params || { speed: 1.5 } }]
          });
          actionsApplied.push(`Attached visual event (${act.condition} -> ${act.action}) to ${targetGo.name}`);
        }
      }
    }

    return actionsApplied;
  }

  private heuristicSelfHeal(
    errorContext: { error: string; source?: string },
    scene: Scene
  ): AiGenerationResult {
    const actions: string[] = [];

    // Reset Player to safe origin if physics fell out of bounds
    const player = scene.findByName('Player Hero');
    if (player) {
      player.transform.setPosition(0, 2.0, 0);
      const rb = player.getComponent(RigidBody3D);
      if (rb && (rb as any).rapierBody) {
        try {
          (rb as any).rapierBody.setTranslation({ x: 0, y: 2.0, z: 0 }, true);
          (rb as any).rapierBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
          (rb as any).rapierBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        } catch {}
      }
      actions.push('Repositioned Player Hero to safe origin [0, 2, 0] with zero velocity.');
    }

    // Verify Ground Arena exists
    const ground = scene.findByName('Ground Arena');
    if (!ground) {
      const newGround = new GameObject('Ground Arena');
      newGround.transform.setPosition(0, -0.5, 0);
      newGround.addComponent(new MeshRenderer({ shape: 'box', size: [24, 1, 24], color: '#27272a' }));
      newGround.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
      newGround.addComponent(new Collider3D({ shape: 'box', size: [24, 1, 24] }));
      scene.addGameObject(newGround);
      actions.push('Restored missing fixed Ground Arena collider.');
    }

    return {
      summary: `Heuristic Self-Healing executed for: "${errorContext.error}"`,
      actionsApplied: actions,
      isSelfHealed: true
    };
  }

  private fallbackHeuristic(prompt: string, scene: Scene, errorMsg: string): AiGenerationResult {
    const lower = prompt.toLowerCase();
    const actions: string[] = [];

    const go = new GameObject('Procedural AI Entity');
    go.transform.setPosition(0, 3, -3);
    go.addComponent(new MeshRenderer({
      shape: lower.includes('sphere') ? 'sphere' : 'box',
      size: [1.5, 1.5, 1.5],
      color: lower.includes('gold') ? '#fbbf24' : '#8b5cf6'
    }));
    go.addComponent(new RigidBody3D({ bodyType: 'dynamic' }));
    go.addComponent(new Collider3D({ shape: lower.includes('sphere') ? 'sphere' : 'box', size: [1.5, 1.5, 1.5] }));
    scene.addGameObject(go);
    actions.push(`Heuristic Spawned: ${go.name}`);

    return {
      summary: `Generated procedural object for: "${prompt}" (API fallback: ${errorMsg})`,
      actionsApplied: actions
    };
  }
}

declare const __LLM_MODEL__: string;
