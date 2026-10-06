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
const { detectAccountImportMode, parseCSV, getAccountImportRawLines } = await import(moduleUrl)

const colonOne = 'alice:p,ss:alice@example.com:mailpass'
assert.equal(detectAccountImportMode(colonOne), 'colon')
const colonOneRows = parseCSV(colonOne)
assert.ok(colonOneRows.length === 1 && colonOneRows[0].username === 'alice' && colonOneRows[0].password === 'p,ss', 'one colon row keeps its password and first account')
assert.equal(colonOneRows[0].additional_info.original_line, colonOne, 'colon TXT retains untouched source line')

const colonMany = `${colonOne}\nbob:p,2:bob@example.com:mailpass2`
const colonManyRows = parseCSV(colonMany)
assert.ok(colonManyRows.length === 2 && colonManyRows[0].username === 'alice' && colonManyRows[1].password === 'p,2', 'multiple colon rows keep exact row order')

const pipeOne = 'charlie|p,3|charlie@example.com|mailpass3'
assert.equal(detectAccountImportMode(pipeOne), 'pipe')
const pipeOneRows = parseCSV(pipeOne)
assert.ok(pipeOneRows.length === 1 && pipeOneRows[0].password === 'p,3', 'one pipe row keeps embedded comma')
assert.equal(pipeOneRows[0].additional_info.original_line, pipeOne, 'pipe TXT retains untouched source line')
const pipeManyRows = parseCSV(`${pipeOne}\ndana|p,4|dana@example.com|mailpass4`)
assert.ok(pipeManyRows.length === 2 && pipeManyRows[0].username === 'charlie' && pipeManyRows[1].password === 'p,4', 'multiple pipe rows keep exact row order')

const quotedCsv = 'username,password,email\nelliot,"p,5",elliot@example.com'
assert.equal(detectAccountImportMode('username,password,email'), 'csv')
const quotedRows = parseCSV(quotedCsv)
assert.ok(quotedRows.length === 1 && quotedRows[0].username === 'elliot' && quotedRows[0].password === 'p,5', 'quoted CSV comma remains in password')

const explicitRows = parseCSV(pipeOne, 'facebook')
assert.ok(explicitRows.length === 1 && explicitRows[0].password === 'p,3', 'explicit format keeps embedded comma')
assert.equal(explicitRows[0].additional_info.original_line, pipeOne, 'explicit format retains untouched source line')

const paddedLine = '  alpha :  pass with spaces  :alpha@example.invalid: cookies=sessionid=synthetic; csrftoken=synthetic  '
const padded = parseCSV(paddedLine)[0]
assert.equal(padded.username, 'alpha', 'parsed username semantics remain trimmed')
assert.equal(padded.password, 'pass with spaces', 'parsed password semantics remain trimmed')
assert.equal(padded.additional_info.original_line, paddedLine, 'TXT keeps raw spacing, extras and cookie text')
assert.ok(padded.additional_info.extra_fields, 'TXT extras remain available alongside original line')

const separatorLine = 'beta:part:more:beta@example.invalid'
const separatorRow = parseCSV(separatorLine)[0]
assert.equal(separatorRow.password, 'part', 'delimiter-containing password is not guessed or reconstructed')
assert.equal(separatorRow.additional_info.original_line, separatorLine, 'unparsed delimiter content remains available exactly')

const explicitLine = '  gamma | pw | gamma@example.invalid | mailpw | recovery@example.invalid | synthetic2fa | 2024 | 7 | cookie=synthetic  '
const explicit = parseCSV(explicitLine, 'facebook')[0]
assert.equal(explicit.additional_info.original_line, explicitLine, 'explicit extra-column line retains all original bytes')
assert.ok(explicit.additional_info.extra_fields, 'explicit extra columns remain parsed')

const withHeader = '\uFEFFusername:password\r\n  delta:pw:delta@example.invalid  \r\n\r\n  epsilon:pw2  '
const rawLines = getAccountImportRawLines(withHeader)
assert.equal(rawLines.length, 3, 'blank rows are ignored without trimming stored lines')
assert.equal(rawLines[1], '  delta:pw:delta@example.invalid  ', 'header handling retains raw credential line')
const skipped = parseCSV(rawLines.slice(1).join('\n'))
assert.equal(skipped[0].additional_info.original_line, rawLines[1], 'admin/staff skip-header input retains first credential line')
assert.equal(skipped[1].additional_info.original_line, rawLines[2], 'admin/staff skip-header input retains following credential line')
assert.ok(skipped.every(row => row.username && row.password), 'header skip leaves valid credential rows')
const unskipped = parseCSV('  zeta|pw3  ')[0]
assert.equal(unskipped.additional_info.original_line, '  zeta|pw3  ', 'non-header input retains raw credential line')

assert.ok(parseCSV('wrong,columns\nfrank,p6').length === 0, 'invalid CSV header is denied')
assert.ok(parseCSV('username,password:broken\nfrank,p6').length === 0, 'header-like CSV cannot become a TXT credential')
assert.ok(parseCSV('username,email\nfrank,frank@example.com').length === 0, 'CSV missing password header is denied')
const missingPasswordRows = parseCSV('username,password\nfrank,')
assert.ok(missingPasswordRows.length === 1 && !missingPasswordRows[0].password, 'missing password remains detectable as invalid')

process.stdout.write('Account import parser cases passed.\n')
