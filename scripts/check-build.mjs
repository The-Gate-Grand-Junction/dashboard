// Build guards: fail the build on mistakes that type-checking can't see.
//
// 1. A bare `@libsql/client` import in a Netlify function. The default entry
//    pulls in a native binary that the function bundler can't ship, so the
//    function builds fine and then crashes on its first request. This reached
//    production on 2026-09-18 (offline invoices). Use `@libsql/client/web`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'netlify'
const failures = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) check(path)
  }
}

function check(path) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/['"]@libsql\/client['"]/.test(line)) {
        failures.push(`${path}:${i + 1}  imports '@libsql/client'; use '@libsql/client/web'`)
      }
    })
}

walk(ROOT)

if (failures.length) {
  console.error('Build guard failed:\n' + failures.map((f) => '  ' + f).join('\n'))
  process.exit(1)
}
console.log('Build guards passed.')
