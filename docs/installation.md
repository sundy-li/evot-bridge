# Installation and updates

[← README](../README.md)

## Requirements

- Node.js 22.12+, npm, and Git for the recommended source installation.
- An installed `evot` on `PATH`, or an explicit `EVOT_BIN_PATH`.
- For Herdr: evot's `EVOT_SESSION_HOOK` support and either herdr-app/core or legacy Herdr CLI. See [Herdr setup](herdr.md).
- For T3 Code: evot's `acp` command (verified with evot `2026.11.11`) and a T3 build supporting **Local ACP command**. See [T3 setup](t3-code.md).

The installed CLI runs compiled JavaScript with Node.js. It has no runtime npm dependencies and does not require Bun or tsx.

## Recommended: GitHub source checkout

```bash
git clone https://github.com/sundy-li/evot-bridge.git
cd evot-bridge
npm install --include=dev --legacy-peer-deps
npm link
```

There is no npm registry release; no npm login or `@evotai` scope permission is required. `npm install` installs build-time dependencies and runs `prepare` to compile `dist/` automatically.

- Keep `--include=dev`: TypeScript is needed to build from source.
- Keep `--legacy-peer-deps`: it avoids npm resolver failures involving the test runner's optional browser/devtools peers. Those integrations are not needed by the CLI.
- Do not use `--ignore-scripts` for the source install: the launcher needs the generated `dist/` files.
- Avoid `npm install -g <Git URL>`: some npm versions propagate global-install settings into the Git dependency's build and fail to install its build-time dependencies.

`npm link` makes `evot-bridge` available on `PATH`. Keep the source checkout in place. Then configure [Herdr](herdr.md) or [T3 Code](t3-code.md).

## Without a global link

After installing/building, use the launcher directly:

```bash
./bin/evot-bridge
./bin/evot-bridge acp
```

For T3, use the launcher's **absolute path** and a separate `acp` argument row. Alternatively, add the checkout's `bin/` directory to `PATH` or create a symlink to its launcher.

**Do not copy `bin/evot-bridge` into another directory by itself.** It imports `../dist/index.js`. A copied launcher can fail with `ERR_MODULE_NOT_FOUND` even though the checkout was built correctly. See [connection troubleshooting](t3-code.md#troubleshooting).

## Update

In the same checkout:

```bash
git pull --ff-only
npm install --include=dev --legacy-peer-deps
```

The existing link still points to this checkout. Restart running evot processes to apply hook changes, and refresh the T3 provider to start a new ACP process.

## Pin a revision

Run `git checkout <commit-sha>` before installing. To resume tracking main later, switch back to `main` and follow the update steps above.

## Using pnpm

```bash
pnpm install --frozen-lockfile
pnpm run build
```

Add the checkout's `bin/` directory to `PATH` or use its absolute launcher path. The CLI runs `dist/`, not TypeScript source.

## Migrating an existing installation

If you used evot-herdr or the former T3 shortcut, follow the [migration checklist](configuration.md#migration-from-evot-herdr) before removing old launchers.
