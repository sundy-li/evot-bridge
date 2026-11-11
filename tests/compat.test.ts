import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { startAppBridge } from '../src/app.js'
import { buildResumeArgv, createSessionAdapter, EvotBridgeAdapter } from '../src/index.js'

test('legacy restore variables remain aliases and new names take precedence', () => {
  const oldConfig = join(tmpdir(), 'legacy.env')
  const newConfig = join(tmpdir(), 'bridge.env')
  expect(buildResumeArgv('saved', {
    EVOT_HERDR_RESUME_COMMAND: 'evot', EVOT_HERDR_ENV_FILE: oldConfig,
  })).toEqual(['evot', '--resume', 'saved', '--env-file', oldConfig])
  expect(buildResumeArgv('saved', {
    EVOT_BRIDGE_RESUME_COMMAND: 'evot-bridge', EVOT_BRIDGE_ENV_FILE: newConfig,
    EVOT_HERDR_RESUME_COMMAND: 'evot', EVOT_HERDR_ENV_FILE: oldConfig,
  })).toEqual(['evot-bridge', '--resume', 'saved', '--env-file', newConfig])
})

test('legacy sequence override is read, but a new override wins without modifying the old file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-compat-'))
  try {
    const legacy = join(directory, 'legacy-sequence')
    const current = join(directory, 'bridge-sequence')
    await writeFile(legacy, 'invalid')
    const env = {
      ...process.env, HERDR_PANE_ID: 'w1:p1',
      EVOT_BRIDGE_SEQUENCE_STATE_PATH: undefined, EVOT_HERDR_SEQUENCE_STATE_PATH: legacy,
    }
    expect(new EvotBridgeAdapter({ env }).enabled).toBe(false)
    const adapter = new EvotBridgeAdapter({ env: { ...env, EVOT_BRIDGE_SEQUENCE_STATE_PATH: current } })
    expect(adapter.enabled).toBe(true)
    expect(await readFile(legacy, 'utf8')).toBe('invalid')
    expect(await readFile(current, 'utf8')).toMatch(/^\d+\n$/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the renamed adapter shares the legacy default allocator to fence running older hooks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-compat-'))
  try {
    const legacyDirectory = join(directory, 'evot-herdr')
    await mkdir(legacyDirectory)
    const generation = 5_000_000_000_000n
    await writeFile(join(legacyDirectory, 'sequence'), `${generation}\n`)
    const commands: string[][] = []
    const adapter = new EvotBridgeAdapter({
      env: {
        ...process.env, HERDR_PANE_ID: 'w1:p1', XDG_STATE_HOME: directory, LOCALAPPDATA: directory,
        EVOT_BRIDGE_SEQUENCE_STATE_PATH: undefined, EVOT_HERDR_SEQUENCE_STATE_PATH: undefined,
      },
      run: async argv => { commands.push(argv) },
    })
    await adapter.handle({ version: 1, event: 'run_started' })
    const command = commands[0]!
    expect(BigInt(command[command.indexOf('--seq') + 1]!)).toBeGreaterThan(generation * 1_000_000n)
    expect(await readFile(join(legacyDirectory, 'sequence'), 'utf8')).toBe(`${generation + 1n}\n`)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('legacy App bridge variables still connect and new bridge variables take precedence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-compat-'))
  const oldOutput: string[] = []
  const newOutput: string[] = []
  const oldBridge = await startAppBridge(text => oldOutput.push(text))
  const newBridge = await startAppBridge(text => newOutput.push(text))
  try {
    const env = {
      ...process.env, HERDR_PANE_ID: '', HC_TERMINAL_ID: 'compat-terminal',
      EVOT_BRIDGE_APP_SOCKET: undefined, EVOT_BRIDGE_APP_TERMINAL_ID: undefined,
      EVOT_BRIDGE_SEQUENCE_STATE_PATH: join(directory, 'sequence'),
      EVOT_HERDR_APP_SOCKET: oldBridge.path, EVOT_HERDR_APP_TERMINAL_ID: 'compat-terminal',
    }
    const oldAdapter = createSessionAdapter(env)
    await oldAdapter.handle({ version: 1, event: 'run_started' })
    await oldAdapter.close()
    expect(oldOutput).toHaveLength(2)
    const newAdapter = createSessionAdapter({
      ...env, EVOT_BRIDGE_APP_SOCKET: newBridge.path, EVOT_BRIDGE_APP_TERMINAL_ID: 'compat-terminal',
    })
    await newAdapter.handle({ version: 1, event: 'run_started' })
    await newAdapter.close()
    expect(oldOutput).toHaveLength(2)
    expect(newOutput).toHaveLength(2)
  } finally {
    await oldBridge.close()
    await newBridge.close()
    await rm(directory, { recursive: true, force: true })
  }
})
