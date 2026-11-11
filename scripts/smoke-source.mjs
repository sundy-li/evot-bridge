import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkDocs } from './check-docs.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'evot-bridge-source-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (command, args, cwd = temporary) => execFileSync(command, args, {
  cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 5 * 1024 * 1024,
})
try {
  const source = join(temporary, 'source')
  await mkdir(source)
  // Deliberately include only source/build inputs, never dist or node_modules.
  for (const path of ['package.json', 'README.md', 'CHANGELOG.md', 'tsconfig.json', 'tsconfig.build.json', 'src', 'bin', 'docs', 'scripts/check-docs.mjs']) {
    await mkdir(dirname(join(source, path)), { recursive: true })
    await cp(join(root, path), join(source, path), { recursive: true })
  }
  await assert.rejects(access(join(source, 'dist')))
  await assert.rejects(access(join(source, 'node_modules')))
  run('git', ['init', '--quiet'], source)
  run('git', ['add', '.'], source)
  run('git', ['-c', 'user.name=Source install test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Source-only fixture'], source)

  const checkout = join(temporary, 'checkout')
  run('git', ['clone', '--quiet', pathToFileURL(source).href, checkout])
  run(npm, ['install', '--include=dev', '--legacy-peer-deps', '--no-audit', '--no-fund'], checkout)
  const prefix = join(temporary, 'install')
  // Set the global destination via env: CLI --prefix also changes the local
  // package npm link reads, which would no longer be this checkout.
  execFileSync(npm, ['link', '--no-audit', '--no-fund'], {
    cwd: checkout, env: { ...process.env, npm_config_prefix: prefix },
    encoding: 'utf8', timeout: 120_000,
  })
  const modules = run(npm, ['root', '--global', '--prefix', prefix]).trim()
  const installed = join(modules, '@evotai', 'evot-bridge')
  await checkDocs(installed)
  run(npm, ['run', 'test:docs'], checkout)
  for (const path of ['dist/index.js', 'dist/app.js', 'dist/process.js', 'bin/evot-bridge']) {
    await access(join(installed, path))
  }
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version)
  assert.deepEqual(manifest.bin, { 'evot-bridge': './bin/evot-bridge' })
  const linkedAcp = process.platform === 'win32' ? join(prefix, 'evot-bridge.cmd') : join(prefix, 'bin', 'evot-bridge')
  await access(linkedAcp)
  const fakeAcp = join(temporary, 'fake-evot.cjs')
  await writeFile(fakeAcp, `#!${process.execPath}
if (process.argv[2] !== 'acp') process.exit(99);
process.stdin.pipe(process.stdout);
`)
  await chmod(fakeAcp, 0o755)
  const input = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":2}}\n'
  // Exercise the globally linked entry itself, not just the source/package
  // path: a relocated launcher cannot resolve its relative dist import.
  const linked = spawnSync(process.execPath, [linkedAcp, 'acp'], {
    env: { ...process.env, EVOT_BIN_PATH: fakeAcp }, input,
    encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(linked.status, 0, linked.stderr || String(linked.error))
  assert.equal(linked.stdout, input)

  // Node itself stands in for evot: --version must be forwarded unchanged.
  const result = spawnSync(process.execPath, [join(installed, 'bin', 'evot-bridge'), '--version'], {
    env: {
      ...process.env, EVOT_BIN_PATH: process.execPath, EVOT_SESSION_HOOK: '',
      HERDR_PANE_ID: 'source-install-test', HC_TERMINAL_ID: '',
    },
    encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  assert.equal(result.stdout.trim(), process.version)
  console.log('Source smoke passed: clean Git clone/install/link, automatic prepare build, compiled App adapter, executable linked wrapper, documentation links.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
