# Unified execution implementation plan
Goal: cloud queue -> serial desktop subscription runner -> idempotent cloud completion.
Spec: ../specs/2026-09-14-unified-execution-design.md
Constraints: E:\Develop, no API fees, no source archival, bounded polling and one pending result.
1. Test and implement queue, atomic ownership, renewal and duplicate completion in Worker.
2. Test and implement desktop consumer, interruption and durable result delivery.
3. Add UI queue availability and launch guide.
4. Full tests, deployment and real Codex roundtrip.
First slice rejects tasks with unavailable attachments; transient source reconnection follows independently.
