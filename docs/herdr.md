# Herdr integration

[← README](../README.md) · [Configuration](configuration.md) · [Protocol reference](protocol.md)

[Install evot-bridge](installation.md) first. Both integrations use the same terminal wrapper:

```bash
evot-bridge
```

The wrapper sets `EVOT_SESSION_HOOK` unless a custom hook is already configured, starts evot with inherited stdio, and preserves its exit status. Arguments are forwarded unchanged. A spawn failure is printed to stderr and returns `127`.

## herdr-app / herdr-core

Run the wrapper inside a core-managed terminal. `hc` supplies `HC_TERMINAL_ID`; do not set it manually. The adapter reports working, approval-blocked, and idle states in the App's agents view using OSC 7501.

No `HERDR_PANE_ID`, `HERDR_BIN_PATH`, or legacy `herdr` command is needed. An explicit `HERDR_PANE_ID` takes precedence, allowing legacy Herdr nested inside an `hc` terminal.

### Add evot to the App launcher

Merge this entry into the `programs` object in `~/.config/herdr-app/programs.json` (or `$HERDR_APP_HOME/programs.json`), preserving other entries:

```json
{
  "programs": {
    "evot": {
      "name": "evot",
      "run": ["evot-bridge"],
      "match": ["evot-bridge"]
    }
  }
}
```

Keep `evot-bridge`, `evot`, and Node.js on the shell's `PATH`. Restart existing evot processes after upgrading the adapter.

### Status reporting and restore limits

Prefer the wrapper: it relays detached hook reports through a private socket/named pipe, fences stale updates, and clears status on child exit. It does not write OSC bytes into redirected stdout/stderr files. See [how App reporting works](protocol.md#app-reporting).

On POSIX, a plain evot hook can resolve the parent terminal as a best-effort fallback. Missing parent terminals, unavailable `ps`, nested terminal multiplexers, and overlapping hooks can make that unreliable. On Windows, use the wrapper; plain detached hooks have no POSIX terminal fallback.

The App/core OSC protocol exposes status, not legacy Herdr's resume-argv API. **Automatic conversation restore is not registered with herdr-app.** Resume saved conversations manually:

```bash
evot-bridge --resume <session-id>
```

## Legacy Herdr CLI

Run `evot-bridge` in a Herdr-managed pane with `herdr` on `PATH`, or set `HERDR_BIN_PATH`. The wrapper and directly launched hook discover the current pane when `HERDR_PANE_ID` is absent.

Older Herdr versions receive lifecycle reports. Herdr 0.9.2+ is required for automatic conversation restore; support is detected from CLI capabilities rather than a hard-coded version check.

### Automatic conversation restore

Start evot through the wrapper and send at least one prompt so a persisted session exists. The adapter registers the full session ID and a portable restore argv:

```text
evot-bridge --resume <full-session-id> [--env-file /absolute/config.env]
```

Each pane gets its own conversation; no global “latest session” lookup is used. Keep `evot-bridge`, `evot`, and Node.js on the restored shell's `PATH`, and persist any custom `EVOT_BIN_PATH` in that shell. Wrapper mode captures `--env-file` automatically as an absolute path.

Herdr resumes agents by default. If disabled, enable this in `~/.config/herdr/config.toml` and reload/restart Herdr:

```toml
[session]
resume_agents_on_restore = true
```

- **Detach:** the Herdr server and evot processes keep running; no restore is necessary.
- **Server restart:** reattach the same Herdr session. Herdr restores the pane's cwd and runs the registered command after a client attaches.
- **Explicit `/exit`:** clears automatic restore. Session switches replace the target without releasing pane ownership.
- **EOF/signals:** still attempt cleanup. Herdr saves its shutdown snapshot before shutting down panes and rejects late reports.

This restores **saved conversation context**, not a running process or tool call. It does not submit a prompt or replay interrupted commands. Unsaved streaming output, forced power loss, and OS shutdown races are not guaranteed recoverable.

Restore can fail when the executable is missing from `PATH`, config/cwd is unavailable, resume is disabled, or portable argv contains apostrophes/control characters or exceeds 8 KiB. Ordinary lifecycle reporting remains best effort.

Use an evot build with direct-ID startup lookup. Older builds may fail to restore sessions outside their recent 20-session startup list; upgrading only this adapter does not fix that evot limitation.

### Test restore safely

Use a disposable session, not your working session:

1. Start `herdr --session evot-restore-test` and run `evot-bridge` in a pane.
2. Send a prompt, then inspect the pane with `herdr pane get "$HERDR_PANE_ID"`.
3. From another terminal run `herdr session stop evot-restore-test`.
4. Reopen `herdr --session evot-restore-test`; the same conversation should appear without submitting new work.
5. Quit evot explicitly and repeat the restart; it should remain an ordinary shell.

## Plain evot with a shell hook

If you prefer launching `evot` directly, export the hook in your shell configuration:

```bash
# ~/.zshrc
export EVOT_SESSION_HOOK="$(command -v evot-bridge)"
```

Use a POSIX terminal for herdr-app's plain-hook fallback; prefer the wrapper for reliable cleanup and fencing.

Hook mode requires all three signals: a self-referenced `EVOT_SESSION_HOOK`, no arguments, and piped stdin. Consequently, running the wrapper with those same conditions is ambiguous; pass an argument (for example `-p`) in that situation. See [hook invocation rules](protocol.md#hook-invocation).

Outside a Herdr pane or `hc` terminal, hook pane discovery fails harmlessly and reporting stays inert; the hook still reserves a sequence generation. ACP mode is separate: `evot-bridge acp` removes inherited hooks and never reports Herdr status.
