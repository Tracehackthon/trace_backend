---
"@trace/storage": patch
"@trace/instance": minor
"@trace/product-application": patch
"@trace/app-cli": patch
"@trace/host-codex-hooks": patch
"@trace/host-codex-skill": patch
---

Harden the Trace Codex boundary: sql.js read-only handles now reject mutation through query methods, source leases require the exact project profile lock, and intentional source moves use an explicit backed-up update. Codex host rollback now refuses to overwrite post-install user edits, while Plugin installation compensates marketplace and plugin-registration failures.
