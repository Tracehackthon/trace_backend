---
"@trace/storage": patch
"@trace/instance": minor
"@trace/product-application": patch
"@trace/app-cli": patch
"@trace/host-codex-hooks": patch
"@trace/host-codex-skill": patch
---

Harden the Trace Codex boundary: both SQLite drivers now enforce one-statement and read-query semantics, source leases require the exact project profile lock, and only reviewed external/team source profiles can refresh that lock. Project-owned `local` and `empty` modes remain respectively project-local and disabled even if an untrusted project forges a matching profile hash. Codex host rollback refuses to overwrite post-install user edits, while Plugin installation stages before swapping an existing marketplace and compensates marketplace/plugin-registration failures.
