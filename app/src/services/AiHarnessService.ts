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
}

export class AiHarnessService {
  private static instance: AiHarnessService | null = null;

  public static getInstance(): AiHarnessService {
    if (!AiHarnessService.instance) {
      AiHarnessService.instance = new AiHarnessService();
    }
    return AiHarnessService.instance;
  }

  public async generateWorld(prompt: string, scene: Scene): Promise<AiGenerationResult> {
    const systemPrompt = `You are the AI World & Logic Copilot for Heretek 3D Android Studio.
The developer wants you to build or modify a 3D scene targeting modern Android mobile hardware (Three.js PBR + Rapier3D WASM physics).

Given the user prompt, you MUST return a valid JSON object with:
1. "summary": A brief description of what you generated.
2. "actions": An array of scene operations:
   - {"type": "spawn", "name": "...", "shape": "box"|"sphere"|"cylinder"|"capsule"|"plane", "size": [x,y,z], "position": [x,y,z], "color": "#hex", "physics": "dynamic"|"fixed"|"none", "mass": 1.0}
   - {"type": "light", "lightType": "directional"|"point"|"ambient", "color": "#hex", "intensity": number, "position": [x,y,z]}
   - {"type": "event", "target": "...", "event_name": "...", "condition": "EveryFrame"|"OnStart"|"OnButtonPress"|"Timer", "action": "RotateY"|"ApplyImpulse"|"Translate"|"SetColor", "params": {...}}
   - {"type": "modify", "target": "...", "position": [x,y,z], "color": "#hex"}

Respond ONLY with the JSON object wrapped in \`\`\`json ... \`\`\` or raw JSON.`;

    const requestPayload = {
      model: typeof __LLM_MODEL__ !== 'undefined' ? __LLM_MODEL__ : 'mimotp/mimo-v2.6-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1500
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
      let content = message.content || '';

      // Parse JSON from codeblocks or raw string
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
      const jsonStr = jsonMatch[1].trim();
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Fallback: If model only responded in text or reasoning
        parsed = {
          summary: content || reasoning.slice(0, 100) || 'Scene generation executed.',
          actions: []
        };
      }

      const actionsApplied: string[] = [];
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

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
        } else if (act.type === 'event') {
          const targetGo = scene.findByName(act.target);
          if (targetGo) {
            let es = targetGo.getComponent(EventSheet);
            if (!es) {
              es = targetGo.addComponent(new EventSheet());
            }
            es.addEvent({
              id: 'ev_' + Math.random().toString(36).substring(2, 7),
              name: act.event_name || 'AI Generated Event',
              enabled: true,
              conditions: [{ type: act.condition || 'EveryFrame' }],
              actions: [{ type: act.action || 'RotateY', params: act.params || { speed: 1.5 } }]
            });
            actionsApplied.push(`Attached visual event (${act.condition} -> ${act.action}) to ${targetGo.name}`);
          }
        }
      }

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
