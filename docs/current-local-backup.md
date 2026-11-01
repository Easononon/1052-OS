# Current Local Source Backup

This source snapshot contains the local frontend shell migration, appearance switch and Clippit companion, gateway proxy alignment, speech/model integration changes, and the AIAAS read-only diagnostic bridge. The original project license and upstream history are retained.

## Backup Boundary

Git contains source, tests, public assets, dependency lockfiles, and operational documentation. It does not contain `data/`, `backend/data/`, `.env`, local credentials, model API keys, chat history, private Wiki/notes, runtime SQLite databases, logs, dependency installations, build outputs, or timestamped configuration backups.

Source backup is not a complete machine/data backup. Restore private application data separately from an authorized encrypted backup; do not commit it to this public repository. Never paste credentials into issues or documentation.

## Restore And Run

Use a Node version compatible with the installed native `better-sqlite3` module. The verified local environment uses Node 24. Install dependencies separately in `backend/` and `frontend/` with `npm ci`, then build each with `npm run build`. Source frontend changes are not automatically included in the upstream Docker image referenced by the existing Compose file; do not assume pulling that image deploys this snapshot.

AIAAS diagnostic operation requires `AIAAS_AGENT_MODE=diagnostic`, a private `AIAAS_DIAGNOSTIC_BRIDGE_TOKEN` matching the AIAAS backend, and an approved model/data configuration. Follow [the diagnostic runbook](aiaas-diagnostic-agent.md). Keep real PLC/database access disabled until separately authorized and validated.

The diagnostic entry defaults to disabled and simulation-only. Runtime model profiles and approved data-source files are private configuration, not embedded source defaults. Restoring this code alone does not restore model access, historical data, chat, Wiki, or permissions configured in application data.

## Verification On 2026-11-01

- Backend TypeScript build: passed.
- Frontend TypeScript/Vite build: passed, with existing chunking warnings.
- Frontend unit tests: 173 passed.
- Backend full suite: 314 passed, 2 existing failures.
- Dedicated diagnostic protocol tests: 12 passed within the backend suite.

Existing backend failures remain explicitly unresolved in this backup:

1. `agent.prompt.service.test.ts`: fallback system prompt differs from `agent-system.md`.
2. `tools/agent-runtime.tools.test.ts`: old full-access injection expectation conflicts with the existing permission-profile precedence.

This is a reproducible source backup, not a claim of production safety certification, validated site predictions, or a fully green test suite. No live PLC operation is performed by uploading this snapshot.
