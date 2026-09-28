import { spawnSync } from 'node:child_process'

const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const secretPatterns = [
  /\b(?:sb_secret_|(?:sk|rk)_(?:live|test)_)[A-Za-z0-9_-]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(?:[A-Z_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|SERVICE_ROLE_KEY|PASSWORD)[A-Z_]*)\s*[:=]\s*['"`]([A-Za-z0-9._-]{20,})['"`]/g,
]
const sourcePath = /^(?:src\/|public\/|api\/|pages\/api\/|supabase\/(?:functions|migrations)\/|migrations\/|scripts\/|docs\/|dist\/|build\/|index\.html$|homepage-redesign-preview\.html$|\.env(?:\.|$))/
const sourcePathspecs = [
  'src', 'public', 'api', 'pages/api', 'supabase/functions',
  'supabase/migrations', 'migrations', 'scripts', 'docs',
  'dist', 'build', 'index.html', 'homepage-redesign-preview.html', '.env', '.env.*',
]
const placeholder = /^(?:change.?me|replace|your_|example|placeholder|dummy|test[_-]?key)/i
const safeEmailDomain = /@(?:example\.com|example\.test|email\.com)$/i

function git(args, allowedExitCodes = [0]) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || !allowedExitCodes.includes(result.status)) {
    throw new Error(`Git history audit failed while running ${args[0]}`)
  }
  return result.stdout || ''
}

const commits = git(['rev-list', '--all']).trim().split(/\r?\n/).filter(Boolean)
const findings = new Map()
let matchedSourceLines = 0
for (const commit of commits) {
  const matches = git([
    'grep', '-I', '-n', '-e', '@', '-e', 'sk_live_', '-e', 'sk_test_',
    '-e', 'sb_secret_', '-e', 'PRIVATE KEY', '-e', 'API_KEY',
    '-e', 'SECRET_KEY', '-e', 'ACCESS_TOKEN', '-e', 'SERVICE_ROLE_KEY',
    '-e', 'PASSWORD', commit, '--', ...sourcePathspecs,
  ], [0, 1])
  for (const line of matches.split(/\r?\n/)) {
    const row = line.match(/^[0-9a-f]{40}:(.+?):\d+:(.*)$/)
    if (!row || !sourcePath.test(row[1])) continue
    const [, path, content] = row
    matchedSourceLines += 1
    const kinds = new Set()
    for (const email of content.matchAll(emailPattern)) {
      if (!safeEmailDomain.test(email[0])) kinds.add('literal_personal_email')
    }
    for (const pattern of secretPatterns) {
      pattern.lastIndex = 0
      for (const match of content.matchAll(pattern)) {
        if (!match[1] || !placeholder.test(match[1])) kinds.add('secret_shaped_literal')
      }
    }
    for (const kind of kinds) {
      const key = `${kind}:${path}`
      if (!findings.has(key)) findings.set(key, { kind, path, commits: new Set() })
      findings.get(key).commits.add(commit.slice(0, 12))
    }
  }
}

const result = {
  scanCompleted: true,
  findingsPresent: findings.size > 0,
  scope: 'reachable Git commits; browser, API, Edge, migration, tooling, documentation, build, and environment paths',
  commitsChecked: commits.length,
  matchedSourceLines,
  findings: [...findings.values()].map(({ kind, path, commits: seen }) => ({
    kind, path, commitCount: seen.size, exampleCommit: [...seen][0],
  })).sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path)),
  limitation: 'Path/category findings do not prove a historical deployment or credential validity. No matched values are printed.',
}
console.log(JSON.stringify(result, null, 2))
