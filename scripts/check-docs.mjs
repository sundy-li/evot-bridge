import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

// The project docs use inline Markdown links and ATX headings. Ignore fenced
// examples so their sample syntax does not become a link or heading target.
const prose = text => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')

function headingIds(text) {
  const ids = new Set()
  for (const match of prose(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1].toLowerCase().replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
    let id = base
    let suffix = 0
    while (ids.has(id)) id = `${base}-${++suffix}`
    ids.add(id)
  }
  return ids
}

export async function checkDocs(root = projectRoot) {
  const documents = ['README.md', 'CHANGELOG.md', ...(await readdir(join(root, 'docs')))
    .filter(name => name.endsWith('.md')).map(name => `docs/${name}`)]
  const contents = new Map()
  const load = async path => {
    if (!contents.has(path)) contents.set(path, await readFile(path, 'utf8'))
    return contents.get(path)
  }
  let links = 0
  for (const document of documents) {
    const source = resolve(root, document)
    const text = prose(await load(source))
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const href = match[1]
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue
      const [target, fragment] = href.split('#', 2)
      const path = target ? resolve(dirname(source), decodeURIComponent(target)) : source
      const label = `${document}: ${href}`
      let info
      try { info = await stat(path) } catch { assert.fail(`Missing documentation link: ${label}`) }
      assert(info.isFile(), `Documentation link must point to a file: ${label}`)
      if (fragment && path.endsWith('.md')) {
        assert(headingIds(await load(path)).has(decodeURIComponent(fragment)), `Missing heading anchor: ${label}`)
      }
      links++
    }
  }
  return { documents: documents.length, links }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDocs(process.argv[2] ? resolve(process.argv[2]) : projectRoot)
  console.log(`Documentation links passed: ${result.documents} files, ${result.links} local links and anchors.`)
}
