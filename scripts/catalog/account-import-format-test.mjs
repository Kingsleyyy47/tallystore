import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Bundle the real parser without connecting to a live Supabase project.
const output = await build({
  entryPoints: ['src/lib/supabase.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-test-key'),
  },
})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`
const { detectAccountImportMode, parseCSV } = await import(moduleUrl)

const colonOne = 'alice:p,ss:alice@example.com:mailpass'
assert.equal(detectAccountImportMode(colonOne), 'colon')
const colonOneRows = parseCSV(colonOne)
assert.ok(colonOneRows.length === 1 && colonOneRows[0].username === 'alice' && colonOneRows[0].password === 'p,ss', 'one colon row keeps its password and first account')

const colonMany = `${colonOne}\nbob:p,2:bob@example.com:mailpass2`
const colonManyRows = parseCSV(colonMany)
assert.ok(colonManyRows.length === 2 && colonManyRows[0].username === 'alice' && colonManyRows[1].password === 'p,2', 'multiple colon rows keep exact row order')

const pipeOne = 'charlie|p,3|charlie@example.com|mailpass3'
assert.equal(detectAccountImportMode(pipeOne), 'pipe')
const pipeOneRows = parseCSV(pipeOne)
assert.ok(pipeOneRows.length === 1 && pipeOneRows[0].password === 'p,3', 'one pipe row keeps embedded comma')
const pipeManyRows = parseCSV(`${pipeOne}\ndana|p,4|dana@example.com|mailpass4`)
assert.ok(pipeManyRows.length === 2 && pipeManyRows[0].username === 'charlie' && pipeManyRows[1].password === 'p,4', 'multiple pipe rows keep exact row order')

const quotedCsv = 'username,password,email\nelliot,"p,5",elliot@example.com'
assert.equal(detectAccountImportMode('username,password,email'), 'csv')
const quotedRows = parseCSV(quotedCsv)
assert.ok(quotedRows.length === 1 && quotedRows[0].username === 'elliot' && quotedRows[0].password === 'p,5', 'quoted CSV comma remains in password')

const explicitRows = parseCSV(pipeOne, 'facebook')
assert.ok(explicitRows.length === 1 && explicitRows[0].password === 'p,3', 'explicit format keeps embedded comma')

assert.ok(parseCSV('wrong,columns\nfrank,p6').length === 0, 'invalid CSV header is denied')
assert.ok(parseCSV('username,password:broken\nfrank,p6').length === 0, 'header-like CSV cannot become a TXT credential')
assert.ok(parseCSV('username,email\nfrank,frank@example.com').length === 0, 'CSV missing password header is denied')
const missingPasswordRows = parseCSV('username,password\nfrank,')
assert.ok(missingPasswordRows.length === 1 && !missingPasswordRows[0].password, 'missing password remains detectable as invalid')

process.stdout.write('Account import parser cases passed.\n')
