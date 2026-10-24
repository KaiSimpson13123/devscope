# DevScope — Local Developer Operations & AI Telemetry Monitor

DevScope is a local developer operations and observability system built to monitor Antigravity agent sessions, local development workspaces, Git repositories, GitHub remote telemetry, AI model token consumption, and operating-system development processes in real time.

---

## 1. Quick Start & Commands

### Prerequisites
- **Node.js**: `v24.x` (uses built-in native `node:sqlite` `DatabaseSync` with zero C++ compiler requirements)
- **Git**: `v2.x+`

### Installation & Startup
```bash
# Install dependencies
npm install

# Initialize SQLite database & run migrations explicitly (optional; runs automatically on start)
npm run db:migrate

# Run environment & connector diagnostics CLI report
npm run diagnostics

# Start the development server (bound to 127.0.0.1:3100 by default)
npm run dev

# Or build and start in production mode (bound to 127.0.0.1:3100)
npm run build
npm run start
```

Open **[http://127.0.0.1:3100](http://127.0.0.1:3100)** in your browser.

### Quality & Verification Suite
```bash
# Strict TypeScript type checking
npm run typecheck

# Run automated unit & integration tests (Vitest)
npm test
```

---

## 2. Architecture & Module Structure

- `app/` — Next.js App Router pages (`/`, `/antigravity`, `/activity`, `/github`, `/usage`, `/processes`, `/projects`, `/tasks`, `/errors`, `/settings`) and localhost-protected REST + SSE API routes (`app/api/*`).
- `components/` — Shared UI shell (`AppShell.tsx`), global search modal (`Ctrl+K`), notification popover, live SSE stream hook (`useLiveStream`), and tabular formatting utilities (`format.ts`).
- `lib/db/` — Persistent SQLite database (`node:sqlite` in WAL mode), automatic schema migrations (`001_initial_devscope_schema`), and typed accessors for all 12 core tables (`projects`, `repositories`, `agent_sessions`, `tasks`, `activity_events`, `file_changes`, `process_observations`, `usage_records`, `errors`, `notifications`, `integration_connections`, `application_settings`).
- `lib/connectors/` — Extensible `ConnectorAdapter` interface and the `AntigravityConnector` inspecting `~/.gemini/antigravity-cli`, `~/.gemini/antigravity-ide`, `~/.gemini/antigravity`, and `agy.exe agentapi`.
- `lib/monitoring/` — Live workspace filesystem watcher powered by `chokidar` with sensible exclusions (`.git`, `node_modules`, `.next`, `.devscope`, build outputs, caches), 300ms file-write debouncing, 2.5s event signature deduplication, and background sync orchestration.
- `lib/github/` — Local Git repository auto-discovery, working-tree status & sanitized diff inspector, and authenticated GitHub API client supporting `gh` CLI, `GITHUB_TOKEN`, and Git Credential Manager.
- `lib/usage/` — AI token accounting engine with versioned reference pricing table (`v2026.10`), provider adapters, and strict separation between **measured** tokens, **estimated** costs, and **reported** provider billing.
- `lib/processes/` — Cross-platform OS process and TCP listening port inspector with automatic command-line secret redaction and explicit PID confirmation before process termination.
- `lib/events/` — Real-time Server-Sent Events (SSE) broadcast bus and notification cooldown engine.
- `lib/security/` — Secret redaction patterns, sensitive file diff blocking (`.env`, `.pem`, `.key`, `.ssh`), path traversal protection, localhost-only origin verification, and Zod validation schemas.

---

## 3. Antigravity Integration & Honest Telemetry Matrix

DevScope discovers the installed Antigravity environment directly rather than assuming undocumented sockets or fabricating telemetry:

| Capability | Status | Verified Source | Notes |
| :--- | :--- | :--- | :--- |
| **Active & Historical Sessions** | **Exposed** | `~/.gemini/antigravity-{cli,ide}/brain/<id>` & `presence/*.lock` | Detects live CLI presence locks and historical IDE/CLI sessions. |
| **Tool Calls & File Operations** | **Exposed** | `.system_generated/logs/transcript.jsonl` | Extracts `run_command`, `write_file`, `edit_file`, `read_file`, `list_dir`. |
| **Measured Token Usage** | **Exposed** | `PLANNER_RESPONSE` step fields (`input_tokens`, `output_tokens`, `cache_read_tokens`) | Exact per-step token telemetry recorded in SQLite. |
| **Model Identifier** | **Partially Exposed** | `<USER_SETTINGS_CHANGE>` in `transcript.jsonl` & `agy.exe models` | Displayed when logged in the session transcript; otherwise honestly shown as `"Not exposed"`. |
| **Task Progress & Subtasks** | **Partially Exposed** | `task.md`, `walkthrough.md`, `.system_generated/tasks/*.log` | Shows checklist or step/task log counts; otherwise `"Progress not exposed"`. Never infers completion merely from agent idle state. |
| **Provider Reported Billing ($)** | **Unavailable** | Local Antigravity logs do not expose dollar invoices | Reported cost is strictly `null` (`"Unavailable from this source"`). Estimated cost is calculated via configurable pricing table `v2026.10` when model pricing is known. |
| **Internal Chain-of-Thought** | **Intentionally Excluded** | Filtered out during transcript ingestion | DevScope monitors observable actions and tool executions only; private `thinking` fields are never extracted. |

---

## 4. Configuration & Storage Locations

- **SQLite Database**: Stored locally at `.devscope/devscope.db` (override via `DEVSCOPE_DB_PATH` in `.env.local`).
- **Environment Configuration**: Copy `.env.example` to `.env.local` to configure optional `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or custom workspace roots.
- **GitHub Authentication Priority**:
  1. GitHub CLI (`gh auth token`) when installed and authenticated.
  2. `GITHUB_TOKEN` environment variable in `.env.local`.
  3. Local Git Credential Manager (`git credential fill` for `github.com`).

---

## 5. Security & Privacy

- **Localhost-Only Binding**: Runs on `127.0.0.1:3100` by default and validates the HTTP `Host` header against non-local access unless `DEVSCOPE_ALLOW_REMOTE=true` is explicitly set.
- **Automatic Secret Redaction**: All command lines, event payloads, error logs, and git diffs pass through `redactSecrets()` and `redactObject()` to strip GitHub PATs (`ghp_*`, `gho_*`, `github_pat_*`), OpenAI/Anthropic/Google/AWS keys, Bearer tokens, URL passwords, and private keys before storage or display.
- **Sensitive File Protection**: Diff previews for `.env`, `.env.*` (except `.env.example`), `.pem`, `.key`, `id_rsa`, and credential files are blocked by policy.
- **Explicit Confirmation for Destructive Actions**: Process termination requires matching `confirmPid`, and history deletion requires explicit confirmation.

---

## 6. Troubleshooting

- **Missing Workspace Warning**: If a previously monitored directory is moved or deleted, DevScope marks the project as `missing_workspace` in the Projects view and records a warning in the Error Centre without interrupting monitoring of other workspaces.
- **GitHub API Rate Limits**: DevScope caches remote GitHub metadata (PRs, issues, workflows, deployments) for 3 minutes and monitors `x-ratelimit-remaining`. Local Git inspection works offline with zero API calls.
