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
import {
  harnessTrace,
  HarnessActionOutcome,
  HarnessApplyInfo,
  HarnessCallKind,
  HarnessOutcome,
  HarnessParseInfo,
  HarnessTraceRecord,
  HarnessTransportInfo
} from './HarnessTrace';

export interface AiGenerationResult {
  summary: string;
  reasoning?: string;
  actionsApplied: string[];
  rawResponse?: string;
  isSelfHealed?: boolean;
  /** True when the local heuristic fallback ran instead of the live LLM. */
  isFallback?: boolean;
  /** Pipeline outcome classification for the call. */
  outcome?: HarnessOutcome;
  /** Human-readable explanation of the outcome (esp. degradation causes). */
  outcomeReason?: string;
  /** Id correlating this result with its HarnessTrace record. */
  traceId?: string;
  /** Per-action apply results (applied / target-missing / invalid / error). */
  actionOutcomes?: HarnessActionOutcome[];
}

export interface StreamProgressCallback {
  (progress: {
    reasoningChunk?: string;
    contentChunk?: string;
    accumulatedReasoning: string;
    accumulatedContent: string;
  }): void;
}

interface Payload {
  summary?: string;
  actions?: any[];
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
   *
   * Every call emits a HarnessTrace record localizing any breakdown to the
   * transport, parse, or apply stage. Fallback generation is explicitly flagged
   * via `isFallback` so it can never masquerade as live-LLM success.
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
   - {"type": "event", "target": "...", "event_name": "...", "condition": "EveryFrame"|"OnStart"|"OnButtonPress"|"Timer", "condition_params": {...}, "action": "RotateY"|"ApplyImpulse"|"Translate"|"SetColor", "params": {...}}
     condition_params: Timer {"name": "timer_id", "interval": seconds}, OnButtonPress {"button": "jump"|"fire"}
     action params: RotateY {"speed": rad_per_second} OR {"degrees": step_per_fire}, Translate {"x","y","z","relativeToDelta": bool}, ApplyImpulse {"x","y","z"}, SetColor {"color": "#hex"}
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
      max_tokens: 4000,
      stream: false // Can fallback to streaming if response supports SSE
    };

    return this.runPipeline({
      kind: 'generate',
      prompt,
      scene,
      sceneOverviewSize: sceneOverview.length,
      requestPayload,
      onProgress,
      applyFallback: (reason) => this.fallbackHeuristic(prompt, scene, reason)
    });
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
      max_tokens: 2500
    };

    return this.runPipeline({
      kind: 'self-heal',
      prompt: `self-heal: ${errorDetails}`,
      scene,
      sceneOverviewSize: activeObjects.length,
      requestPayload,
      onProgress,
      applyFallback: (reason) => {
        const result = this.heuristicSelfHeal(errorContext, scene);
        result.outcomeReason = reason;
        return result;
      },
      wrapSummary: (summary) => `Self-Healed: ${summary || 'Corrected scene anomalies and restored stability.'}`
    });
  }

  /**
   * Shared instrumented pipeline: request -> transport -> parse -> apply -> outcome.
   * Emits exactly one HarnessTrace record per call, on every path.
   */
  private async runPipeline(args: {
    kind: HarnessCallKind;
    prompt: string;
    scene: Scene;
    sceneOverviewSize: number;
    requestPayload: Record<string, any>;
    onProgress?: StreamProgressCallback;
    applyFallback: (reason: string) => AiGenerationResult;
    wrapSummary?: (summary: string) => string;
  }): Promise<AiGenerationResult> {
    const { kind, prompt, scene, sceneOverviewSize, requestPayload, onProgress, applyFallback, wrapSummary } = args;
    const traceId = 'tr_' + Math.random().toString(36).substring(2, 9);
    const startedAt = new Date();
    const t0 = Date.now();

    const transport: HarnessTransportInfo = {
      httpStatus: null,
      latencyMs: null,
      reasoningChars: 0,
      contentChars: 0
    };
    const parse: HarnessParseInfo = {
      strategy: 'none',
      ok: false,
      actionCount: 0,
      actionTypeCounts: {}
    };
    const apply: HarnessApplyInfo = {
      outcomes: [],
      applied: 0,
      targetMissing: 0,
      invalid: 0,
      failed: 0
    };

    const finalize = (
      outcome: HarnessOutcome,
      outcomeReason?: string
    ): HarnessTraceRecord => {
      const record: HarnessTraceRecord = {
        id: traceId,
        kind,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        model: requestPayload.model,
        promptPreview: prompt.slice(0, 160),
        promptChars: prompt.length,
        sceneObjectCount: sceneOverviewSize,
        transport,
        parse,
        apply,
        outcome,
        outcomeReason
      };
      harnessTrace.record(record);
      return record;
    };

    try {
      // Bounded transport: an upstream hang must surface as a traceable
      // transport error, never an infinite spinner.
      const abortController = new AbortController();
      const timeoutMs = 90000;
      const abortTimer = setTimeout(() => abortController.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch('/api/llm/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          signal: abortController.signal
        });
      } finally {
        clearTimeout(abortTimer);
      }
      transport.httpStatus = response.status;
      transport.latencyMs = Date.now() - t0;

      if (!response.ok) {
        const bodyText = await response.text();
        transport.error = `HTTP ${response.status}`;
        throw new Error(`LLM API returned HTTP ${response.status}: ${bodyText}`);
      }

      const data = await response.json();
      transport.latencyMs = Date.now() - t0;
      transport.promptTokens = data.usage?.prompt_tokens;
      transport.completionTokens = data.usage?.completion_tokens;
      transport.finishReason = data.choices?.[0]?.finish_reason;

      const choice = data.choices?.[0];
      const message = choice?.message || {};
      const reasoning = message.reasoning_content || '';
      const content = message.content || '';
      transport.reasoningChars = reasoning.length;
      transport.contentChars = content.length;

      if (onProgress) {
        onProgress({
          reasoningChunk: reasoning,
          contentChunk: content,
          accumulatedReasoning: reasoning,
          accumulatedContent: content
        });
      }

      // ---- Parse stage -------------------------------------------------
      const truncated = transport.finishReason === 'length';
      parse.truncated = truncated;
      const { strategy, jsonStr } = this.extractJson(content);
      parse.strategy = strategy;
      let parsed: Payload;
      try {
        parsed = JSON.parse(jsonStr);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Parsed payload is not a JSON object');
        }
        parse.ok = true;
      } catch (parseErr: any) {
        // Salvage pass: recover complete action objects from a truncated or
        // malformed payload so partial generations still land in the scene.
        const salvaged = this.salvageJson(content);
        const salvagedActions = salvaged?.actions ?? [];
        if (salvaged && salvagedActions.length > 0) {
          parsed = salvaged;
          parsed.actions = salvagedActions;
          parse.ok = true;
          parse.strategy = 'salvaged';
          parse.error = `primary parse failed (${parseErr.message}); salvaged ${salvagedActions.length} complete actions`;
        } else {
          parse.ok = false;
          parse.error = parseErr.message;
          parse.summaryPreview = content.slice(0, 140);
          finalize('parse-degraded', `Response JSON could not be parsed (${parseErr.message}${truncated ? '; response truncated at max_tokens' : ''})`);
          return {
            summary: `⚠ Parse degraded — the model responded but the action JSON could not be parsed (${parseErr.message}${truncated ? '; response truncated at max_tokens' : ''}).`,
            reasoning,
            actionsApplied: [],
            rawResponse: content,
            isFallback: false,
            outcome: 'parse-degraded',
            outcomeReason: parseErr.message,
            traceId
          };
        }
      }

      const actions: any[] = Array.isArray(parsed.actions) ? parsed.actions : [];
      parse.actionCount = actions.length;
      for (const a of actions) {
        const t = a && typeof a === 'object' ? String(a.type ?? 'unknown') : 'malformed';
        parse.actionTypeCounts[t] = (parse.actionTypeCounts[t] || 0) + 1;
      }
      parse.summaryPreview = (parsed.summary || '').slice(0, 140);

      // ---- Apply stage -------------------------------------------------
      const applyInfo = this.applyActionsToScene(actions, scene);
      apply.outcomes = applyInfo.outcomes;
      apply.applied = applyInfo.applied;
      apply.targetMissing = applyInfo.targetMissing;
      apply.invalid = applyInfo.invalid;
      apply.failed = applyInfo.failed;

      const failureCount = applyInfo.targetMissing + applyInfo.invalid + applyInfo.failed;
      const outcome: HarnessOutcome = failureCount > 0 ? 'apply-error' : 'llm-success';
      const degradeNote =
        parse.strategy === 'salvaged'
          ? `response truncated (finish_reason=${transport.finishReason}); ${actions.length} complete actions salvaged`
          : truncated
            ? `response truncated (finish_reason=length)`
            : undefined;
      const outcomeReason =
        [
          failureCount > 0
            ? `${applyInfo.applied}/${actions.length} actions applied (${applyInfo.targetMissing} target-missing, ${applyInfo.invalid} invalid, ${applyInfo.failed} errored)`
            : null,
          degradeNote
        ]
          .filter(Boolean)
          .join('; ') || undefined;
      finalize(outcome, outcomeReason);

      const summaryBase = parsed.summary || 'Generated world elements successfully.';
      return {
        summary: wrapSummary ? wrapSummary(summaryBase) : summaryBase,
        reasoning,
        actionsApplied: applyInfo.appliedDescriptions,
        rawResponse: content,
        isFallback: false,
        outcome,
        outcomeReason,
        traceId,
        actionOutcomes: applyInfo.outcomes
      };
    } catch (err: any) {
      // ---- Transport / runtime failure: explicit heuristic fallback -----
      const errMsg =
        err?.name === 'AbortError'
          ? `timeout after 90s (upstream hang)`
          : transport.error || err?.message || String(err);
      transport.error = transport.error || errMsg;
      transport.latencyMs = transport.latencyMs ?? Date.now() - t0;
      const reason = `Live LLM call failed (${transport.error}); local heuristic fallback engaged`;
      finalize('fallback', reason);
      const fallbackResult = applyFallback(reason);
      fallbackResult.isFallback = true;
      fallbackResult.outcome = 'fallback';
      fallbackResult.outcomeReason = fallbackResult.outcomeReason || reason;
      fallbackResult.traceId = traceId;
      return fallbackResult;
    }
  }

  /**
   * Extract the JSON payload from a codefence or raw response body.
   * Tolerates truncated responses where the closing fence never arrived.
   */
  private extractJson(content: string): { strategy: 'codeblock' | 'raw'; jsonStr: string } {
    const closed = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (closed) return { strategy: 'codeblock', jsonStr: closed[1].trim() };
    const opened = content.match(/```(?:json)?\s*([\s\S]*)$/);
    if (opened) return { strategy: 'codeblock', jsonStr: opened[1].trim() };
    return { strategy: 'raw', jsonStr: content.trim() };
  }

  /**
   * Best-effort recovery from a truncated/malformed action payload:
   * extracts the summary string and every syntactically complete action
   * object via balanced-brace scanning. Returns null when nothing is usable.
   */
  private salvageJson(content: string): Payload | null {
    const summaryMatch = content.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const summary = summaryMatch ? summaryMatch[1] : undefined;

    const actionsIdx = content.indexOf('"actions"');
    const actions: any[] = [];
    if (actionsIdx !== -1) {
      const arrStart = content.indexOf('[', actionsIdx);
      if (arrStart !== -1) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        let objStart = -1;
        for (let i = arrStart + 1; i < content.length; i++) {
          const ch = content[i];
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') {
            if (depth === 0) objStart = i;
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0 && objStart !== -1) {
              try {
                const obj = JSON.parse(content.slice(objStart, i + 1));
                if (obj && typeof obj === 'object') actions.push(obj);
              } catch {
                // skip malformed inner object
              }
              objStart = -1;
            }
          } else if (ch === ']' && depth === 0) {
            break; // end of the actions array
          }
        }
      }
    }

    if (actions.length === 0 && summary === undefined) return null;
    return { summary, actions };
  }

  /**
   * Applies parsed LLM actions to the live scene with per-action isolation:
   * one malformed or failing action can no longer abort the rest of the batch
   * or masquerade as a transport failure. Every action yields a structured
   * outcome for the harness trace.
   */
  private applyActionsToScene(
    actions: any[],
    scene: Scene
  ): {
    outcomes: HarnessActionOutcome[];
    appliedDescriptions: string[];
    applied: number;
    targetMissing: number;
    invalid: number;
    failed: number;
  } {
    const outcomes: HarnessActionOutcome[] = [];
    const appliedDescriptions: string[] = [];
    let applied = 0;
    let targetMissing = 0;
    let invalid = 0;
    let failed = 0;

    actions.forEach((act, index) => {
      const push = (status: HarnessActionOutcome['status'], detail: string, target?: string) => {
        outcomes.push({ index, type: String(act?.type ?? 'malformed'), target, status, detail });
        if (status === 'applied') {
          applied++;
          appliedDescriptions.push(detail);
        } else if (status === 'target-missing') {
          targetMissing++;
        } else if (status === 'invalid') {
          invalid++;
        } else {
          failed++;
        }
      };

      try {
        if (!act || typeof act !== 'object' || !act.type) {
          push('invalid', `Action #${index} is not a valid action object`);
          return;
        }

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
          push('applied', `Spawned ${go.name} (${act.shape || 'box'}) at [${pos.join(', ')}]`, go.name);
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
          push('applied', `Added ${act.lightType || 'directional'} light (intensity: ${act.intensity ?? 2.0})`, lightGo.name);
        } else if (act.type === 'modify') {
          const targetGo = scene.findByName(act.target);
          if (!targetGo) {
            push('target-missing', `modify skipped — no scene object named "${act.target}"`, act.target);
            return;
          }
          if (act.position) {
            targetGo.transform.setPosition(act.position[0], act.position[1], act.position[2]);
          }
          if (act.color) {
            const mr = targetGo.getComponent(MeshRenderer);
            if (mr) mr.setMaterial(act.color);
          }
          push('applied', `Modified properties on ${targetGo.name}`, targetGo.name);
        } else if (act.type === 'delete') {
          const targetGo = scene.findByName(act.target);
          if (!targetGo) {
            push('target-missing', `delete skipped — no scene object named "${act.target}"`, act.target);
            return;
          }
          targetGo.destroy();
          push('applied', `Safely removed entity ${targetGo.name}`, targetGo.name);
        } else if (act.type === 'event') {
          const targetGo = scene.findByName(act.target);
          if (!targetGo) {
            push('target-missing', `event skipped — no scene object named "${act.target}"`, act.target);
            return;
          }
          let es = targetGo.getComponent(EventSheet);
          if (!es) {
            es = targetGo.addComponent(new EventSheet());
          }
          es.addEvent({
            id: 'ev_' + Math.random().toString(36).substring(2, 7),
            name: act.event_name || 'AI Restorative Event',
            enabled: true,
            conditions: [{ type: act.condition || 'EveryFrame', params: act.condition_params }],
            actions: [{ type: act.action || 'RotateY', params: act.params || { speed: 1.5 } }]
          });
          push('applied', `Attached visual event (${act.condition || 'EveryFrame'} -> ${act.action || 'RotateY'}) to ${targetGo.name}`, targetGo.name);
        } else {
          push('invalid', `Unknown action type "${act.type}"`, act.target);
        }
      } catch (applyErr: any) {
        push('error', `Action #${index} (${act?.type}) threw: ${applyErr?.message || applyErr}`, act?.target);
      }
    });

    return { outcomes, appliedDescriptions, applied, targetMissing, invalid, failed };
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
      isSelfHealed: true,
      isFallback: true
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
      summary: `⚠ Fallback generator — live LLM was unreachable (${errorMsg}). Spawned a single placeholder entity instead of the requested scene.`,
      actionsApplied: actions,
      isFallback: true
    };
  }
}

declare const __LLM_MODEL__: string;
