# Development

[← README](../README.md) · [Protocol reference](protocol.md)

## Build and test

From a checkout with Node.js 22.12+:

```bash
npm install --include=dev --legacy-peer-deps
npm run typecheck
npm test -- --no-file-parallelism
npm run test:docs
npm run test:package
npm run test:source
```

The serial Vitest option reduces timing contention in process-timeout tests. Tests use injected runners and temporary executables; no live Herdr installation is required. POSIX PTY coverage needs `python3` and is skipped when unavailable.

If you use pnpm:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test --no-file-parallelism
```

TypeScript compiles during `prepare`, `build`, and `prepack`. The CLI runs compiled `dist/` files, not TypeScript. Vitest runs on Node.js; Bun is not required.

## Installation and packaging checks

- `npm run test:docs` checks local Markdown links and heading anchors in README, changelog, and `docs/`.
- `npm run test:package` builds and packs locally, installs the tarball offline in a temporary prefix, checks packaged documentation links, and exercises terminal hooks, resume argv, exit status, and ACP transport.
- `npm run test:source` snapshots source inputs into a temporary Git repository, then clones, installs, and links it without prebuilt `dist/` or `node_modules/`. It also checks installed documentation. Git and npm registry access for build-time dependencies are required.
- Both installation checks use temporary prefixes; they do not change your global installation or publish anything.

To inspect a tarball manually, run `npm pack`. It includes `bin/`, compiled `dist/`, README, changelog, and `docs/`, with no runtime dependency on development tools. There is no npm registry release; the supported user install is a [GitHub source checkout](installation.md).

## Coverage

The suite covers lifecycle mapping, failure retries, EOF/signal cleanup, process-tree timeouts, protocol validation, wrapper exit status, hook selection, non-TTY execution, App bridge behavior, legacy-variable compatibility, stale pre-rename hook migration, and ACP transport isolation.

The ACP fixture tests byte-transparent transport and approval-message forwarding; it is not a replacement for native evot or T3 GUI testing. Native evot was separately exercised against a local mock model, including v2→v1 negotiation, model selection, streaming, tool approval/execution, cancellation, resume/list/close, and EOF. These checks made no external model requests.

## Source map

Source links open the GitHub checkout, since source/test files are not shipped in the installable package.

| File | Responsibility |
| --- | --- |
| [`src/index.ts`](https://github.com/sundy-li/evot-bridge/blob/main/src/index.ts) | Adapter selection, event validation, resume registration, wrapper logic, and ACP dispatch. |
| [`src/app.ts`](https://github.com/sundy-li/evot-bridge/blob/main/src/app.ts) | OSC 7501 mapping, private terminal bridge, sequence fencing, and POSIX parent-terminal fallback. |
| [`src/process.ts`](https://github.com/sundy-li/evot-bridge/blob/main/src/process.ts) | Process execution, bounded queries, signal status, and process-tree cleanup. |
| [`bin/evot-bridge`](https://github.com/sundy-li/evot-bridge/blob/main/bin/evot-bridge) | Single terminal/hook/ACP entry point. |
| [`tests/adapter.test.ts`](https://github.com/sundy-li/evot-bridge/blob/main/tests/adapter.test.ts) | Lifecycle and process regressions. |
| [`tests/app.test.ts`](https://github.com/sundy-li/evot-bridge/blob/main/tests/app.test.ts) | App lifecycle, bridge failures, detached hooks, and real PTY coverage. |
| [`tests/acp.test.ts`](https://github.com/sundy-li/evot-bridge/blob/main/tests/acp.test.ts) | Clean stdio, hook/OSC isolation, argv, failures, and shutdown. |
| [`tests/compat.test.ts`](https://github.com/sundy-li/evot-bridge/blob/main/tests/compat.test.ts) | Legacy aliases, new-name precedence, and cross-version fencing. |
| [`tests/resume.test.ts`](https://github.com/sundy-li/evot-bridge/blob/main/tests/resume.test.ts) | Restore argv, capability checks, config preservation, and older CLI support. |
