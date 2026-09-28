import { readFileSync } from 'node:fs'

const routes = ['auto-restock', 'manual-restock']
for (const route of routes) {
  const source = readFileSync(`supabase/functions/${route}/index.ts`, 'utf8')
  if (/Raw response:|JSON\.stringify\(data\)|fulfillResult\?\.(?:msg|message|error)/.test(source)) {
    throw new Error(`${route} exposes an untrusted provider response`)
  }
  if (/console\.(?:warn|error|log)\([^\n]*,\s*(?:err|error|buyErr)\b/.test(source)) {
    throw new Error(`${route} logs an error object that may contain a secret-bearing URL`)
  }
  if (!source.includes('Provider purchase was not safely completed; review supplier outcome')) {
    throw new Error(`${route} must return a sanitized provider outcome`)
  }
}

console.log('Restock routes do not expose raw provider payloads or errors.')
