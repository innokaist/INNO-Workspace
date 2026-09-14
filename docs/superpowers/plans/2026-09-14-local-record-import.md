# Local record import implementation
Approved continuation of unified workspace integration, 2026-09-14.
- Preserve original SQLite/browser export and cloud records.
- Shared strict task sanitizer strips source attachment bytes, credentials, execution leases, and unknown fields. Oversized or malformed records fail visibly without truncation.
- Per-task canonical SHA-256 identifies identical imports; cloud INSERT OR IGNORE is atomic. Changed same-ID records conflict unless explicitly copied under deterministic new ID.
- Read local SQLite only, page summaries, import selected IDs after fingerprint recheck. No raw source file access.
- UI previews records and reports created, skipped, conflicts, failures. Transfer one task at a time with 700KB request cap; retry is idempotent. Existing JSON exports use the same flow.
- Test sanitizer, concurrency, post-import cloud edits, copy idempotency, changed local records, readonly source; full suite and live synthetic import verification.
