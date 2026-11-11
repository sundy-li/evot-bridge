# T3 Code / ACP

[← README](../README.md) · [Installation](installation.md) · [Configuration](configuration.md)

T3 Code already supports local ACP agents. No T3 provider patch or ACP Registry entry is necessary. Use a build with **Local ACP command** and an evot version with `evot acp` support (verified with evot `2026.11.11`).

## Add the provider

1. Install evot-bridge and run `npm link`, or use the launcher's absolute path.
2. Configure evot's models and credentials as you would for terminal evot.
3. Open **Settings → Providers → Add provider → Show more → Local ACP command**.
4. Enter the following settings and refresh the provider.

| Setting | Value |
| --- | --- |
| Display name | `evot` |
| Executable | `evot-bridge` or `/absolute/path/to/evot-bridge/bin/evot-bridge` |
| Arguments | One separate row containing `acp` |

Do not put `evot-bridge acp` together in the Executable field. Without `acp`, the launcher starts terminal evot rather than an ACP server.

Node.js, evot, and evot-bridge must be available on the **T3 server's machine/PATH**, not merely on a remote browser's machine. `EVOT_BIN_PATH` can select a specific evot executable in the provider's environment overrides.

## Additional arguments

Put each argument in a separate literal row, after `acp`. For example:

```text
acp
--env-file
/absolute/path/to/evot.env
--permission
ask
```

This launches the equivalent of:

```bash
evot acp --env-file /absolute/path/to/evot.env --permission ask
```

Paths with spaces are forwarded unchanged. T3 argument rows do not perform shell expansion: use an actual absolute path, not `~` or `$HOME`, and do not add shell quotes around it.

## Permissions and transport

- Use evot's own model configuration and credentials; the wrapper does not implement login or copy credentials.
- evot defaults to `--permission ask`. The wrapper never forces `allow`; T3's thread permission mode handles ACP approval requests.
- Tools execute in evot, not Herdr. Use `--tools readonly` or `--tools none` if appropriate.
- stdin/stdout pass through byte-for-byte. Streaming notifications and client permission replies are not interpreted or translated; diagnostics remain on stderr.
- ACP mode removes inherited `EVOT_SESSION_HOOK` and App bridge variables from both the current and legacy namespaces. It skips pane discovery, sequence allocation, and OSC bridges.
- Child exit status and shutdown signals are preserved. No lifecycle status is sent to Herdr, even when T3 runs in an `hc` terminal.

## Capability limits

These reflect the verified evot ACP v1 implementation; T3 can use the capabilities advertised by the installed evot.

| Feature | Current behavior |
| --- | --- |
| Protocol negotiation | T3 requests v2 and accepts evot's v1 response. The wrapper does not emulate v2-only features. |
| Sessions and models | `session/new`, `session/prompt`, `session/cancel`, `session/resume`, `session/list`, `session/close`, and model selection through `session/set_config_option`. |
| Resume and history | Native resume is supported, but `loadSession: false` means no `session/load` transcript replay. T3 keeps its own thread history. |
| Ephemeral sessions | `--ephemeral` keeps sessions in memory; they cannot be restored across process restarts. |
| MCP / client terminals | evot currently ignores `mcpServers`. T3-injected MCP tools, scheduling/delegation through those tools, and client-owned terminals are not enabled here. |
| Images, audio, rewind | Not added by this wrapper. T3's file checkpoint rollback does not rewind evot's conversation. |

See [T3 Code's ACP guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-acp.md) for the provider UI and permission behavior. Automated transport tests do not replace a real T3 UI test.

## Troubleshooting

### “Limited. The ACP agent could not create a test session”

This is a generic probe failure. Check T3's server logs for the underlying error. On the tested macOS installation they are under `~/.t3/userdata/logs/`.

If the log contains `ERR_MODULE_NOT_FOUND` for `~/.local/dist/index.js`, a copied launcher is shadowing the real installation:

1. Check which `evot-bridge` resolves on the **server's** PATH.
2. Back up the copied launcher before replacing it.
3. Use `npm link`, a symlink to the checkout's launcher, or its absolute path. Keep the package layout intact.
4. Verify the source checkout was built; run the [install steps](installation.md#recommended-github-source-checkout) if needed.
5. Refresh the provider, or disable and re-enable it to repeat the probe.

For other failures, verify that Node.js and evot are accessible to T3, that `acp` is a separate argument, and that any `--env-file` path is absolute and readable.

### Old provider command after renaming

Replace `evot-herdr` or the former `evot-t3code` shortcut with Executable **`evot-bridge`** and one argument row **`acp`**. See the [migration checklist](configuration.md#migration-from-evot-herdr).
