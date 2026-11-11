# evot-herdr

A small, independent session-hook adapter that connects [evot](https://github.com/sundy-li/evot) with [Herdr](https://herdr.dev).

`evot-herdr` is a single executable with two roles. Run it directly and it starts evot as a transparent wrapper; when evot launches it as `EVOT_SESSION_HOOK`, it consumes evot's generic NDJSON stream and translates lifecycle events into Herdr pane commands. evot remains independent of Herdr.

## Features

- Runs as a transparent wrapper around `evot` and preserves its exit status.
- Detects hook mode from three signals (self-referenced `EVOT_SESSION_HOOK`, no arguments, piped stdin) instead of stdin TTY state alone.
- Reports `working`, `blocked`, and `idle` lifecycle states to both legacy Herdr CLI and [herdr-app](https://github.com/herdrdev/herdr-app) / herdr-core (`hc`).
- Automatically selects the App's OSC 7501 protocol in `hc` terminals, without requiring the legacy `herdr` executable.
- Relays detached hooks through a private wrapper-owned terminal bridge, with stale-hook fencing and exit cleanup.
- Registers `evot-herdr --resume <session_id>` for conversation restore after a Herdr server restart (Herdr 0.9.2+).
- Keeps state/session reporting compatible with older Herdr versions through capability detection.
- Replaces the restore target when sessions change, without releasing pane ownership between them.
- Releases the Herdr agent on explicit session exit, stdin EOF, `SIGINT`, or `SIGTERM`.
- Times out stuck Herdr commands and terminates their process trees.
- Retries state, session, and release updates after failed Herdr commands.
- Deduplicates only successfully reported state notifications.
- Validates the versioned hook protocol and ignores malformed or unsupported events.
- Generates monotonic, cross-process sequence values within Herdr's signed 64-bit range.

## Requirements

- Node.js 22.12+ (no Bun, tsx, or runtime npm dependencies).
- Either herdr-app / herdr-core (`hc`), or legacy Herdr CLI. Legacy Herdr 0.9.2+ is required for automatic conversation restore; older versions still receive lifecycle reports.
- An installed `evot` executable with `EVOT_SESSION_HOOK` support, unless `EVOT_BIN_PATH` is set.
- For herdr-app: a core-managed terminal (`HC_TERMINAL_ID` is supplied by `hc`). The old `herdr` binary is not required.
- For legacy CLI: a Herdr installation available as `herdr` (or `HERDR_BIN_PATH`) and a Herdr-managed pane. The wrapper and directly launched hook can discover the pane when `HERDR_PANE_ID` is absent.

## Usage

### Recommended: wrapper mode

Install from a GitHub source checkout (Node.js 22.12+, npm, and Git required):

```bash
git clone https://github.com/sundy-li/evot-herdr.git
cd evot-herdr
npm install --include=dev --legacy-peer-deps
npm link
evot-herdr
```

There is currently no npm registry release; no npm login or `@evotai` scope permission is required. `npm install` installs build-time dependencies and runs `prepare` to compile `dist/` automatically. Do not use `--ignore-scripts` for the install step. `--legacy-peer-deps` avoids npm resolver failures involving the test runner's optional browser/devtools peers; those integrations are not needed here. No Bun or runtime npm dependencies are needed.

`npm link` makes `evot-herdr` available on `PATH`; keep the source checkout in place. Alternatively, skip `npm link` and run `./bin/evot-herdr`, or add the checkout's `bin/` directory to `PATH`. Avoid `npm install -g <Git URL>`: some npm versions propagate global-install settings into the Git dependency's build and fail to install its build-time dependencies.

To update, run in the same checkout:

```bash
git pull --ff-only
npm install --include=dev --legacy-peer-deps
```

To pin a revision, run `git checkout <commit-sha>` before installing. With pnpm, run `pnpm install --frozen-lockfile && pnpm run build`, then add the checkout's `bin/` directory to `PATH`. The CLI runs compiled JavaScript from `dist/`, not TypeScript.

`evot-herdr` runs in wrapper mode unless all hook-mode conditions below hold. It:

1. Discovers the current Herdr pane when necessary.
2. Sets `EVOT_SESSION_HOOK` to itself unless a custom hook is already configured.
3. Starts evot with inherited stdin, stdout, and stderr.
4. Exits with evot's exit status. A spawn failure is printed to stderr and returns `127`.

Arguments are forwarded unchanged:

```bash
"$PWD/bin/evot-herdr" --help
```

Override the evot executable when developing against a local build:

```bash
EVOT_BIN_PATH=/path/to/evot "$PWD/bin/evot-herdr"
```

If evot was already running before the hook was installed or changed, restart it so the new environment is applied.

### herdr-app / herdr-core (`hc`)

Inside a herdr-app terminal, run the same wrapper:

```bash
evot-herdr
```

The adapter detects `HC_TERMINAL_ID` and reports `app=evot` using OSC 7501. Working, approval-blocked, and idle states appear in the App's agents view. No `HERDR_PANE_ID`, `HERDR_BIN_PATH`, or legacy `herdr` command is needed. An explicit `HERDR_PANE_ID` takes precedence, supporting legacy Herdr nested inside an `hc` terminal.

To add evot to the App's agent launcher, merge this entry into the `programs` object in `~/.config/herdr-app/programs.json` (or `$HERDR_APP_HOME/programs.json`), preserving other entries:

```json
{
  "programs": {
    "evot": {
      "name": "evot",
      "run": ["evot-herdr"],
      "match": ["evot-herdr"]
    }
  }
}
```

Keep `evot-herdr`, `evot`, and Node.js on the shell's `PATH`. Restart existing evot processes after upgrading the adapter.

**Why a bridge?** evot launches its hook detached with stdout/stderr discarded. Printing an OSC escape from the hook would not reach the App. The wrapper instead creates a private local socket (a named pipe on Windows), accepts bounded structured reports, and writes OSC to its own terminal. Sequence generations fence late updates from older hooks. The wrapper clears status on child exit even if evot did not wait for its hook. No OSC bytes are written into redirected stdout/stderr files.

On POSIX, plain `evot` with `EVOT_SESSION_HOOK` also works: the hook resolves the parent evot process's terminal with `ps` and writes to that character device. This is best effort; a missing parent terminal, unavailable `ps`, nested terminal multiplexers, or overlapping hooks can prevent reliable reporting. Prefer the wrapper for fencing and reliable cleanup. On Windows, use the wrapper; detached plain hooks do not have the POSIX terminal fallback.

**Restore boundary:** the App/core's OSC protocol exposes status, not the legacy `report-agent-session` resume-argv API. This adapter does not register automatic conversation restore with herdr-app. Resume saved conversations manually with `evot-herdr --resume <session_id>`; the automatic restore section below applies only to legacy Herdr CLI.

### Hook mode with a plain `evot`

Export the hook once and run `evot` directly; this is the typical shell setup:

```bash
# ~/.zshrc
export EVOT_SESSION_HOOK="$(command -v evot-herdr)"
```

evot launches the hook with no arguments and a piped stdin. The executable enters hook mode only when **all** of the following are true:

1. `EVOT_SESSION_HOOK` resolves to this executable (absolute or relative path, a `PATH` command name, or a symlink to it).
2. No command-line arguments were given.
3. stdin is not a TTY.

Otherwise it runs as the wrapper, so `evot-herdr --help </dev/null` and interactive `evot-herdr` still start evot. Recursion is impossible: hook mode never spawns evot, and evot only launches this executable when the hook variable points at it. The one ambiguous case is running the *wrapper* with a self-referenced hook, no arguments, and piped stdin; pass any argument (for example `-p`) in that situation.

Feeding an event stream by hand uses the same conditions:

```bash
EVOT_SESSION_HOOK="$PWD/bin/evot-herdr" \
HERDR_PANE_ID=w1:p1 \
HERDR_BIN_PATH=/path/to/herdr \
"$PWD/bin/evot-herdr" < events.ndjson
```

Running outside a Herdr pane or `hc` terminal is harmless: pane discovery fails and the hook stays inert (it still reserves a sequence generation in the state file described below).

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HERDR_PANE_ID` | No | Current legacy Herdr pane | Explicit legacy pane identifier; takes precedence over App detection. |
| `HC_TERMINAL_ID` | Supplied by `hc` | Unset | Selects herdr-app/core reporting when no explicit legacy pane is set. Do not set manually. |
| `EVOT_HERDR_APP_SOCKET` / `EVOT_HERDR_APP_TERMINAL_ID` | Internal | Wrapper-managed | Private App bridge and owning core terminal. Inherited bridges are not reused across different core terminals. |
| `HERDR_BIN_PATH` | No | `herdr` | Herdr executable path or command name. |
| `HERDR_COMMAND_TIMEOUT_MS` | No | `2000` | Positive integer timeout for pane discovery, capability detection, and each Herdr update. Timed-out process trees are terminated. |
| `EVOT_HERDR_SEQUENCE_STATE_PATH` | No | User state directory | Persistent fencing-sequence file. Override mainly for tests or portable installations. |
| `EVOT_BIN_PATH` | No | `evot` | evot executable path or command name. |
| `EVOT_SESSION_HOOK` | No | `bin/evot-herdr` | Hook passed to evot by the wrapper. Custom values are preserved. |
| `EVOT_HERDR_RESUME_COMMAND` | No | `evot-herdr` | Plain command name on `PATH` used for restore. Set to `evot` only if your shell already configures `EVOT_SESSION_HOOK`. Absolute executable paths cannot be used for Herdr restore. |
| `EVOT_HERDR_ENV_FILE` | No | Unset | Config file to add as `--env-file` to the restore command. Wrapper mode captures `--env-file` automatically as an absolute path. Set explicitly when launching plain `evot` with a non-default config. |

## Automatic conversation restore (legacy Herdr CLI)

Start evot through `evot-herdr` inside a Herdr pane, and send at least one prompt so a persisted session exists. On Herdr 0.9.2+, the adapter reports both the full session ID and a portable restore argv:

```text
evot-herdr --resume <full-session-id> [--env-file /absolute/config.env]
```

No global “latest session” lookup is used: each pane gets its own conversation. Keep `evot-herdr`, `evot`, and Node.js on the restored shell's `PATH`; set any custom `EVOT_BIN_PATH` persistently in that shell too. Restart existing evot processes after installing this adapter.

Herdr's default is to resume agents. If disabled, enable it in `~/.config/herdr/config.toml` and reload/restart Herdr:

```toml
[session]
resume_agents_on_restore = true
```

- Detaching a Herdr client leaves the server and evot processes running; no restore is necessary.
- After a **Herdr server restart**, reattach the same Herdr session. Herdr restores the pane's cwd and runs the registered command after a client attaches.
- User `/exit` clears automatic restore. Switching sessions replaces the target instead of clearing ownership. EOF/signals still attempt cleanup; Herdr saves its shutdown snapshot before shutting down panes and rejects late reports.
- This restores **saved conversation context**, not a running process or tool call. It does not submit a prompt or replay interrupted commands. Unsaved streaming output, forced power loss, and OS shutdown races are not guaranteed recoverable.
- Missing `evot-herdr` on `PATH`, invalid portable argv (apostrophes/control characters or more than 8 KiB), unavailable config/cwd, or disabled Herdr restore prevents automatic restoration. Ordinary lifecycle reporting remains best effort.
- Use an evot build containing direct-ID startup lookup: older evot builds may fail to restore sessions outside their recent 20-session startup list. The matching evot change is required; upgrading this adapter alone does not fix that limitation.

Test in a disposable session, not your working session:

1. Start `herdr --session evot-restore-test` and run `evot-herdr` in a pane.
2. Send a prompt, then inspect the pane with `herdr pane get "$HERDR_PANE_ID"`.
3. From another terminal run `herdr session stop evot-restore-test`.
4. Reopen `herdr --session evot-restore-test`; the same conversation should appear without submitting new work.
5. Quit evot explicitly and repeat the restart; it should remain an ordinary shell.

## Event protocol

The hook accepts one JSON object per line. An event must:

- have `version: 1`;
- use a supported event name;
- use `working`, `blocked`, or `idle` for `state_changed.state`;
- use strings for optional textual fields such as `session_id`, `run_id`, and `message`.

Malformed, unsupported, and semantically invalid lines are ignored without terminating the reader. A single NDJSON record is limited to 1 MiB; an oversized record is discarded incrementally, and parsing resumes at the next newline.

Example stream:

```ndjson
{"version":1,"event":"session_started","session_id":"sid-1","cwd":"/workspace/demo"}
{"version":1,"event":"run_started","session_id":"sid-1","run_id":"run-1"}
{"version":1,"event":"state_changed","session_id":"sid-1","state":"blocked","message":"Approve the command"}
{"version":1,"event":"run_finished","session_id":"sid-1","run_id":"run-1"}
{"version":1,"event":"session_ended","session_id":"sid-1","reason":"completed"}
```

Supported events are `session_started`, `state_changed`, `run_started`, `run_finished`, `run_failed`, and `session_ended`.

## Herdr mapping

| evot event | Herdr action |
| --- | --- |
| `session_started` | Report `idle`, then register `session_id` and restore argv when supported. |
| `run_started` | Report `working`. |
| `state_changed` | Report the supplied state and message. |
| `run_finished` | Report `idle`. |
| `run_failed` | Report `idle`, including the failure message when supplied. |
| `session_ended` | Release and clear state, except `reason: session_changed` (the replacement session keeps ownership). |
| EOF / `SIGINT` / `SIGTERM` | Best-effort release when the hook has handled lifecycle activity. |

The table above describes legacy CLI commands. In herdr-app/core mode, lifecycle events produce OSC 7501 reports with `app=evot` and the same `working` / `blocked` / `idle` mapping; `session_ended` (except `session_changed`), EOF, and handled signals produce `state=clear`. Messages are UTF-8/base64 encoded and bounded. Session IDs and resume argv are not part of OSC status reports.

Every legacy CLI command includes source `custom:evot`, agent `evot`, and a monotonic `--seq` value. Each hook reserves a persistent sequence block when it starts, fencing late updates from older overlapping hooks. This prevents an old hook's delayed `release-agent` from clearing a newer session. The generation is stored under `$XDG_STATE_HOME/evot-herdr/sequence` (normally `~/.local/state/evot-herdr/sequence`) on POSIX systems and under `%LOCALAPPDATA%\evot-herdr\sequence` on Windows. If this state cannot be safely persisted, Herdr reporting is disabled for that hook rather than risking stale updates or affecting evot.

Repeated state reports are suppressed only after the preceding Herdr command succeeds. Failed state and session commands remain eligible for retry on the next event; failed explicit releases are retried during shutdown.

Herdr calls are best effort and do not terminate evot. Each call has a bounded timeout. On POSIX systems, the hook starts each Herdr command in a separate process group and terminates the full group on timeout; Windows uses `taskkill /T /F` for process-tree cleanup.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm pack
```

The scripts also work with `npm run typecheck`, `npm test`, and `npm pack`. Vitest runs tests on Node.js; TypeScript compiles during `prepare` (including source-checkout installs) and build/pack steps. The installable tarball contains `bin/` and compiled `dist/`, with no runtime dependency on development tools.

Run `npm run test:source` to verify the documented clone/install/link workflow from a clean local Git snapshot without prebuilt `dist/` or `node_modules/`. This test needs Git and access to the npm registry for build-time dependencies; it does not publish anything or change your global installation.

Tests use injected runners and temporary executables; a live Herdr installation is not required. The suite covers lifecycle mapping, failure retries, EOF and signal cleanup, process-tree timeouts, protocol validation, wrapper exit status, wrapper/hook mode selection, and non-TTY wrapper execution.

Main files:

- [`src/index.ts`](src/index.ts): adapter, protocol validation, restore registration, and wrapper logic.
- [`src/process.ts`](src/process.ts): Node.js process execution, bounded CLI queries, signal exit status, and process-tree cleanup.
- [`src/app.ts`](src/app.ts): OSC 7501 mapping, private terminal bridge, stale-hook fencing, and POSIX plain-hook terminal fallback.
- [`tests/app.test.ts`](tests/app.test.ts): App lifecycle, bridge failures, detached hooks, and real POSIX PTY coverage (requires `python3`; skipped when unavailable).
- [`bin/evot-herdr`](bin/evot-herdr): single entry point; selects wrapper or hook mode.
- [`tests/adapter.test.ts`](tests/adapter.test.ts): unit and process-level regression tests.
- [`tests/resume.test.ts`](tests/resume.test.ts): restore argv, capability detection, shutdown boundary, config preservation, and old-version compatibility.
