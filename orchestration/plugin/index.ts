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

/** Storage prefix for DAG nodes: `swarm/dag/<slug>-<seq>` (see `allocateNodeId`). */
export const DAG_PREFIX = "swarm/dag/";

/** Storage prefix indexing worker sessions back to nodes: `swarm/by-session/<sessionID>`. */
export const SESSION_INDEX_PREFIX = "swarm/by-session/";

/**
 * Storage key for the persisted DAG sequence counter.
 * The counter lives in plugin storage (not memory) so orchestrator restarts
 * cannot reuse an id suffix. See `allocateNodeId`.
 */
export const SEQ_KEY = "swarm/seq";

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

/** A DAG node record as stored under `swarm/dag/<slug>-<seq>` (see `allocateNodeId`). */
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

/** Minimal storage surface needed for id allocation (satisfied by `Plugin.Context["storage"]`). */
export interface IdStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: StorageValue): Promise<void>;
}

function toSeqNumber(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function formatSeqSuffix(seq: number): string {
  return seq.toString(36).padStart(4, "0");
}

/**
 * Allocate a unique DAG node id: `<slug>-<base36-seq>`.
 * The sequence counter is read/incremented/persisted at `SEQ_KEY`, so ids
 * stay unique across orchestrator restarts (unlike a pure in-memory counter
 * or a bare `slugify(task)`, which collides when two tasks share a slug).
 * On key collision (stale counter, concurrent dispatch) the counter advances
 * until a free key is found; after 100 collisions a timestamp suffix is
 * appended as a fallback. Single-orchestrator use is assumed; concurrent
 * writers get best-effort uniqueness via the existence check, not a lock.
 */
export async function allocateNodeId(storage: IdStorage, task: string): Promise<string> {
  const slug = slugify(task);
  let seq = toSeqNumber(await storage.get(SEQ_KEY));
  for (let attempt = 0; attempt < 100; attempt++) {
    seq += 1;
    const candidate = `${slug}-${formatSeqSuffix(seq)}`;
    const existing = await storage.get(`${DAG_PREFIX}${candidate}`);
    if (existing === undefined) {
      await storage.set(SEQ_KEY, seq as unknown as StorageValue);
      return candidate;
    }
  }
  await storage.set(SEQ_KEY, seq as unknown as StorageValue);
  return `${slug}-${Date.now().toString(36)}-${formatSeqSuffix(seq)}`;
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

/**
 * Session-event → DAG-node transition table (v1 mirror semantics).
 *
 * | session event                | DAG node transition                              |
 * |------------------------------|--------------------------------------------------|
 * | `session.execution.started`   | `pending` → `working`; otherwise no change       |
 * | `session.execution.succeeded` | `pending`/`working` → `in-review`; otherwise no change (never regresses `in-review`/`merged`/`failed`) |
 * | `session.execution.failed`    | → `failed`, unless already `merged` (merge is final). ONLY this event sets `failed`. |
 * | `session.execution.interrupted`| no status change (record `lastEvent` only; never `failed`) |
 * | `session.deleted`             | terminal-cleanup only: remove `swarm/by-session/<id>`; NEVER touch the DAG node, NEVER `failed` |
 * | any other event               | ignored                                          |
 *
 * Forward-only: success advances a node (`working` → `in-review`) but never
 * demotes or resurrects a terminal state. The full state machine
 * (`in-review` → `merged`, critic-≠-builder enforcement) remains a
 * follow-up (see STUB `swarm-events` below).
 */
const KNOWN_MIRROR_EVENTS: ReadonlySet<string> = new Set([
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.deleted",
]);

function isDagStatus(value: unknown): value is DagStatus {
  return (
    value === "pending" ||
    value === "working" ||
    value === "in-review" ||
    value === "merged" ||
    value === "failed"
  );
}

/**
 * Compute the next DAG status for a session event, or `null` when the event
 * must not change the node status (`interrupted`, `deleted`, unknown events,
 * and any transition that would regress a terminal/advanced state).
 */
export function nextDagStatus(current: DagStatus, eventType: string): DagStatus | null {
  switch (eventType) {
    case "session.execution.started":
      return current === "pending" ? "working" : null;
    case "session.execution.succeeded":
      return current === "pending" || current === "working" ? "in-review" : null;
    case "session.execution.failed":
      // Only this event sets `failed`; `merged` is final and never regresses.
      return current === "merged" ? null : "failed";
    case "session.deleted":
    case "session.execution.interrupted":
      return null;
    default:
      return null;
  }
}

/**
 * Best-effort mirror of one stream event into storage.
 * Never throws: callers wrap it in try/catch as well.
 */
async function mirrorSessionTransition(ctx: Plugin.Context, event: unknown): Promise<void> {
  const envelope = event as { type?: unknown; data?: unknown };
  if (typeof envelope.type !== "string") return;
  if (!KNOWN_MIRROR_EVENTS.has(envelope.type)) return;
  const data = envelope.data as { sessionID?: unknown } | null | undefined;
  const sessionID = data && typeof data.sessionID === "string" ? data.sessionID : undefined;
  if (!sessionID) return;
  const now = new Date().toISOString();
  const key = `${SESSION_INDEX_PREFIX}${sessionID}`;
  // `session.deleted` is terminal-cleanup only: drop the session index entry
  // and never touch the linked DAG node (never `failed`).
  if (envelope.type === "session.deleted") {
    await ctx.storage.remove(key);
    return;
  }
  const existing = (await ctx.storage.get(key)) as Record<string, unknown> | undefined;
  const linkedNodeID = typeof existing?.["nodeID"] === "string" ? existing["nodeID"] : undefined;
  const linkedNode = linkedNodeID
    ? ((await ctx.storage.get(`${DAG_PREFIX}${linkedNodeID}`)) as Record<string, unknown> | undefined)
    : undefined;
  const nodeStatus = linkedNode && isDagStatus(linkedNode["status"]) ? linkedNode["status"] : undefined;
  const sessionStatus =
    existing && isDagStatus(existing["status"]) ? (existing["status"] as DagStatus) : undefined;
  const current: DagStatus = nodeStatus ?? sessionStatus ?? "pending";
  const next = nextDagStatus(current, envelope.type);
  const record: Record<string, unknown> = {
    ...(existing ?? {}),
    sessionID,
    lastEvent: envelope.type,
    updatedAt: now,
  };
  // `interrupted` records the event but preserves the prior status (never `failed`).
  if (next !== null) record["status"] = next;
  else if (sessionStatus !== undefined) record["status"] = sessionStatus;
  await ctx.storage.set(key, record as StorageValue);
  if (next !== null && linkedNodeID && linkedNode) {
    const nodeKey = `${DAG_PREFIX}${linkedNodeID}`;
    await ctx.storage.set(
      nodeKey,
      { ...linkedNode, status: next, sessionID, updatedAt: now } as StorageValue,
    );
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    // 1. DAG dispatch tool. Assumed effective tool id is `swarm_dispatch`
    //    (namespace `swarm` + name `dispatch`) — UNVERIFIED live; confirm via
    //    `ctx.tool.list()` in a live OpenCode session before relying on it
    //    (see README).
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "swarm",
        description: "Heretek swarm orchestration: DAG dispatch and node tracking.",
      });
      editor.add({
        name: "dispatch",
        description:
          "Record a swarm DAG node (task + worktree + agent + acceptance criteria) and return its node id. " +
          "Assumed effective tool id: swarm_dispatch (UNVERIFIED live).",
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
          const id = await allocateNodeId(ctx.storage, parsed.task);
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
