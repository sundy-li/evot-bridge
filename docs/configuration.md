# Configuration and migration

[← README](../README.md) · [Herdr setup](herdr.md) · [T3 Code setup](t3-code.md)

Most installations only need `evot-bridge` for terminal integration or `evot-bridge acp` for ACP. Configure evot's models and credentials in evot itself.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVOT_BIN_PATH` | `evot` | evot executable path or command name. |
| `EVOT_SESSION_HOOK` | Package's `bin/evot-bridge` | Hook passed to terminal evot. Custom values are preserved, except removed pre-rename launchers described below. ACP mode removes it. |
| `HERDR_PANE_ID` | Discover current legacy pane | Explicit legacy pane identifier; takes precedence over App detection. |
| `HC_TERMINAL_ID` | Supplied by `hc` | Selects App/core reporting without an explicit legacy pane. Do not set manually. |
| `HERDR_BIN_PATH` | `herdr` | Legacy Herdr executable path or command name; not required for herdr-app. |
| `HERDR_COMMAND_TIMEOUT_MS` | `2000` | Positive integer timeout for legacy pane discovery, capability detection, and each Herdr update. Timed-out process trees are terminated. |
| `EVOT_BRIDGE_RESUME_COMMAND` | `evot-bridge` | Plain command name on PATH for legacy restore. Set to `evot` only if the restored shell already configures the hook. Absolute executable paths are not portable restore commands. |
| `EVOT_BRIDGE_ENV_FILE` | Unset | Config to add as `--env-file` to legacy restore. Wrapper startup captures `--env-file` as an absolute path; set explicitly for plain evot with non-default config. |
| `EVOT_BRIDGE_SEQUENCE_STATE_PATH` | User state directory | Persistent fencing-sequence file. Mainly a test/portable-install override. |
| `EVOT_BRIDGE_APP_SOCKET` / `EVOT_BRIDGE_APP_TERMINAL_ID` | Wrapper-managed | Internal private App bridge and owning core terminal. Inherited bridges are not reused across different core terminals. Do not configure manually. |

The corresponding `EVOT_HERDR_*` settings remain fallback aliases. A non-empty `EVOT_BRIDGE_*` value takes precedence over its legacy equivalent. Terminal wrappers mirror their managed App bridge and captured env-file values for older hooks; ACP mode removes App bridge values from both namespaces.

## Select a local evot build

```bash
EVOT_BIN_PATH=/absolute/path/to/evot evot-bridge
```

For T3, set `EVOT_BIN_PATH` in the provider's environment overrides. The executable and configuration must exist on the T3 server's machine.

## Migration from evot-herdr

The project/package is now **evot-bridge** / `@evotai/evot-bridge`. It installs one executable; there is no npm registry release.

1. Update your checkout's remote if it still uses the old URL:
   ```bash
   git remote set-url origin https://github.com/sundy-li/evot-bridge.git
   ```
2. [Update and rebuild](installation.md#update), then run `npm link` to register the new command. Update any manually created launcher symlinks.
3. Replace old Herdr program `run` / `match` entries with `evot-bridge`.
4. Update exported hook paths in `~/.zshrc`, `~/.bashrc`, or other shell configuration. For plain evot, a typical setting is:
   ```bash
   export EVOT_SESSION_HOOK="$(command -v evot-bridge)"
   ```
5. In T3, replace the old command or shortcut with Executable `evot-bridge` and a separate argument row `acp`.
6. After updating the settings, remove stale old launchers. Open a new terminal and restart evot; refreshing T3 starts a new ACP process.

You can migrate `EVOT_HERDR_*` variables to `EVOT_BRIDGE_*` gradually; legacy aliases continue to work. Existing portable restore records may still name the old executable. Restart the wrapper and establish a saved session to register a new restore command before relying on another Herdr server restart.

## Agent missing after an upgrade

A shell can retain an exported hook pointing at a removed executable, for example:

```text
/old/checkout/bin/evot-herdr
```

The current terminal wrapper automatically replaces missing legacy `evot-herdr` launchers with itself. Existing legacy installations and unrelated custom hooks are left unchanged. Updating the shell setting is still necessary if you launch plain `evot`, because it does not run this wrapper's migration logic.

For a clean wrapper launch in the current shell:

```bash
env -u EVOT_SESSION_HOOK evot-bridge
```

Or, from the checkout:

```bash
env -u EVOT_SESSION_HOOK ./bin/evot-bridge
```

The first form requires `evot-bridge` on PATH; use the checkout-relative form otherwise. Existing evot processes retain their startup environment; exit and restart them after changing hooks.

## Why the state directory still says evot-herdr

The default sequence file remains `$XDG_STATE_HOME/evot-herdr/sequence` (normally `~/.local/state/evot-herdr/sequence`) on POSIX and `%LOCALAPPDATA%\evot-herdr\sequence` on Windows.

This is intentional: old and new hooks must share the allocator so late reports from pre-rename processes cannot override current status. Do not delete or reset this file while hooks may still be running. See [sequence fencing](protocol.md#sequence-fencing-and-failure-handling).
