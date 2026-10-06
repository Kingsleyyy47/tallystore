// Read-only SOURCE/Git comparison. Management secret values are SHA-256
// digests, never plaintext. Neither credentials nor their digests are output.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const sourceRef = 'dssvvswvqnxanyzfhixf'
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex')
const normalize = value => value.trim().replace(/^(['"])(.*)\1$/, '$2')
const publicNames = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED', 'VITE_APP_BUILD_VERSION'])
const placeholder = /^(?:change.?me|replace|your_|example|placeholder|dummy|test[_-]?key|<.*>|\$\{.*\})/i
function git(args) {
  return execFileSync('git', args, { encoding:'utf8', maxBuffer:32 * 1024 * 1024,
    stdio:['ignore', 'pipe', 'ignore'] })
}
function compare(candidates, secrets) {
  assert.ok(Array.isArray(secrets) && secrets.every(row => typeof row.name === 'string'
    && /^[A-Z][A-Z0-9_]*$/.test(row.name) && typeof row.value === 'string' && /^[a-f0-9]{64}$/i.test(row.value)),
  'SOURCE digest response is invalid')
  const matches = []
  for (const candidate of candidates) {
    const rawDigest = hash(candidate.raw)
    const normalizedDigest = hash(normalize(candidate.raw))
    for (const secret of secrets) {
      const digest = secret.value.toLowerCase()
      const rawMatch = rawDigest === digest
      const normalizedMatch = normalizedDigest === digest
      if (rawMatch || normalizedMatch) matches.push({ historical_name:candidate.name,
        current_name:secret.name, raw_match:rawMatch, normalized_match:normalizedMatch })
    }
  }
  return matches
}

async function run() {
  assert.ok(process.argv.slice(2).every(arg => arg === '--self-test'), 'Unknown comparison option')
  if (process.argv.includes('--self-test')) {
    const raw = 'synthetic-private-value-only'
    const cases = compare([{ name:'OLD_RAW_KEY',raw }, { name:'OLD_WRAPPED_KEY',raw:`  "${raw}"  ` }],
      [{ name:'RENAMED_CURRENT_KEY',value:hash(raw) }])
    assert.equal(cases.length,2)
    assert.equal(cases[0].raw_match,true)
    assert.equal(cases[1].raw_match,false)
    assert.equal(cases[1].normalized_match,true)
    assert.equal(compare([{ name:'DIFFERENT_KEY',raw:'synthetic-other-value' }],
      [{ name:'RENAMED_CURRENT_KEY',value:hash(raw) }]).length,0)
    assert.throws(() => compare([], [{ name:'INVALID_KEY',value:raw }]))
    console.log(JSON.stringify({ self_test_passed:true }))
    return
  }
  const tokenLine = readFileSync('.env','utf8').split(/\r?\n/)
    .find(line => /^\s*SUPABASE_ACCESS_TOKEN\s*=/.test(line))
  const token = tokenLine?.split(/=(.*)/s,2)[1]?.trim().replace(/^(['"])(.*)\1$/,'$2')
  assert.ok(token,'SOURCE management credential required')
  const paths = [...new Set(git(['log','--all','--name-only','--format=','--','.env','.env.*'])
    .split(/\r?\n/).filter(path => path && path !== '.env.example'))]
  const blobs = new Set()
  const candidates = new Map()
  for (const path of paths) {
    const commits = git(['log','--all','--format=%H','--',path]).split(/\r?\n/).filter(Boolean)
    for (const commit of commits) {
      let content
      try { content = git(['show',`${commit}:${path}`]) } catch { continue } // Deleted path has no blob.
      const blobHash = hash(content)
      if (blobs.has(blobHash)) continue
      blobs.add(blobHash)
      for (const line of content.split(/\r?\n/)) {
        const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line)
        if (!match) continue
        const [, name, raw] = match
        const value = normalize(raw)
        if (publicNames.has(name) || !/(?:SECRET|KEY|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)/.test(name)
          || value.length < 16 || placeholder.test(value)) continue
        candidates.set(`${name}:${hash(raw)}`,{ name,raw })
      }
    }
  }
  // No provider request, deployment, secret change or database mutation occurs.
  const response = await fetch(`https://api.supabase.com/v1/projects/${sourceRef}/secrets`,{
    headers:{ Authorization:`Bearer ${token}` },redirect:'error',signal:AbortSignal.timeout(30_000),
  })
  assert.ok(response.ok,'SOURCE secret digest read failed')
  const secrets = await response.json()
  const matches = compare([...candidates.values()],secrets)
  const names = [...new Set([...candidates.values()].map(row => row.name))].sort()
  const uniqueMatches = [...new Map(matches.map(row => [JSON.stringify(row),row])).values()]
  console.log(JSON.stringify({ comparison_completed:true,source_secret_count:secrets.length,
    historical_environment_blob_count:blobs.size,historical_candidate_count:candidates.size,
    historical_names:names,matching_candidate_count:matches.length,matches:uniqueMatches,
    matching_historical_names:[...new Set(matches.map(row => row.historical_name))].sort(),
    matching_current_names:[...new Set(matches.map(row => row.current_name))].sort() },null,2))
}
run().catch(() => { console.error('Read-only SOURCE secret digest comparison failed; no credential data was printed.');process.exitCode=1 })
