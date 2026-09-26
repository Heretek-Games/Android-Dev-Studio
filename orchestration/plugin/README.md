# `@heretek/swarm-plugin` — swarm orchestration plugin (Phase 0, Node B)

In-repo orchestration for the Heretek Engine overhaul (plan Phase 0, §0.2).
Plugin id: `heretek.swarm`. Registered via `plugins` in `opencode.jsonc` —
**wiring `opencode.jsonc` belongs to the integrator, not this node.**

## What exists (v1, this node)

- **`swarm_dispatch` tool** (`index.ts`, namespace `swarm`, `codemode: true`).
  Input schema: `{ task: string, worktree: string, agent: string,
  acceptance: string[] }` (runtime-validated via `parseDispatchInput`;
  malformed input throws an explicit `Error`, which the tool runtime surfaces
  as a failed tool call). Records the DAG node
  at `swarm/dag/<slug>-<seq>` with `status: "pending"` via `ctx.storage.set`
  and returns the node id. Node ids are unique: `<slugify(task)>-<base36-seq>`
  where the sequence counter is persisted at `swarm/seq`, so restarts cannot
  collide; on key collision the counter advances until a free key is found
  (timestamp-suffixed fallback after 100 collisions).
  Assumed effective tool id is `swarm_dispatch` (namespace
  `swarm` + tool name `dispatch`) — **UNVERIFIED** in a live session (no live
  OpenCode session was available in this environment; confirm via
  `ctx.tool.list()` before relying on the exact id).
- **Session `prompt` hook** — appends the repo verification checklist
  (`npm test` 513/108, agents 65, loop 249, native host checks, evidenced
  acceptance criteria, worktree/file-scope discipline) to worker prompts.
  Worker prompts are recognised by spawner-set metadata
  `{ swarm: { worker: true } }`; all other prompts pass through untouched.
- **Event-stream mirror** — subscribes via `ctx.event.subscribe` (aborted on
  unload) and mirrors `session.execution.*` / `session.deleted` transitions
  into `swarm/by-session/<sessionID>`, propagating the status back onto the
  linked DAG node when a `nodeID` is present. Best-effort throughout: every
  step is guarded so a bad event or a dead stream can never fail a session.
  Transition table (`nextDagStatus` in `index.ts`, forward-only):
  `started`: `pending` → `working`; `succeeded`: `pending`/`working` →
  `in-review` (success advances; never regresses `in-review`/`merged`/`failed`);
  `failed`: → `failed` (the ONLY event that sets `failed`; `merged` is final);
  `interrupted`: no status change (`lastEvent` only, never `failed`);
  `deleted`: terminal-cleanup only (`storage.remove` the by-session entry;
  never touches the DAG node, never `failed`).

## What is stubbed (with follow-up nodes)

| STUB location (`index.ts`) | Deferred work | Follow-up node |
|---|---|---|
| `execute` of `swarm_dispatch` | Unique id allocation (`allocateNodeId`, persisted `swarm/seq`) EXISTS; worker spawn (`ctx.worktree.create` + `ctx.session.create`/`prompt` with worker metadata, node → `working`) still stubbed | **swarm-spawn** |
| Prompt-hook worker tagging | Spawner must set `{ swarm: { worker: true, nodeID } }` metadata, otherwise the hook is inert | **swarm-spawn** |
| Event mirror | Forward-only `nextDagStatus` table + `deleted`-as-cleanup EXISTS; full node state machine (`in-review` → `merged`) + critic-≠-builder enforcement still stubbed | **swarm-events** |
| Permission guardrails | Per-worker `ctx.permission.rules` denying edits outside the assigned worktree (needs worker session ids from swarm-spawn) | **swarm-permissions** |
| Worktree strategy | Deterministic `../worktrees/<track>-<task>` naming + collision handling via `ctx.worktree.transform` | **swarm-worktree** |

Nothing is faked: the tool records storage state only, and every deferred
piece is labeled `STUB` with the follow-up node named.

## Verification

```bash
# from orchestration/plugin/
npm install
npx tsc --noEmit --strict --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext index.ts
```

Type-check is run against the real `@opencode/plugin` types, pinned to the
verified working version `2.0.18` (`Plugin.define`, `ctx.tool.transform` +
`editor.namespace/add`, `ctx.session.hook("prompt")`, `ctx.storage`
get/set/remove/scan, `ctx.event.subscribe`).

## Dependencies / license

- Runtime dependency: `@opencode/plugin` pinned to `2.0.18` (verified: typechecks
  clean). No other packages —
  MIT/Apache-incompatible deps are banned by the workspace license hygiene rule.
- This plugin itself is MIT, like the repo default.
