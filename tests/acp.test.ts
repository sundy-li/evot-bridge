import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { spawnCommand } from '../src/process.js'

const wrapper = fileURLToPath(new URL('../bin/evot-bridge', import.meta.url))

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-acp-'))
  const evot = join(directory, 'evot.cjs')
  const capture = join(directory, 'capture.json')
  const herdr = join(directory, 'herdr.cjs')
  const touched = join(directory, 'must-not-run')
  await writeFile(evot, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({args: process.argv.slice(2), env: process.env}));
process.stderr.write('agent diagnostic\\n');
if (process.env.WAIT_FOR_SIGNAL) {
  process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\\n');
  setInterval(() => {}, 1000);
} else {
  // This fixture is deliberately byte-transparent, not an ACP implementation.
  // Protocol framing, notifications and client replies belong to native evot.
  process.stdin.pipe(process.stdout);
  process.stdin.on('end', () => { process.exitCode = 23; });
}
`)
  await writeFile(herdr, `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(touched)}, 'unexpected Herdr command');
`)
  await chmod(evot, 0o755)
  await chmod(herdr, 0o755)
  await writeFile(join(directory, 'config with spaces.env'), '')
  return {
    directory, capture, touched,
    env: {
      ...process.env, EVOT_BIN_PATH: evot, CAPTURE: capture, HERDR_BIN_PATH: herdr,
      EVOT_SESSION_HOOK: herdr, // Even a custom shell hook must not run in ACP.
      EVOT_BRIDGE_APP_SOCKET: '/inherited/outer/socket', EVOT_BRIDGE_APP_TERMINAL_ID: 't3',
      EVOT_HERDR_APP_SOCKET: '/inherited/legacy/socket', EVOT_HERDR_APP_TERMINAL_ID: 'legacy-t3',
      EVOT_BRIDGE_SEQUENCE_STATE_PATH: join(directory, 'sequence'),
    },
  }
}

async function collect(command: string[], env: NodeJS.ProcessEnv, input = Buffer.alloc(0)) {
  const { child, exited } = spawnCommand(command, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout!.on('data', chunk => stdout.push(chunk))
  child.stderr!.on('data', chunk => stderr.push(chunk))
  child.stdin!.end(input)
  return { code: await exited, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() }
}

describe('T3 Code / ACP transport', () => {
  for (const environment of ['standalone', 'legacy', 'hc']) {
    test(`evot-bridge acp keeps stdio clean in ${environment} environments`, async () => {
      const f = await fixture()
      try {
        const env = { ...f.env, HERDR_PANE_ID: environment === 'legacy' ? 'w1:p1' : '', HC_TERMINAL_ID: environment === 'hc' ? 't3' : '' }
        const flags = ['--env-file', join(f.directory, 'config with spaces.env'), '--model', 'test:model', '--tools', 'readonly']
        const command = [process.execPath, wrapper, 'acp', ...flags]
        const input = Buffer.from([
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":2}}\r\n',
          '{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"临时"}}\n',
          '{"jsonrpc":"2.0","id":"permission-1","result":{"outcome":{"outcome":"selected","optionId":"allow_once"}}}\n',
        ].join(''))
        const result = await collect(command, env, input)
        expect(result.code, result.stderr).toBe(23)
        expect(result.stdout).toEqual(input)
        expect(result.stderr).toBe('agent diagnostic\n')
        const recorded = JSON.parse(await readFile(f.capture, 'utf8'))
        expect(recorded.args).toEqual(['acp', ...flags])
        expect(recorded.args).not.toContain('--permission') // Never force allow.
        expect(recorded.env.EVOT_SESSION_HOOK).toBeUndefined()
        expect(recorded.env.EVOT_BRIDGE_APP_SOCKET).toBeUndefined()
        expect(recorded.env.EVOT_BRIDGE_APP_TERMINAL_ID).toBeUndefined()
        expect(recorded.env.EVOT_HERDR_APP_SOCKET).toBeUndefined()
        expect(recorded.env.EVOT_HERDR_APP_TERMINAL_ID).toBeUndefined()
        expect(recorded.env.EVOT_BIN_PATH).toBe(env.EVOT_BIN_PATH)
        await expect(readFile(f.touched)).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(readFile(join(f.directory, 'sequence'))).rejects.toMatchObject({ code: 'ENOENT' })
      } finally { await rm(f.directory, { recursive: true, force: true }) }
    })
  }

  test('explicit acp selects protocol mode even with a self-referenced hook and piped stdin', async () => {
    const f = await fixture()
    try {
      const result = await collect([process.execPath, wrapper, 'acp'], { ...f.env, EVOT_SESSION_HOOK: wrapper })
      expect(result.code).toBe(23)
      expect(JSON.parse(await readFile(f.capture, 'utf8')).args).toEqual(['acp'])
    } finally { await rm(f.directory, { recursive: true, force: true }) }
  })

  test('without acp the same entry stays in terminal wrapper mode', async () => {
    const f = await fixture()
    try {
      const result = await collect([process.execPath, wrapper], {
        ...f.env, EVOT_SESSION_HOOK: '', HERDR_PANE_ID: 'w1:p1', HC_TERMINAL_ID: '',
      })
      expect(result.code).toBe(23)
      const recorded = JSON.parse(await readFile(f.capture, 'utf8'))
      expect(recorded.args).toEqual([])
      expect(recorded.env.EVOT_SESSION_HOOK).toBe(wrapper)
    } finally { await rm(f.directory, { recursive: true, force: true }) }
  })

  test('spawn failures use stderr and exit 127, not JSON-RPC stdout', async () => {
    const result = await collect([process.execPath, wrapper, 'acp'], { ...process.env, EVOT_BIN_PATH: '/missing/evot' })
    expect(result.code).toBe(127)
    expect(result.stdout.length).toBe(0)
    expect(result.stderr).toContain('failed to start /missing/evot')
  })

  test.skipIf(process.platform === 'win32')('forwards client shutdown signals without leaking protocol output', async () => {
    const f = await fixture()
    const { child, exited } = spawnCommand([process.execPath, wrapper, 'acp'], {
      env: { ...f.env, WAIT_FOR_SIGNAL: '1' }, stdio: ['pipe', 'pipe', 'ignore'],
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.stdout!.once('data', () => resolve())
        child.once('close', () => reject(new Error('wrapper closed before agent was ready')))
      })
      child.kill('SIGTERM')
      expect(await exited).toBe(143)
    } finally {
      child.kill('SIGKILL')
      await rm(f.directory, { recursive: true, force: true })
    }
  })
})
