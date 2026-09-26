# `@heretek/swarm-plugin` — swarm orchestration plugin (Phase 0, Node B)

In-repo orchestration for the Heretek Engine overhaul (plan Phase 0, §0.2).
Plugin id: `heretek.swarm`. Registered via `plugins` in `opencode.jsonc` —
**wiring `opencode.jsonc` belongs to the integrator, not this node.**

## What exists (v1, this node)

- **`swarm_dispatch` tool** (`index.ts`, namespace `swarm`, `codemode: true`).
  Input schema: `{ task: string, worktree: string, agent: string,
  acceptance: string[] }` (runtime-validated; rejects malformed input with an
  explicit error instead of throwing deep in the stack). Records the DAG node
  at `swarm/dag/<slug>` with `status: "pending"` via `ctx.storage.set` and
  returns the node id. Effective tool id is `swarm_dispatch` (namespace
  `swarm` + tool name `dispatch`).
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

## What is stubbed (with follow-up nodes)

| STUB location (`index.ts`) | Deferred work | Follow-up node |
|---|---|---|
| `execute` of `swarm_dispatch` | Worker spawn: `ctx.worktree.create` + `ctx.session.create`/`prompt` with worker metadata, node → `working` | **swarm-spawn** |
| Prompt-hook worker tagging | Spawner must set `{ swarm: { worker: true, nodeID } }` metadata, otherwise the hook is inert | **swarm-spawn** |
| Event mirror | Full node state machine (pending → working → in-review → merged/failed) + critic-≠-builder enforcement | **swarm-events** |
| Permission guardrails | Per-worker `ctx.permission.rules` denying edits outside the assigned worktree (needs worker session ids from swarm-spawn) | **swarm-permissions** |
| Worktree strategy | Deterministic `../worktrees/<track>-<task>` naming + collision handling via `ctx.worktree.transform` | **swarm-worktree** |

Nothing is faked: the tool records storage state only, and every deferred
piece is labeled `STUB` with the follow-up node named.

## Verification

```bash
# from orchestration/plugin/
npm install   # then pin the resolved @opencode/plugin version in package.json
npx tsc --noEmit
```

Type-check is run against the real `@opencode/plugin` v2 types
(`Plugin.define`, `ctx.tool.transform` + `editor.namespace/add`,
`ctx.session.hook("prompt")`, `ctx.storage`, `ctx.event.subscribe`).

## Dependencies / license

- Runtime dependency: `@opencode/plugin` only (MIT). No other packages —
  MIT/Apache-incompatible deps are banned by the workspace license hygiene rule.
- This plugin itself is MIT, like the repo default.
