import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDocs } from './check-docs.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'evot-bridge-package-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmRun = args => execFileSync(npm, args, { cwd: root, encoding: 'utf8' })
try {
  npmRun(['run', 'build'])
  const [packed] = JSON.parse(npmRun(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]))
  const archive = join(temporary, packed.filename)
  assert(packed.files.some(file => file.path === 'dist/index.js'))
  assert(packed.files.some(file => file.path === 'dist/process.js'))
  assert(packed.files.some(file => file.path === 'dist/app.js'))
  assert.deepEqual(packed.files.filter(file => file.path.startsWith('bin/')).map(file => file.path), ['bin/evot-bridge'])
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.bin, { 'evot-bridge': './bin/evot-bridge' })
  assert(!packed.files.some(file => file.path.startsWith('src/') || file.path.startsWith('node_modules/')))
  const prefix = join(temporary, 'install')
  npmRun(['install', '--global', '--prefix', prefix, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', archive])
  const modules = npmRun(['root', '--global', '--prefix', prefix]).trim()
  const installedRoot = join(modules, '@evotai', 'evot-bridge')
  await checkDocs(installedRoot)
  const installed = join(installedRoot, 'bin', 'evot-bridge')
  const bin = join(temporary, 'bin')
  await mkdir(bin)
  await symlink(process.execPath, join(bin, process.platform === 'win32' ? 'node.exe' : 'node'))
  const capture = join(temporary, 'herdr-commands')
  const herdr = join(bin, 'herdr')
  const evot = join(bin, 'evot')
  await writeFile(herdr, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--help')) console.log('Arguments: [RESUME_ARG]...');
else fs.appendFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');
`)
  await writeFile(evot, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
if (process.argv[2] === 'acp') {
  if (process.env.EVOT_SESSION_HOOK || process.env.EVOT_BRIDGE_APP_SOCKET || process.env.EVOT_HERDR_APP_SOCKET) process.exit(99);
  process.stdin.pipe(process.stdout);
  process.stdin.on('end', () => { process.exitCode = 29; });
} else {
if (process.argv.includes('--help')) process.exit(23);
const events = [
  {version: 1, event: 'session_started', session_id: 'saved-package-session'},
  {version: 1, event: 'session_ended', reason: 'process_exit'}
];
const result = spawnSync(process.env.EVOT_SESSION_HOOK, [], {
  env: process.env, input: events.map(event => JSON.stringify(event)).join('\\n') + '\\n', stdio: ['pipe', 'inherit', 'inherit']
});
process.exit(result.status ?? 1);
}
`)
  await chmod(herdr, 0o755)
  await chmod(evot, 0o755)
  // Deliberately exclude the developer's PATH and therefore any Bun/tsx binaries.
  const env = {
    PATH: [bin, '/usr/bin', '/bin'].join(delimiter),
    HOME: temporary, CAPTURE: capture, HERDR_PANE_ID: 'package:pane',
    HERDR_BIN_PATH: herdr, EVOT_BIN_PATH: evot,
    EVOT_BRIDGE_SEQUENCE_STATE_PATH: join(temporary, 'sequence'),
  }
  const run = args => spawnSync(process.execPath, [installed, ...args], { env, encoding: 'utf8', timeout: 10_000 })
  assert.equal(run(['--help']).status, 23, 'installed wrapper must preserve exit status')
  const result = run(['--resume', 'saved-package-session'])
  assert.equal(result.status, 0, result.stderr || String(result.error))
  const commands = (await readFile(capture, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const registration = commands.find(argv => argv[1] === 'report-agent-session')
  assert(registration, 'installed hook must register the session')
  assert.deepEqual(registration.slice(registration.indexOf('--') + 1), ['evot-bridge', '--resume', 'saved-package-session'])
  assert(commands.some(argv => argv[1] === 'release-agent'), 'installed hook must release on exit')
  const acpInput = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":2}}\n'
  const acp = spawnSync(process.execPath, [installed, 'acp'], {
    env: {
      ...env, EVOT_SESSION_HOOK: '/must/not/run', EVOT_BRIDGE_APP_SOCKET: '/outer/socket',
      EVOT_HERDR_APP_SOCKET: '/legacy/socket',
    },
    input: acpInput, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(acp.status, 29, acp.stderr || String(acp.error))
  assert.equal(acp.stdout, acpInput, 'installed ACP transport must remain byte-transparent')
  console.log('Package smoke passed: single evot-bridge executable, packaged documentation links, offline install, terminal hooks, resume argv, exit status, release, ACP mode.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
