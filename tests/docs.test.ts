import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const checker = fileURLToPath(new URL('../scripts/check-docs.mjs', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))
const check = (directory: string) => spawnSync(process.execPath, [checker, directory], {
  encoding: 'utf8', timeout: 10_000,
})

test('repository documentation has valid local links and heading anchors', () => {
  const result = check(root)
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('Documentation links passed')
})

for (const scenario of ['valid', 'missing-file', 'missing-anchor'] as const) {
  test(`documentation checker handles ${scenario} targets`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-docs-'))
    try {
      await mkdir(join(directory, 'docs'))
      await writeFile(join(directory, 'CHANGELOG.md'), '# Changelog\n')
      await writeFile(join(directory, 'README.md'), '# Example\n\n[Setup](docs/guide.md#setup)\n')
      if (scenario !== 'missing-file') {
        await writeFile(join(directory, 'docs/guide.md'), scenario === 'valid'
          ? '# Guide\n\n## Setup\n\n```md\n[Not a real link](missing.md)\n```\n'
          : '# Guide\n')
      }
      const result = check(directory)
      if (scenario === 'valid') {
        expect(result.status, result.stderr).toBe(0)
      } else {
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(scenario === 'missing-file'
          ? 'Missing documentation link' : 'Missing heading anchor')
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
}
