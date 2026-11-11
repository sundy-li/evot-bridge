import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  bridgeReporter, encodeAppReport, EvotBridgeAppAdapter, startAppBridge,
  type AppReport,
} from '../src/app.js'
import { createSessionAdapter, EvotBridgeAdapter, isAppTerminal, runAdapter } from '../src/index.js'
import { spawnCommand } from '../src/process.js'

const executable = fileURLToPath(new URL('../bin/evot-bridge', import.meta.url))
const event = (name: string, extra = {}) => JSON.stringify({ version: 1, event: name, ...extra })
const osc = (state: string) => `\x1b]7501;state=${state}:app=evot\x1b\\`
async function* lines(...values: string[]) { yield* values }

function recorder(fail = false) {
  const reports: AppReport[] = []
  const adapter = new EvotBridgeAppAdapter(async report => { reports.push(report); return !fail }, 1_000_000n)
  return { adapter, reports }
}

describe('herdr-app lifecycle', () => {
  test('maps states and clears once at EOF without legacy CLI commands', async () => {
    const { adapter, reports } = recorder()
    await runAdapter(lines(
      event('session_started'), event('run_started'),
      event('state_changed', { state: 'blocked', message: 'Approve?' }),
      event('run_finished'), event('session_ended'),
    ), adapter)
    expect(reports.map(r => r.state)).toEqual(['idle', 'working', 'blocked', 'idle', 'clear'])
    expect(reports[2]?.message).toBe('Approve?')
    expect(reports.map(r => r.sequence)).toEqual(['1000001', '1000002', '1000003', '1000004', '1000005'])
  })

  test('deduplicates states, but replaces messages and resets for a new session', async () => {
    const { adapter, reports } = recorder()
    await runAdapter(lines(
      event('session_started', { session_id: 'a' }),
      event('state_changed', { state: 'idle' }),
      event('session_ended', { reason: 'session_changed' }),
      event('session_started', { session_id: 'b' }),
      event('run_started'), event('state_changed', { state: 'working' }),
      event('run_failed', { message: 'failure' }),
    ), adapter)
    expect(reports.map(r => [r.state, r.message])).toEqual([
      ['idle', undefined], ['idle', undefined], ['working', undefined], ['idle', 'failure'], ['clear', undefined],
    ])
  })

  test('retries failed state and release reports; no clear before any activity', async () => {
    let succeeds = false
    const reports: AppReport[] = []
    const adapter = new EvotBridgeAppAdapter(async report => { reports.push(report); return succeeds }, 0n)
    await adapter.close()
    expect(reports).toHaveLength(0)
    await adapter.handle({ version: 1, event: 'run_started' })
    succeeds = true
    await adapter.handle({ version: 1, event: 'run_started' })
    succeeds = false
    await adapter.handle({ version: 1, event: 'session_ended' })
    succeeds = true
    await adapter.close()
    await adapter.close()
    expect(reports.map(r => r.state)).toEqual(['working', 'working', 'clear', 'clear'])
  })

  test('encodes Unicode and control characters as base64, never raw OSC fields', () => {
    const message = '批准:yes\x1b\\\n\x07'
    const output = encodeAppReport({ state: 'blocked', message, sequence: '1' })
    expect(output).toBe(`\x1b]7501;state=blocked:app=evot:msg=${Buffer.from(message.trim()).toString('base64')}\x1b\\`)
    expect(output).not.toContain('批准')
    expect(encodeAppReport({ state: 'idle', sequence: '2' })).toBe(osc('idle'))
  })

  test('bounds large Unicode messages before IPC encoding', async () => {
    const { adapter, reports } = recorder()
    await adapter.handle({ version: 1, event: 'state_changed', state: 'blocked', message: '批准'.repeat(100_000) })
    const message = reports[0]!.message!
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(4098)
    const encoded = encodeAppReport(reports[0]!)
    const base64 = encoded.split('msg=')[1]!.slice(0, -2)
    expect(Buffer.from(base64, 'base64').toString('utf8')).toBe(message)
  })

  test('auto-selects hc but keeps explicit legacy panes working when nested', () => {
    expect(isAppTerminal({ HC_TERMINAL_ID: 't3' })).toBe(true)
    expect(isAppTerminal({ HC_TERMINAL_ID: 't3', HERDR_PANE_ID: 'w1:p1' })).toBe(false)
    expect(isAppTerminal({ HC_TERMINAL_ID: ' ' })).toBe(false)
    expect(createSessionAdapter({ HERDR_PANE_ID: 'w1:p1' })).toBeInstanceOf(EvotBridgeAdapter)
  })
})

describe('private terminal bridge', () => {
  test('fences an old hook clear and cleans up the socket and terminal', async () => {
    const output: string[] = []
    const bridge = await startAppBridge(text => output.push(text))
    try {
      const report = bridgeReporter(bridge.path, 500)
      expect(await report({ state: 'working', sequence: '1000001' })).toBe(true)
      expect(await report({ state: 'idle', sequence: '2000001' })).toBe(true)
      expect(await report({ state: 'clear', sequence: '1000002' })).toBe(false)
      expect(output).toEqual([osc('working'), osc('idle')])
    } finally { await bridge.close() }
    expect(output.at(-1)).toBe(osc('clear'))
    expect(await bridgeReporter(bridge.path, 200)({ state: 'idle', sequence: '3000001' })).toBe(false)
  })

  test('does not clear twice, and failed terminal writes can be retried', async () => {
    const output: string[] = []
    let succeeds = false
    const bridge = await startAppBridge(text => {
      if (!succeeds) throw new Error('terminal closed')
      output.push(text)
    })
    try {
      const report = bridgeReporter(bridge.path, 500)
      expect(await report({ state: 'idle', sequence: '1' })).toBe(false)
      succeeds = true
      expect(await report({ state: 'idle', sequence: '1' })).toBe(true)
      expect(await report({ state: 'clear', sequence: '2' })).toBe(true)
    } finally { await bridge.close() }
    expect(output).toEqual([osc('idle'), osc('clear')])
  })

  test('rejects invalid frames and oversized input without printing arbitrary bytes', async () => {
    const output: string[] = []
    const bridge = await startAppBridge(text => output.push(text))
    try {
      for (const data of ['null\n', '{invalid}\n', '{"state":"evil","sequence":"1"}\n', 'x'.repeat(33000)]) {
        await new Promise<void>(resolve => {
          const socket = createConnection(bridge.path, () => socket.write(data))
          socket.on('error', () => {})
          socket.resume()
          socket.on('close', () => resolve())
        })
      }
      expect(output).toEqual([])
    } finally { await bridge.close() }
  })

  test('bounds a nonresponsive bridge', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-test-'))
    const path = process.platform === 'win32' ? `\\\\.\\pipe\\evot-bridge-test-${crypto.randomUUID()}` : join(directory, 'hang.sock')
    const clients: import('node:net').Socket[] = []
    const server = createServer(socket => clients.push(socket))
    await new Promise<void>(resolve => server.listen(path, resolve))
    try {
      expect(await bridgeReporter(path, 50)({ state: 'idle', sequence: '1' })).toBe(false)
    } finally {
      clients.forEach(socket => socket.destroy())
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === 'win32')('hook SIGTERM clears App status and preserves signal exit status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-test-'))
    const output: string[] = []
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const bridge = await startAppBridge(text => { output.push(text); started() })
    const { child, exited } = spawnCommand([process.execPath, executable], {
      env: {
        ...process.env, HERDR_PANE_ID: '', HC_TERMINAL_ID: 'test-signal',
        EVOT_SESSION_HOOK: executable, EVOT_BRIDGE_APP_SOCKET: bridge.path,
        EVOT_BRIDGE_APP_TERMINAL_ID: 'test-signal',
        EVOT_BRIDGE_SEQUENCE_STATE_PATH: join(directory, 'sequence'),
      },
      detached: true, stdio: ['pipe', 'ignore', 'ignore'],
    })
    try {
      child.stdin!.write(event('run_started') + '\n')
      await ready
      child.kill('SIGTERM')
      expect(await exited).toBe(143)
      expect(output).toEqual([osc('working'), osc('clear')])
    } finally {
      child.kill('SIGKILL')
      await bridge.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a real detached hook reports through the bridge with discarded stdout/stderr', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-test-'))
    const output: string[] = []
    const bridge = await startAppBridge(text => output.push(text))
    try {
      const { child, exited } = spawnCommand([process.execPath, executable], {
        env: {
          ...process.env, HERDR_PANE_ID: '', HC_TERMINAL_ID: 'test-terminal',
          EVOT_SESSION_HOOK: executable, HERDR_BIN_PATH: '/must/not/be/called',
          EVOT_BRIDGE_APP_SOCKET: bridge.path, EVOT_BRIDGE_APP_TERMINAL_ID: 'test-terminal',
          EVOT_BRIDGE_SEQUENCE_STATE_PATH: join(directory, 'sequence'),
        },
        detached: process.platform !== 'win32', stdio: ['pipe', 'ignore', 'ignore'],
      })
      child.stdin!.end([event('session_started'), event('run_started'), event('run_finished')].join('\n') + '\n')
      expect(await exited).toBe(0)
      expect(output).toEqual([osc('idle'), osc('working'), osc('idle'), osc('clear')])
    } finally {
      await bridge.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

// pty.fork models hc's terminal and gives fake evot a controlling terminal.
// Fake evot intentionally detaches/discards hook stdio exactly like real evot.
const python = process.platform === 'win32' ? undefined
  : spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status === 0 ? 'python3' : undefined

test.skipIf(!python)('wrapper and plain evot hooks work in a real POSIX PTY', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-pty-'))
  const evot = join(directory, 'evot')
  const capture = join(directory, 'capture')
  await writeFile(evot, `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const events = ${JSON.stringify([event('session_started'), event('run_started'), event('run_finished')].join('\n') + '\n')};
const hook = spawnSync(process.env.EVOT_SESSION_HOOK, [], {
  env: process.env, input: events, detached: true, stdio: ['pipe', 'ignore', 'ignore']
});
process.exit(hook.status === 0 ? 23 : 99);
`)
  await chmod(evot, 0o755)
  const script = `
import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:3], os.environ)
output = bytearray()
while True:
    try:
        data = os.read(fd, 65536)
        if not data: break
        output.extend(data)
    except OSError: break
_, status = os.waitpid(pid, 0)
open(os.environ['CAPTURE'], 'wb').write(output)
sys.exit(os.waitstatus_to_exitcode(status))
`
  try {
    for (const mode of ['wrapper', 'stale-legacy-hook', 'plain-hook']) {
      const wrapper = mode !== 'plain-hook'
      const env = {
        ...process.env, HERDR_PANE_ID: '', HC_TERMINAL_ID: 'test-pty',
        EVOT_BIN_PATH: evot, EVOT_SESSION_HOOK: mode === 'stale-legacy-hook'
          ? join(directory, 'removed', 'evot-herdr') : wrapper ? '' : executable,
        EVOT_BRIDGE_APP_SOCKET: '', EVOT_BRIDGE_APP_TERMINAL_ID: '',
        HERDR_BIN_PATH: '/must/not/be/called', CAPTURE: capture,
        EVOT_BRIDGE_SEQUENCE_STATE_PATH: join(directory, 'sequence'),
      }
      const { exited } = spawnCommand([python!, '-c', script, wrapper ? process.execPath : evot, ...(wrapper ? [executable] : [])], {
        env, stdio: 'ignore',
      })
      expect(await exited).toBe(23)
      expect(await readFile(capture, 'utf8')).toBe(osc('idle') + osc('working') + osc('idle') + osc('clear'))
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 10_000)
