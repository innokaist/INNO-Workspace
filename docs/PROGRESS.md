# SDD ledger — plan: docs/IMPLEMENTATION.md

User approved implementation; input files/folders are connected references, not permanently uploaded.

| Review pair | Interface check | Finding |
|---|---|---|
| 1/2 | attachment descriptors | Content forbidden in storage; explicit allowlist |
| 1/3 | Task and action API, shared reducer | Same schema used by offline and server |
| 2/3 | AttachmentSession and research exports | UI retains in-memory File handles only |
| 1 | executor state/auth/persistence | Missing remote config must fail visibly |
| 2 | source imports/read budgets | Original files untouched |
| 3 | offline/remote transitions | Failed cloud writes must not appear synced |
| 4 | source delivery | GitHub code only; private user inputs excluded |

Ruling: new dedicated repo inside the writable workspace isolates existing E: apps without a worktree from the empty parent repository.
Ruling: SQLite/D1 replaces the candidate new Firestore task DB to share transactional code across local/cloud; existing Firebase adapters stay separate.
Ruling: no Sites lifecycle because approved design explicitly uses GitHub/Cloudflare hosting for the integrated application.

Task 1: implementation and verification complete; Worker/D1 deployed and live persistence verified; Claude Routine authenticated roundtrip verified on 2026-09-14 (task read, artifact writes, final answer, completed state).
Task 2: complete, including extraction/provenance review fixes.
Task 3: complete with desktop/mobile browser checks and offline CAS fix.
Task 4: GitHub source and Pages published, Cloudflare Worker/D1 deployed. Live auth and persistence verified. Personal onboarding kept outside Git in .inno/CLOUD-ACCESS.md.

2026-09-14: Cloud Codex queue and desktop bridge first slice deployed, real subscription roundtrip verified. See DESKTOP-BRIDGE.md for supported flow and remaining scope.
