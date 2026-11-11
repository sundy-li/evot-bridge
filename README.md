# evot-bridge

Connect [evot](https://github.com/sundy-li/evot) to [herdr-app](https://github.com/herdrdev/herdr-app), legacy [Herdr CLI](https://herdr.dev), and [T3 Code](https://github.com/pingdotgg/t3code) with one command.

| Command | Use it for |
| --- | --- |
| `evot-bridge` | Run terminal evot with Herdr lifecycle reporting. |
| `evot-bridge acp` | Run evot's native ACP server for T3 Code and other ACP clients. |

No T3 fork or protocol translation is required. ACP mode preserves native stdio and approval defaults, without Herdr hooks or OSC output.

## Install from GitHub

You need **Node.js 22.12+**, npm, Git, and an installed `evot`. Configure evot's models and credentials before connecting a client. Herdr needs evot's session-hook support; T3 needs `evot acp` support.

```bash
git clone https://github.com/sundy-li/evot-bridge.git
cd evot-bridge
npm install --include=dev --legacy-peer-deps
npm link
```

There is no npm registry release. Installation builds `dist/` automatically; no npm login, publishing permission, or Bun is needed. Keep the checkout in place after `npm link`.

Without `npm link`, use `/absolute/path/to/evot-bridge/bin/evot-bridge`. **Do not copy the launcher by itself**: it needs the package's `dist/` directory. Avoid `npm install -g <Git URL>`; use the checkout workflow above.

[Updates, pinned revisions, and alternative installs →](docs/installation.md)

## Choose your integration

### herdr-app / Herdr CLI

Inside a herdr-app or legacy Herdr terminal, run:

```bash
evot-bridge
```

The wrapper starts evot and reports working, approval-blocked, and idle states. It automatically detects herdr-app via `HC_TERMINAL_ID`; an explicit `HERDR_PANE_ID` selects legacy CLI instead. The legacy `herdr` executable is not needed for herdr-app.

Arguments are forwarded unchanged:

```bash
evot-bridge --resume <session-id>
EVOT_BIN_PATH=/path/to/evot evot-bridge
```

Automatic conversation restore is supported only with legacy Herdr CLI 0.9.2+, not herdr-app. Restart running evot processes after installing or changing the integration.

[App launcher configuration, plain-evot hooks, and legacy restore →](docs/herdr.md)

### T3 Code

In **Settings → Providers → Add provider → Show more → Local ACP command**, enter:

| Setting | Value |
| --- | --- |
| Display name | `evot` |
| Executable | `evot-bridge` or its absolute path |
| Arguments | One separate row containing `acp` |

Do not put `evot-bridge acp` together in the Executable field. Node.js, evot, and the wrapper must be available on the **T3 server's machine**, not just the browser's machine.

Use evot's existing model configuration and credentials. Native approval defaults are preserved; the wrapper never forces `allow`.

[Additional arguments, ACP capabilities, and troubleshooting →](docs/t3-code.md)

## More documentation

| Guide | Contents |
| --- | --- |
| [Installation](docs/installation.md) | Source installation, updates, and build requirements. |
| [Herdr integration](docs/herdr.md) | App launcher, direct hooks, and legacy conversation restore. |
| [T3 Code / ACP](docs/t3-code.md) | Provider setup, permissions, capability limits, and connection failures. |
| [Configuration and migration](docs/configuration.md) | Environment variables and migration from evot-herdr. |
| [Protocol reference](docs/protocol.md) | Hook events, lifecycle mapping, OSC reporting, and stale-hook fencing. |
| [Development](docs/development.md) | Build, tests, packaging, and source layout. |
| [Changelog](CHANGELOG.md) | Version history. |

Previously installed as **evot-herdr**? Update executable paths to `evot-bridge`; old `EVOT_HERDR_*` variables remain supported. See the [migration checklist](docs/configuration.md#migration-from-evot-herdr).
