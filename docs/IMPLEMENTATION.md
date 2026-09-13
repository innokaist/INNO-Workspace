# INNO Workspace Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development. Work task-by-task and record verification in docs/PROGRESS.md.

**Goal:** Build the approved cross-device research workspace with connected-only inputs, durable tasks, subscription executors, and recoverable workflow.

**Architecture:** Dependency-light browser PWA plus shared task engine. Node SQLite runs locally with the signed-in Codex CLI; a Cloudflare Worker/D1 adapter provides an optional always-online API and Claude Routine dispatch. An explicit remote API URL enables all devices to share task state. New-workspace persistence uses SQLite/D1 rather than a new Firebase project so the same transactional engine works locally and in the cloud; existing Firebase research sources stay untouched.

**Tech stack:** ES modules, Node >=24, SQLite/D1, browser File APIs, native HTML/CSS, node:test, Playwright QA where available.

**Spec:** ../docs/superpowers/specs/2026-09-13-inno-workspace-design.md in the parent workspace, approved with connected-only input amendment.

## Global constraints

- No model API keys, paid fallback, purchase, or input-file permanent upload.
- Task metadata/messages/checkpoints/outputs persist; attachment bytes never enter task storage.
- Original six apps are read-only integration sources, never mass copied into public source.
- Show actual executor connection state. Proposed agent plan is not an AI answer.
- Local files require a live browser connection. Unsupported binary formats remain references; no fabricated analysis.
- Single owner workspace with a strong access token; tokens never embedded in published source or localStorage.
- Cloud free limits apply; no unbounded server or zero-cost guarantees.

## Shared contract

Task: `{id,title,prompt,type,status,version,createdAt,updatedAt,messages,plan,attachments,artifacts,checkpoint}`.
Message: `{id,role:'user'|'assistant'|'system',content,createdAt}`.
Plan item: `{id,role,label,status,instructions}`.
Attachment: `{id,name,path,size,lastModified,type,source:'file'|'folder'|'url',url?}`; no `content`, data or file objects persisted.
Artifact: `{id,name,mime,content,encoding?:'utf-8'|'base64',createdAt}`.
`GET /api/state` -> `{revision,tasks,usage,capabilities}`. capabilities contains `localCodex`, `claudeRoutine`, `cloud`, `connected` booleans.
`POST /api/tasks` accepts `{prompt,type,attachments}` -> `{task}`.
`POST /api/tasks/:id/actions` accepts `{action,expectedVersion,...}` -> `{task}`.
Actions: `message {content}`, `pause`, `resume`, `cancel`, `decide {content}`, `checkpoint {content}`, `artifact {artifact}`, `plan {plan}`.
`POST /api/tasks/:id/run` accepts `{provider:'codex'|'claude',materials:[{name,text}],expectedVersion}` -> `{task,sessionUrl?}`. Materials are transient and never stored.
`GET /api/health` public returns only service status; other routes require Bearer token except local server same-origin authenticated session.
Browser offline store uses shared `createTask(input)` and `applyAction(task,input)` from public/core/tasks.mjs. Conflicting updates return HTTP 409. Remote mode never silently downgrades failed writes to offline success.

## Task 1 — durable engine and executors (backend agent)

Own `server/`, `worker/`, `public/core/tasks.mjs`, `tests/engine.test.mjs`, `tests/server.test.mjs`, `wrangler.jsonc`.

- [ ] Write failing tests for pause/resume, terminal state, stale version, metadata-only inputs, expired/stale execution, auth and run capability checks. Run `node --test tests/engine.test.mjs tests/server.test.mjs` and observe missing implementation.
- [ ] Implement shared pure task reducer, bounded role plans by task type, action validation; SQLite transactional state store; HTTP routes with token authentication, explicit CORS allowlist and safe static serving.
- [ ] Implement actual signed-in `codex exec --json` runner with stdin prompt, no shell interpolation, API-key environment exclusion, usage event parsing, durable result/checkpoint and cancellation. Routine adapter uses documented endpoint and server-side token only; no fake response. No provider available -> clear HTTP error and waiting state.
- [ ] Implement D1/Worker adapter and migration with same API/reducer; Claude run calls work without local PC. Never send local browser handles to cloud.
- [ ] Supply MCP tools for authenticated task list/read/checkpoint/artifact/plan and durable single execution ownership.
- [ ] Run tests; document exact capabilities and unverified live integration in backend report. Do not modify UI or root package.json.

## Task 2 — connected files and research adapters (integration agent)

Own `public/core/attachments.mjs`, `public/core/research.mjs`, `tests/attachments.test.mjs`, `tests/research.test.mjs`, `docs/RESEARCH-INTEGRATIONS.md`.

- [ ] Write failing tests where malicious path, stored content leakage, oversized reading, stale file, invalid Prism JSON and fabricated citation would be caught.
- [ ] Implement `AttachmentSession` with `addFiles(files)`, async `addDirectory(handle)`, `addUrl(url)`, `list()`, `remove(id)`, `clear()`, `readText(id,{maxBytes})`, `getFile(id)`; holds File/handle in memory only, descriptors follow shared contract. Limit text extraction to 200000 bytes per file with explicit truncation/unavailable status; never persist File objects.
- [ ] Implement `parsePrismReport(text)` preserving engine/analysis/source and numeric validation; `parseRefAtlas(text)` for catalog/array/paper records preserving DOI and evidence scope; `searchPapers(papers,query,limit)` deterministic search; `INTEGRATIONS` with known existing app links and supported imports. Consult local existing sources.
- [ ] Test reattachment identity, folder nesting, metadata-only list, repeated lookup and typed import failures. Document how other modules use exported functions. No UI/backend edits.

## Task 3 — working interface (root)

Own `public/index.html`, `public/styles.css`, `public/app.mjs`, `public/core/client.mjs`, `public/sw.js`, `public/manifest.webmanifest`, `public/icon.svg`, package and documentation.

- [ ] Implement coherent matte desktop/mobile shell, real task create/edit/list, distinct user/assistant messages, attachment session and previews, workflow roles, artifacts, decision cards, usage and connectivity.
- [ ] Implement local IndexedDB/browser metadata store and explicit remote API client; shared reducer, no secret localStorage, actionable error states. Poll only visible active clients and show observed synchronization interval; real-time provider streaming where backend exposes it.
- [ ] Wire provider run to actual endpoint with only explicitly readable transient file excerpts. On restored tasks require reattachment before running referenced local files. Include export/import checkpoint bundles without input bytes.
- [ ] Wire RefAtlas import/search and Prism report view, six existing apps, role editing, pause/resume/cancel and results download.
- [ ] Check desktop and mobile layouts and core interactions in browser, plus no source bytes in durable storage.

## Task 4 — package, review, publish (root + reviewer)

- [ ] Add README, environment example, setup/start scripts, security boundaries, Cloudflare deployment instructions and GitHub Actions test/static deployment workflows. Default offline works without accounts; local live Codex uses existing subscription.
- [ ] Run complete node:test suite and browser QA. Reviewer audits auth, source retention, stale execution, fake-success and cloud portability. Fix material findings and re-test affected paths.
- [ ] Create new GitHub repository and upload only application code/docs/tests. Deploy public static interface or configured cloud backend when the account permits. If account configuration is missing, finish runnable code and name only the actual remaining deployment prerequisites; never claim a live backend without testing it.

## Verification examples

```js
const t=createTask({prompt:'문헌 검토',type:'literature',attachments:[{id:'a',name:'x.txt',size:3,content:'secret'}]});
assert.equal(JSON.stringify(t).includes('secret'),false);
assert.throws(()=>applyAction(t,{action:'pause',expectedVersion:99}),/version|conflict/i);
```

CLI verification: `node --test tests/*.test.mjs`; `node server/index.mjs`; browse returned localhost URL. Cloud deployment uses `npx wrangler d1 create inno-workspace`, configure returned database id, apply migrations, set secrets and deploy only on Free plan.
