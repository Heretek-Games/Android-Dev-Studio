/**
 * @heretek/swarm-plugin — Phase 0 swarm orchestration plugin (Node B).
 *
 * Source of truth: plan Phase 0, section 0.2 (`engine-overhaul.md`).
 * Registered via `plugins` in `opencode.jsonc` (wired later by the integrator —
 * this node must NOT touch `opencode.jsonc`).
 *
 * V1 scope (this file):
 *  1. `swarm_dispatch` tool — records a DAG node in plugin storage and
 *     returns the node id. Worker session spawn is a follow-up (see STUB).
 *  2. Session `prompt` hook — appends the repo verification checklist to
 *     worker prompts (prompts tagged with worker metadata by the spawner).
 *  3. Event-stream mirror — best-effort copy of worker session transitions
 *     into storage for the orchestrator to read.
 *
 * Only dependency: `@opencode/plugin` (MIT). No MIT/Apache-incompatible
 * packages may be added here (workspace license hygiene, plan operating rules).
 */
import { Plugin } from "@opencode/plugin";

export const PLUGIN_ID = "heretek.swarm";

/** Storage prefix for DAG nodes: `swarm/dag/<slug>`. */
export const DAG_PREFIX = "swarm/dag/";

/** Storage prefix indexing worker sessions back to nodes: `swarm/by-session/<sessionID>`. */
export const SESSION_INDEX_PREFIX = "swarm/by-session/";

/** Node lifecycle states (plan section 0.2: pending -> working -> in-review -> merged/failed). */
export type DagStatus = "pending" | "working" | "in-review" | "merged" | "failed";

/** Input accepted by the `swarm_dispatch` tool. */
export interface DispatchInput {
  /** One-task description, e.g. "port engine/src/combat/health.ts checks to native". */
  task: string;
  /** Deterministic worktree path, e.g. `../worktrees/combat-health`. */
  worktree: string;
  /** Worker role that must pick this up: builder | critic | tester | researcher. */
  agent: string;
  /** Binary acceptance criteria the critic/tester verify before merge. */
  acceptance: string[];
}

/** A DAG node record as stored under `swarm/dag/<slug>`. */
export interface DagNode extends DispatchInput {
  id: string;
  status: DagStatus;
  /** Spawning session (orchestrator) that recorded the node. */
  recordedBy?: string;
  /** Worker session id, filled in by the spawner follow-up. */
  sessionID?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repo verification checklist appended to every worker prompt.
 * Baselines from the plan Phase 0 gate (section 0.5).
 */
export const VERIFICATION_CHECKLIST = [
  "## Swarm worker verification checklist (appended by heretek.swarm)",
  "Every merge requires green gates on fresh runs plus evidenced acceptance criteria:",
  "- `npm test` — engine suite green (513 tests / 108 suites baseline).",
  "- Python agent suites — 65 agent tests + 49 validation/build tests green.",
  "- `python3 -m unittest discover -s harness/loop -p \"test_*.py\"` — 249 loop tests green.",
  "- Native host checks (`templates/vulkan-container/app/src/main/cpp`, g++ host binary) green.",
  "- Task acceptance criteria evidenced with logs, screenshots, or checksums — never claims.",
  "- Touch only files inside your assigned worktree and declared file scope;",
  "  shared touchpoints (barrel exports, CMakeLists, scene schemas, AGENTS.md) belong to the integrator.",
].join("\n");

/** Metadata flag the worker spawner sets so the prompt hook can recognise worker prompts. */
const WORKER_METADATA_KEY = "swarm";

/** Derive a stable storage slug from a task description. */
export function slugify(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "task";
}

/** Runtime-validate unknown tool input into a DispatchInput; throws on any violation. */
function parseDispatchInput(raw: unknown): DispatchInput {
  if (typeof raw !== "object" || raw === null) throw new Error("swarm_dispatch: input must be an object");
  const input = raw as Record<string, unknown>;
  const { task, worktree, agent, acceptance } = input;
  if (typeof task !== "string" || task.trim() === "")
    throw new Error("swarm_dispatch: `task` must be a non-empty string");
  if (typeof worktree !== "string" || worktree.trim() === "")
    throw new Error("swarm_dispatch: `worktree` must be a non-empty string");
  if (typeof agent !== "string" || agent.trim() === "")
    throw new Error("swarm_dispatch: `agent` must be a non-empty string");
  if (!Array.isArray(acceptance) || acceptance.some((criterion) => typeof criterion !== "string"))
    throw new Error("swarm_dispatch: `acceptance` must be an array of strings");
  return { task, worktree, agent, acceptance };
}

/** True when prompt metadata marks this as a swarm worker prompt (set by the spawner follow-up). */
function isWorkerPrompt(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  const marker = metadata[WORKER_METADATA_KEY];
  if (typeof marker !== "object" || marker === null) return false;
  return (marker as Record<string, unknown>)["worker"] === true;
}

type StorageValue = Parameters<Plugin.Context["storage"]["set"]>[1];

/** Session lifecycle events we mirror into storage (best-effort). */
const MIRRORED_EVENTS: Record<string, DagStatus> = {
  "session.execution.started": "working",
  "session.execution.succeeded": "working",
  "session.execution.failed": "failed",
  "session.execution.interrupted": "failed",
  "session.deleted": "failed",
};

/**
 * Best-effort mirror of one stream event into storage.
 * Never throws: callers wrap it in try/catch as well.
 */
async function mirrorSessionTransition(ctx: Plugin.Context, event: unknown): Promise<void> {
  const envelope = event as { type?: unknown; data?: unknown };
  if (typeof envelope.type !== "string") return;
  const status = MIRRORED_EVENTS[envelope.type];
  if (!status) return;
  const data = envelope.data as { sessionID?: unknown } | null | undefined;
  const sessionID = data && typeof data.sessionID === "string" ? data.sessionID : undefined;
  if (!sessionID) return;
  const now = new Date().toISOString();
  const key = `${SESSION_INDEX_PREFIX}${sessionID}`;
  const existing = (await ctx.storage.get(key)) as Record<string, unknown> | undefined;
  const record: Record<string, unknown> = {
    ...(existing ?? {}),
    sessionID,
    status,
    lastEvent: envelope.type,
    updatedAt: now,
  };
  await ctx.storage.set(key, record as StorageValue);
  if (typeof existing?.["nodeID"] === "string") {
    const nodeKey = `${DAG_PREFIX}${existing["nodeID"]}`;
    const node = (await ctx.storage.get(nodeKey)) as Record<string, unknown> | undefined;
    if (node) {
      await ctx.storage.set(
        nodeKey,
        { ...node, status, sessionID, updatedAt: now } as StorageValue,
      );
    }
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    // 1. DAG dispatch tool. Effective tool id is `swarm_dispatch`
    //    (namespace `swarm` + name `dispatch`).
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "swarm",
        description: "Heretek swarm orchestration: DAG dispatch and node tracking.",
      });
      editor.add({
        name: "dispatch",
        description:
          "Record a swarm DAG node (task + worktree + agent + acceptance criteria) and return its node id. " +
          "Effective tool id: swarm_dispatch.",
        input: {
          type: "object",
          properties: {
            task: { type: "string" },
            worktree: { type: "string" },
            agent: { type: "string" },
            acceptance: { type: "array", items: { type: "string" } },
          },
          required: ["task", "worktree", "agent", "acceptance"],
          additionalProperties: false,
        },
        options: { namespace: "swarm", codemode: true },
        execute: async (input, context) => {
          const parsed = parseDispatchInput(input);
          const id = slugify(parsed.task);
          const now = new Date().toISOString();
          const node: DagNode = {
            ...parsed,
            id,
            status: "pending",
            recordedBy: String(context.sessionID),
            createdAt: now,
            updatedAt: now,
          };
          await ctx.storage.set(`${DAG_PREFIX}${id}`, node as unknown as StorageValue);
          // STUB (follow-up node: swarm-spawn) — v1 records the node only.
          // The spawner must: create the worktree via ctx.worktree.create,
          // spawn the worker via ctx.session.create + ctx.session.prompt with
          // metadata { swarm: { worker: true, nodeID: id } }, then update this
          // node to status `working` with the worker sessionID. No fake spawn
          // is performed here by design.
          return {
            content: `DAG node recorded: ${id} (status=pending). Worker spawn not yet wired (follow-up: swarm-spawn).`,
          };
        },
      });
    });

    // 2. Prompt hook — verification checklist on worker prompts only.
    // Worker prompts are recognised by spawner-set metadata
    // ({ swarm: { worker: true } }); see STUB above (follow-up: swarm-spawn).
    await ctx.session.hook("prompt", (event) => {
      if (!isWorkerPrompt(event.metadata)) return;
      event.prompt.text = `${event.prompt.text}\n\n${VERIFICATION_CHECKLIST}`;
    });

    // 3. Event-stream mirror (best-effort; never fails the session).
    // STUB (follow-up node: swarm-events) — v1 mirrors raw session
    // transitions keyed by session; deriving the full node state machine
    // (pending -> working -> in-review -> merged/failed, critic != builder
    // enforcement) belongs to the follow-up.
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await mirrorSessionTransition(ctx, event);
          } catch {
            // Best-effort mirror: a single bad event must not kill the loop.
          }
        }
      } catch {
        // Subscribe aborted during unload, or the stream itself failed.
        // The plugin stays loaded; the orchestrator reads storage directly.
      }
    })();

    // STUB (follow-up node: swarm-permissions) — per-worker
    // ctx.permission.rules guardrails denying edits outside the assigned
    // worktree are NOT registered here; permission scoping needs the worker
    // session ids produced by swarm-spawn, so it lands in that follow-up.
    // STUB (follow-up node: swarm-worktree) — the deterministic
    // `../worktrees/<track>-<task>` naming + collision-handling worktree
    // strategy (ctx.worktree.transform) is also deferred to a follow-up.

    return () => controller.abort();
  },
});
