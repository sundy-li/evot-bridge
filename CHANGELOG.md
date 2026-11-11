# Changelog

## 0.3.0 (unreleased)

- Rename the project/package to `evot-bridge` / `@evotai/evot-bridge` and install only `evot-bridge`. Migrate Herdr/hook executable paths and T3 settings (`evot-bridge` plus argument `acp`).
- Prefer `EVOT_BRIDGE_*` settings while accepting legacy `EVOT_HERDR_*` aliases; retain the shared legacy sequence allocator to preserve stale-hook fencing during upgrades.
- Use a single `evot-bridge` entry point: terminal integration by default and `evot-bridge acp` for T3 Code's Local ACP command, launching evot's native ACP server with byte-transparent stdio, inherited-hook isolation, and no pane discovery or OSC output.
- Preserve native tool approval defaults, literal argv, session/model operations, child exit status, and client shutdown signals; document ACP v1 negotiation and unsupported MCP/image/audio features.
- Verify ACP mode in transport regressions, offline package installation, and source install/link checks; install and package only the `evot-bridge` executable.
- Support herdr-app / herdr-core (`hc`) terminals through automatic `HC_TERMINAL_ID` detection and OSC 7501 status reports, while retaining legacy CLI integration.
- Relay detached session hooks through a private wrapper-owned terminal bridge; fence stale hooks, bound reports, encode messages safely, and clear status when evot exits.
- Support directly configured POSIX hooks by resolving the parent evot terminal; recommend the wrapper for reliable cleanup and Windows support.
- Document App launcher configuration and the status-only boundary: legacy automatic conversation restore is not available through the App/core OSC protocol.
- Add App lifecycle, IPC failure, detached-hook, and real POSIX PTY regression tests.
- Recommend GitHub source installation instead of an unpublished npm registry package; build automatically through `prepare` and test clean Git installs without prebuilt output.

## 0.2.0

- Replace the Bun runtime and test runner with Node.js 22.12+, TypeScript build output, and Vitest. The installable package has no runtime dependencies.
- Report `evot-herdr --resume <full-session-id>` to Herdr 0.9.2+ so panes can restore saved conversations after a server restart.
- Detect restore-argv support from the Herdr CLI; keep lifecycle and identity reporting on older versions.
- Preserve a wrapper-started `--env-file` as an absolute restore argument without persisting config contents or prompt text.
- Keep pane ownership across session switches; retain explicit-exit and EOF/signal release behavior.
- Register restore commands only after a successful ownership report, and retry failed registrations.
- Port executable discovery, signal exit status, bounded queries, and process-tree timeout cleanup to Node.js.
- Sync sequence generations before atomic replacement, and reject invalid process IDs before group cleanup.

Automatic restore requires Herdr 0.9.2+, a persisted evot conversation, both executables on the restored shell's PATH, and agent restore enabled. It restores context without automatically rerunning interrupted tools. Install the accompanying evot direct-ID lookup fix to resume sessions outside the old 20-session startup window.
