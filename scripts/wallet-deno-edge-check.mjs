import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const edgeFunctions = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `supabase/functions/${entry.name}/index.ts`)
  .filter((path) => existsSync(join(root, path)))
  .sort()

function runDenoCheck(paths) {
  const args = ['-y', 'deno', 'check', '--no-lock', '--node-modules-dir=auto', ...paths]
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/c', 'npx', ...args]
    : args
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: 300000,
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  })

  return {
    paths,
    command: ['npx', ...args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal || null,
    error: result.error?.message || null,
    stdout: (result.stdout || '').trim().slice(-4000),
    stderr: (result.stderr || '').trim().slice(-4000),
  }
}

const results = [runDenoCheck(edgeFunctions)]
const failed = results.filter((result) => result.status !== 'passed')

console.log(JSON.stringify({
  ok: failed.length === 0,
  checked: edgeFunctions.length,
  results,
  acceptanceBoundary: [
    'This is a Deno type check for every local Supabase Edge Function entrypoint.',
    'It does not replace deployed Supabase function tests or provider sandbox checks.',
    'It checks source compatibility for local Edge Function code, not deployed project configuration or runtime secrets.',
  ],
}, null, 2))

if (failed.length > 0) process.exit(1)
