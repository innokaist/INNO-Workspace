# Final code review

Reviewed 2026-09-13 against `docs/IMPLEMENTATION.md` and `README.md`, using the requesting-code-review workflow. Scope: shared reducer, SQLite/D1 stores, HTTP authentication and execution ownership, Codex/Routine runners, MCP, browser state, input handling, and UI actions. This was a bounded source review; the coordinator owns full suite, browser, live executor, and deployment verification.

## Findings fixed during review

### [P1] Offline writes could silently erase another tab's work — fixed and regression-tested

The original `public/core/client.mjs` saved the complete in-memory workspace without reading current IndexedDB state inside the write transaction. Two clients loaded the same empty state; the first created a task and the second then created another task, deleting the first. An executable probe using the actual WorkspaceClient and an asynchronous IndexedDB mock printed `First task survived: false` and retained only the second title. Stale task actions similarly bypassed meaningful cross-tab CAS.

The current `localMutate` implementation (`public/core/client.mjs:30`) reads, applies the reducer/version check, and writes in one readwrite transaction. Create, action, and restore now use it. Added a regression test in `tests/client.test.mjs` with two actual WorkspaceClient instances and a transaction-aware IndexedDB fake. Concurrent creates retain both tasks; a stale action rejects with statusCode 409 and leaves the newer message intact. `node --test --test-isolation=none tests/client.test.mjs` passes all four tests.

### [P1] RefAtlas shortcut persisted source abstracts — fixed by inspection

The original paper-question shortcut copied `p.abstract` verbatim into the composer. Submitting stored that source excerpt in both task prompt and user message, and therefore DB/export, contrary to the connected-only source policy. The current shortcut (`public/app.mjs:147`) includes bibliographic metadata only and explicitly requests a separately connected source for content analysis.

### [P2] Every role-plan edit failed validation — fixed by inspection

The plan editor originally sent `status: 'proposed'`, which the shared reducer rejects. An executable reducer probe returned `plan item status is invalid`. The current editor (`public/app.mjs:139`) sends `pending`, which is allowed. Preserve UI coverage that submits the role dialog and verifies the stored plan.

## Follow-up verification

### [P2] Executor cannot enter the displayed decision-waiting workflow — fixed and probed

Originally, checkpoint status allowed only `running` or `completed`; no supported executor action could create `waiting_user` or its options. The new `request_decision` MCP tool (`server/mcp.mjs:64`) calls owner-checked `requestDecision` in both SQLite and D1 stores. Shared validation requires a question and 2–5 unique options with pros and cons. Changing the task status revokes the current execution's write access.

A follow-up executable probe passed the complete sequence: actual `handleMcp(request_decision)` → waiting_user → stale completion rejected → user decide → ready → fresh execution generation. D1 implementation was checked for equivalent ownership and atomic update behavior. The coordinator reports the fresh full suite at 64/64 and a real Codex smoke pass; those full runs were performed by the coordinator, not repeated by this reviewer.

### [P2] Routine artifact transport limit — partially resolved; character/byte mismatch remains

`server/http.mjs:39` and `worker/index.mjs:30` cap every request body, including `/mcp`, at 750,000 bytes. The reducer (`public/core/tasks.mjs:161`) now limits inline artifact content to 500,000 characters, and `docs/BACKEND-REPORT.md` documents both limits. This correctly bounds base64 binaries to approximately 375 KB decoded, making the former oversized-binary failure a documented product limit. However, multibyte UTF-8 text still passes reducer validation while exceeding the request limit: a follow-up probe accepted 300,000 Korean characters whose serialized action was 900,107 bytes. The MCP tool schema/description does not expose either limit to the Routine.

Bound the serialized content's UTF-8 bytes, leaving room for the JSON envelope, and expose the resulting inline limit in the MCP artifact description/schema and Routine instructions. Retain the explicit larger-file limitation rather than implying arbitrary PPTX/image transfer. Include a multibyte text regression; an ASCII-only reducer test does not verify transport compatibility.

## Non-findings and limits

- API routes require the access token; the local runner checks ChatGPT login, strips model API-key environment variables, ignores user Codex configuration, and uses ephemeral execution. No direct paid API fallback was found.
- Attachment descriptors are selected metadata fields; file handles and transient run materials are not written by the task stores. Generated outputs intentionally persist.
- SQLite/D1 writes use version checks, and cancelled or superseded execution identities cannot finish a task. D1's compare-and-swap update prevents two claims from winning the same version.
- Missing Cloudflare account/database IDs, Routine credentials, custom MCP account support, and the documented absence of a local-Codex-to-cloud queue bridge are deployment/product boundaries, not newly discovered defects.
- No production accounts, paid executions, or external deployment were initiated by this review. Passing live MCP interoperability, D1 runtime limits, and browser behavior still require the coordinator's reported verification.
