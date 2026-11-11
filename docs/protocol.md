# Protocol reference

[← README](../README.md) · [Herdr setup](herdr.md) · [Configuration](configuration.md)

This page describes terminal hook reporting. [ACP mode](t3-code.md#permissions-and-transport) is a separate native JSON-RPC stdio path; it never consumes these events or creates a Herdr bridge.

## Hook invocation

`bin/evot-bridge` serves as both wrapper and hook. evot launches its hook with no arguments and a piped stdin. The executable selects hook mode only when **all** of these conditions hold:

1. `EVOT_SESSION_HOOK` resolves to this executable, including an absolute/relative path, a PATH command, or a symlink.
2. No command-line arguments were given.
3. stdin is not a TTY.

Otherwise it launches evot. `evot-bridge --help </dev/null` and ordinary interactive wrapper invocations therefore still start evot. Hook mode never spawns evot, preventing recursion.

The ambiguous case is a wrapper invocation with a self-referenced hook, no arguments, and piped stdin; pass an argument (for example `-p`) when launching the wrapper that way. Explicit `acp` always selects protocol mode, even with a self-referenced hook.

To feed an event stream manually from a checkout:

```bash
EVOT_SESSION_HOOK="$PWD/bin/evot-bridge" \
HERDR_PANE_ID=w1:p1 \
HERDR_BIN_PATH=/path/to/herdr \
"$PWD/bin/evot-bridge" < events.ndjson
```

## Event format

The hook accepts one JSON object per line. Each event must:

- have `version: 1` and a supported event name;
- use `working`, `blocked`, or `idle` for `state_changed.state`;
- use strings for optional textual fields such as `session_id`, `run_id`, and `message`.

Malformed, unsupported, and semantically invalid lines are ignored without terminating the reader. A single NDJSON record is limited to 1 MiB; oversized records are discarded incrementally and parsing resumes at the next newline.

```ndjson
{"version":1,"event":"session_started","session_id":"sid-1","cwd":"/workspace/demo"}
{"version":1,"event":"run_started","session_id":"sid-1","run_id":"run-1"}
{"version":1,"event":"state_changed","session_id":"sid-1","state":"blocked","message":"Approve the command"}
{"version":1,"event":"run_finished","session_id":"sid-1","run_id":"run-1"}
{"version":1,"event":"session_ended","session_id":"sid-1","reason":"completed"}
```

## Lifecycle mapping

| evot event | Legacy Herdr action |
| --- | --- |
| `session_started` | Report `idle`, then register `session_id` and restore argv when supported. |
| `run_started` | Report `working`. |
| `state_changed` | Report the supplied state and message. |
| `run_finished` | Report `idle`. |
| `run_failed` | Report `idle`, including the failure message when supplied. |
| `session_ended` | Release and clear state, except `reason: session_changed` (the replacement session keeps ownership). |
| EOF / `SIGINT` / `SIGTERM` | Best-effort release after the hook has handled lifecycle activity. |

Herdr-app/core uses the same working/blocked/idle mapping, with `state=clear` for exit cleanup. OSC reporting does not include session IDs or restore argv.

## App reporting

Herdr-app/core receives OSC 7501 reports with `app=evot`. Messages are UTF-8/base64 encoded and bounded.

A direct print from the hook cannot reliably reach the terminal: evot launches hooks detached with stdout/stderr discarded. The wrapper instead:

1. Creates a private local socket, or a named pipe on Windows.
2. Accepts bounded structured hook reports.
3. Uses sequence generations to fence late updates.
4. Writes OSC to its own terminal and clears status on child exit, even if evot did not wait for its hook.

No OSC bytes are written into redirected stdout/stderr files.

On POSIX, a plain evot hook has a best-effort fallback: use `ps` to resolve the parent evot process's terminal and write to that character device. Missing terminals, unavailable `ps`, nested multiplexers, and overlapping hooks can prevent reliable reporting. Windows has no equivalent plain-hook fallback; use the wrapper.

## Sequence fencing and failure handling

Every legacy CLI command includes source `custom:evot`, agent `evot`, and a monotonic `--seq` value within Herdr's signed 64-bit range.

Each hook reserves a persistent sequence block when it starts. A newer hook reserves a higher block, so a late `release-agent` from an older hook cannot clear the new session. The [shared state directory](configuration.md#why-the-state-directory-still-says-evot-herdr) intentionally retains its legacy name across the rename.

If sequence state cannot be safely persisted, reporting is disabled for that hook rather than risking stale updates or affecting evot.

- Repeated state reports are suppressed only after the preceding Herdr command succeeds.
- Failed state/session commands can retry on the next event; failed explicit releases retry during shutdown.
- Herdr calls are best effort and do not terminate evot.
- Each CLI call has a bounded timeout. On POSIX, the hook starts commands in separate process groups and kills the full group on timeout; Windows uses `taskkill /T /F`.
