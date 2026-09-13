# Backend implementation report

## Implemented runtime

The local runtime is a dependency-free Node 24 HTTP server backed by `node:sqlite`. It serves `public/`, stores task JSON transactionally, starts signed-in Codex CLI executions, and can optionally fire a Claude Routine. The Cloudflare runtime uses the same task reducer with a D1 compare-and-swap adapter and the same authenticated API/MCP surface.

Input attachment bytes are not written to SQLite or D1. Durable attachment values are allowlisted to `id`, `name`, `path`, `size`, `lastModified`, `type`, `source`, and `url` for URL references. `POST /run` accepts `{name,text}` materials transiently, validates them in memory, and passes them directly to the selected executor. Generated artifacts are durable task output.

## HTTP contract

`GET /api/health` is public and returns only `{status:"ok"}`. Every other API route and `/mcp` requires `Authorization: Bearer <access token>`. Tokens must contain at least 24 characters. CORS reflects only an exact origin configured in the allowlist; denied origins receive no allow-origin header.

`GET /api/state` returns:

```json
{
  "revision": 3,
  "tasks": [],
  "usage": [
    {
      "provider": "codex",
      "usedPercent": null,
      "resetAt": null,
      "inputTokens": 120,
      "outputTokens": 40,
      "updatedAt": "ISO-8601",
      "source": "codex_exec"
    }
  ],
  "capabilities": {
    "localCodex": true,
    "claudeRoutine": false,
    "cloud": false,
    "connected": true
  }
}
```

The local server sets `localCodex` only when `codex login status` exits successfully and explicitly says `Logged in using ChatGPT`. The Worker always sets `localCodex:false`, `cloud:true`, and reports `claudeRoutine:true` only when both Routine URL and token are configured.

`POST /api/tasks` accepts `{prompt,type,attachments}` and returns HTTP 201 `{task}`. New tasks use status `ready`, version 1, a user message containing the prompt, and a bounded default role plan. Literature, analysis, writing, presentation, career, and general plans contain no more than six roles.

`POST /api/tasks/:id/actions` accepts an `expectedVersion` and one action:

- `message {content}`
- `pause`
- `resume`
- `cancel`
- `decide {content}`
- `checkpoint {content}`
- `artifact {artifact}`
- `plan {plan}`
- `attachments {attachments}`

Every accepted action increments the task version once. A stale version returns HTTP 409. Cancelled tasks reject later writes. A user `message` can reopen a completed task while retaining its prior artifacts and checkpoint. A new message during a run supersedes that execution, returns the task to `ready`, and prevents its late output from landing. Attachment replacement rejects while a task is running and applies the same metadata-only allowlist as task creation.

`POST /api/tasks/:id/run` accepts `{provider:"codex"|"claude",materials:[{name,text}],expectedVersion}`. It validates provider availability and expected version before claiming a 15-minute execution lease. A successful claim returns HTTP 202 immediately with `{task}` while execution continues in the background. Clients observe completion, failure, or the Claude session URL through `GET /api/state`; the Claude URL is `task.checkpoint.sessionUrl`. A missing provider returns HTTP 503 `{error,task}` and durably sets `waiting_connection`. Invalid requests return 400, missing tasks 404, and conflicts 409.

Run completion requires the current execution ID and generation. Cancel, pause, a new instruction, or a newer lease makes old callbacks stale. Stale callbacks cannot append messages, artifacts, or checkpoints. Local cancel and pause also signal the Codex child process. A fired Claude cloud session has no implemented remote cancellation API; state changes still revoke its ability to write through this workspace.

## Codex subscription runner

The local runner invokes `codex` directly with an argument array and stdin; it never uses a shell or interpolates the prompt into a command string. Each generation receives a separate directory under `.inno/executor-workspace`. Invocation enables native multi-agent support and instructs simple tasks to stay single-agent, with at most two useful independent subagents running concurrently and at most six planned roles.

The effective options are `exec --json --approve-for-me --skip-git-repo-check --ephemeral --ignore-user-config --enable multi_agent`. In this Codex build, `--approve-for-me` itself selects the workspace-write sandbox and cannot be combined with an explicit `--sandbox` option. `--ephemeral` prevents prompt/source excerpts from being retained as a Codex session. Ignoring user config prevents a configured alternate/API provider from silently replacing ChatGPT subscription execution. `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and related provider identifiers are removed from the child environment; `CODEX_HOME` remains so the existing ChatGPT login is available.

When the local MCP URL is available, the runner supplies it through transient `-c mcp_servers.inno...` arguments and names `INNO_MCP_TOKEN` as the bearer-token environment variable. The token value is never put in an argument, file, task, or log.

The prompt contains the original request, up to 20 recent durable messages (bounded to 80,000 characters), the durable checkpoint, the bounded role plan, execution ownership, and the transient material excerpts. This lets resumed tasks follow revised instructions. Materials may inform the answer, but the runner is instructed not to archive or reproduce whole source originals.

Codex JSONL `agent_message`, thread ID, and turn usage events are parsed. A plain answer becomes an assistant message plus `final.md`. A structured answer can return small inline text artifacts or relative generated-file paths. File paths are resolved through `realpath`, must remain inside the isolated run directory after symlink resolution, and must name regular files. Accepted files are read up to the artifact budget and persisted as base64; absolute paths, traversal, symlink escape, missing files, and oversized files fail the execution. DOCX/PPTX ZIP headers, PDF headers, and PNG signatures receive a basic format check. This is not a full render or semantic verification.

## Claude Routine

The adapter follows the current documented Routine API trigger: it posts JSON `{text}` to the configured Anthropic `/fire` URL with the Routine bearer token, `anthropic-version: 2023-06-01`, and `anthropic-beta: experimental-cc-routine-2026-04-01`. The token remains server-side. A successful fire response proves only that a cloud session started; it stores the returned session URL and leaves the task `running` until the Routine writes durable progress or completion through MCP. See [Claude Code Routine API triggers](https://code.claude.com/docs/en/routines#add-an-api-trigger).

## MCP tools

`POST /mcp` implements stateless JSON-RPC initialization, ping, `tools/list`, and `tools/call`. It uses the same bearer authentication as the API. Available tools are:

- `list_tasks`
- `read_task`
- `claim_execution`
- `checkpoint_task`
- `artifact_task`
- `plan_task`
- `request_decision`

Execution writes require the current `executionId` and `generation`. `checkpoint_task` accepts `status:"completed"` plus a user-facing `summary` only when the current owner has actually completed the task; completion appends the assistant result and final artifact transactionally. A Routine started through `/run` is already claimed and must use the ownership values supplied in its fire payload rather than claim again.

`request_decision` is also owner-checked. It requires a prompt plus 2 to 5 unique options; each option must include a label, pros, and cons. It moves the task to `waiting_user`, publishes the structured decision card, and releases the active generation from further writes. The user's normal `decide` action records the selected text and returns the task to `ready` for a fresh generation.

## Local startup

`node server/index.mjs` creates `.inno/tasks.sqlite` and `.inno/executor-workspace`, then prints a localhost onboarding URL whose fragment is `#token=...`. The token is generated with 32 random bytes when `INNO_ACCESS_TOKEN` is absent. URL fragments do not reach the HTTP server and are not embedded in static source. The browser is expected to move it to `sessionStorage` and remove the fragment.

Environment variables:

- `INNO_HOST` (default `127.0.0.1`)
- `INNO_PORT` (default `4173`)
- `INNO_ACCESS_TOKEN` (optional locally; generated when absent)
- `INNO_CORS_ORIGINS` (comma-separated exact origins)
- `INNO_DB_PATH` (default `.inno/tasks.sqlite`)
- `INNO_PUBLIC_DIR` (default `public`)
- `INNO_EXECUTOR_WORKSPACE` (default `.inno/executor-workspace`)
- `CLAUDE_ROUTINE_URL`
- `CLAUDE_ROUTINE_TOKEN`

## Cloudflare/D1 deployment

`wrangler.jsonc` binds `DB`, configures `worker/migrations`, and serves `public/` through an assets binding. Replace `REPLACE_WITH_D1_DATABASE_ID`, apply `worker/migrations/0001_initial.sql`, and set `ACCESS_TOKEN` and `CLAUDE_ROUTINE_TOKEN` with Wrangler secrets. Set `CLAUDE_ROUTINE_URL` and `CORS_ORIGINS` as deployment configuration. No Cloudflare database, secret, or deployment was created by this implementation.

D1 task updates use `UPDATE ... WHERE version = expectedVersion` inside a D1 batch and increment the workspace revision only when that compare-and-swap changed a row. The Worker exposes Claude Routine execution and MCP. It deliberately reports local Codex unavailable.

## Enforced limits

- HTTP JSON body: 750,000 bytes measured from the actual body
- Transient materials: 20 items, 200,000 characters each, 600,000 characters total
- Durable attachment descriptors: 5,000 per task, also constrained by the HTTP body limit
- Role plan: 6 items
- Locally collected isolated-run artifacts: 10 items and 10,000,000 encoded characters/bytes total
- Inline artifact action/MCP content: 500,000 serialized JSON UTF-8 bytes per artifact. A base64 artifact therefore has a practical raw size limit of about 375 KB; the 750,000-byte request ceiling also applies. Cloud Routine outputs larger than this need to be reduced or split before registration.
- Execution lease: 15 minutes by default; explicit claims allow 1 second through 1 hour

These are application limits, not claims about Cloudflare free-plan storage, Routine daily runs, or subscription usage.

## Verification and unverified integrations

Automated coverage uses the real reducer, Node HTTP server, SQLite database, D1 adapter through a SQLite-backed D1 test double, JSONL parser, path containment checks, and Worker request handler. External Codex and Anthropic calls are replaced only at their process/network boundary.

Fresh combined verification on 2026-09-13:

```text
node --test --test-isolation=none tests/attachments.test.mjs tests/client.test.mjs tests/engine.test.mjs tests/research.test.mjs tests/server.test.mjs
55 tests, 55 passed, 0 failed
```

All owned `.mjs` files also passed `node --check`.

Verified on this host:

- Node `v24.19.0` and built-in `node:sqlite`
- `codex login status` reports `Logged in using ChatGPT`
- `codex features list` reports `multi_agent` as stable
- Local server startup, public health, bearer-authenticated state, task persistence, metadata stripping, and `.mjs` static MIME
- Escalated real subscription smoke completed in about five seconds with assistant result `INNO_SMOKE_OK` and durable `final.md`; the resulting SQLite task was independently read back as `completed`

The managed default test sandbox denies child-process creation from Node with `EPERM`; the real Codex smoke therefore required the approved escalated process environment. No Claude Routine URL/token was available, so no live Routine was fired. No D1 database ID or Cloudflare account deployment was available. Those capabilities must remain reported as unavailable until configured and successfully observed.

Provider streaming/SSE is not implemented; clients poll visible active tasks. Codex event token counts are recorded, but subscription remaining-percent and reset time remain `null` unless a future verified source supplies them. Claude global subscription usage is not inferred. Generated run directories are retained locally for inspection and may require periodic user-managed cleanup.
