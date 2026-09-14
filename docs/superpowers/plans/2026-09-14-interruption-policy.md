# Interruption policy

Implement the approved sequential reliability work in the existing checkout.

1. Classify executor failures with bounded, safe summaries: quota, authentication, connection, unknown.
2. Preserve checkpoint content across failure, remote session startup and desktop lease expiry. Keep one latest failure record, no growing retry log.
3. Show reason and manual recovery guidance. Retry-After is only a server retry hint, never a subscription reset promise. No automatic execution replay when acceptance or side effects are uncertain.
4. Test nonzero Codex JSON failures, HTTP rejection, checkpoint preservation and stale owner fencing in SQLite/D1; review, deploy and verify.

Automatic AI retries remain disabled until the provider contract proves rejection before execution and gives a reliable retry time. Saved result delivery retains its existing retry behavior.
