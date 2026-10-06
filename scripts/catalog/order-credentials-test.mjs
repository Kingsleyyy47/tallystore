import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('src/lib/orderCredentials.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
vm.runInNewContext(code, { exports })
const { normalizeOrderCredential, normalizeOrderCredentials } = exports

// Sanitized field shape of the affected Discord order: no mail fields were
// stored, and a 2FA value alone must never invent them.
const discord = { username: 'login@example.test', password: 'password1234', two_fa_code: 'key-12345678',
  email: null, email_password: null, additional_info: null }
const displayed = normalizeOrderCredential(discord)
assert.equal(displayed.username, discord.username)
assert.equal(displayed.password, discord.password)
assert.equal(displayed.two_fa_code, discord.two_fa_code)
assert.equal(displayed.email, null)
assert.equal(displayed.email_password, null)
assert.equal(discord.email, null, 'normalization must leave the stored snapshot unchanged')

const originalPipe = '  person |  login-pass  | mail@example.test | mail-pass | auth-key |  '
const pipe = normalizeOrderCredential({ username: originalPipe })
assert.equal(pipe.username, 'person')
assert.equal(pipe.password, 'login-pass')
assert.equal(pipe.email, 'mail@example.test')
assert.equal(pipe.email_password, 'mail-pass')
assert.equal(pipe.two_fa_code, 'auth-key')
assert.equal(pipe.original_line, originalPipe, 'legacy source line must remain byte-for-byte available for copy/TXT')

const fromInfo = normalizeOrderCredential({ username: 'old-login', additional_info: {
  raw_line: 'new-login | new-pass | address@example.test | address-pass | 2fa-key |',
} })
assert.equal(fromInfo.username, 'new-login')
assert.equal(fromInfo.two_fa_code, '2fa-key')
assert.equal(fromInfo.additional_info.raw_line.includes('new-login'), true)
assert.equal(fromInfo.original_line, fromInfo.additional_info.raw_line)

const unrecognized = normalizeOrderCredential({ username: 'person | pass | mail | mail-pass | 2fa | extra', password: 'stored-pass' })
assert.equal(unrecognized.username, 'person | pass | mail | mail-pass | 2fa | extra')
assert.equal(unrecognized.password, 'stored-pass')
assert.equal(unrecognized.original_line, unrecognized.username)
const supplierExtraLine = 'person|pass|mail|mail-pass|2fa|cookies=exact|extra'
const supplierExtra = normalizeOrderCredential({ username: 'person', password: 'pass', email: null,
  additional_info: { original_line: supplierExtraLine } })
assert.equal(supplierExtra.original_line, supplierExtraLine)
assert.equal(supplierExtra.email, null, 'extra supplier fields must not be assigned a guessed label')
const supplierFiveColumnLine = '  person | secret | mail@example.test | mail-pass | otp-seed  '
const supplierExact = normalizeOrderCredential({ username: '  person ', password: ' secret ', email: ' mail@example.test ',
  email_password: ' mail-pass ', two_fa_code: ' otp-seed  ',
  additional_info: { original_line: supplierFiveColumnLine } })
assert.equal(supplierExact.password, ' secret ', 'display must preserve opaque supplier password bytes')
assert.equal(supplierExact.email_password, ' mail-pass ')
assert.equal(supplierExact.two_fa_code, ' otp-seed  ')
assert.equal(normalizeOrderCredentials(null).length, 0)

const page = fs.readFileSync('src/pages/OrderHistoryPage.tsx', 'utf8')
assert.ok(!page.includes('detectAccountFormat('), 'product credentials must not be classified as Twitter based on 2FA')
assert.ok(page.includes('USERNAME / LOGIN EMAIL'), 'Discord email-shaped usernames have an accurate label')
assert.ok(page.includes("label: 'ORIGINAL STOCK LINE'"), 'legacy raw line must be visible for direct copy and download')
console.log('Order credential display: actual three-field snapshot, five-column legacy line, unknown format preservation, and header regression passed.')
