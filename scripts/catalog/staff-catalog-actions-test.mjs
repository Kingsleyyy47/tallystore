import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Remove import declarations by AST span: the encrypted deployed entry can
// contain multiline imports. Only auth/database transports are mocked below.
function compiledEntry(source) {
  const ast = ts.createSourceFile('manage-staff/index.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const imports = ast.statements.filter(node => ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node))
  let withoutImports = source
  for (const node of imports.reverse()) withoutImports = withoutImports.slice(0, node.getFullStart()) + withoutImports.slice(node.end)
  return ts.transpileModule(withoutImports, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
}

async function candidateEntry(prefix) {
  const [{ decryptMemory }, { parseReviewedEszip }] = await Promise.all([
    import('../migration.local/encryption.mjs'),
    import('../migration.local/eszip-reviewed-parser.mjs'),
  ])
  const metadata = JSON.parse(readFileSync(`${prefix}.json`, 'utf8'))
  assert.equal(metadata.encryptedCandidatePrefix, prefix)
  assert.equal(metadata.entrySpecifier, 'manage-staff/index.ts')
  const bytes = await decryptMemory(prefix)
  try {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.candidateBodySha256)
    const parsed = parseReviewedEszip(bytes)
    const entry = parsed.modules.find(module => module.specifier === metadata.entrySpecifier)
    assert.ok(entry?.source?.length, 'Candidate manage-staff entry missing')
    assert.equal(createHash('sha256').update(entry.source).digest('hex'), metadata.entrySourceSha256)
    return entry.source.toString('utf8')
  } finally { bytes.fill(0) }
}

async function exercise(source, label) {
const code = compiledEntry(source)

const categoryId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const auditId = '33333333-3333-4333-8333-333333333333'
const staffUser = { id: 'staff-user', email: 'staff@example.com' }

async function run({
  user = staffUser,
  profile = { is_staff: true, is_admin: false, account_suspended: false },
  permission = { is_enabled: true, auto_approve: true },
  category = { id: categoryId, is_active: true },
  actionType = 'create_product_group',
  actionData = { category_id: categoryId, name: '  EU Accounts  ', description: '  Verified stock  ', price: '2800.00' },
  permissionKey = 'tab_products',
  productExists = true,
  authUser = true,
  auditFails = false,
} = {}) {
  const events = []
  const errors = []
  const created = []
  const updated = []
  let handler
  let clientCount = 0
  const admin = {
    from(table) {
      const query = { table, fields: null, filters: [], row: null }
      const chain = {
        select(fields) { query.fields = fields; return chain },
        eq(field, value) { query.filters.push([field, value]); return chain },
        insert(row) {
          query.row = row
          events.push(`${table}:insert`)
          if (table === 'product_groups') created.push(row)
          return chain
        },
        update(row) {
          query.row = row
          events.push(`${table}:update`)
          return chain
        },
        async single() {
          if (table === 'profiles') return { data: profile && { id: user?.id, email: user?.email, ...profile }, error: null }
          if (table === 'staff_pending_actions') return { data: auditFails ? null : { id: auditId }, error: auditFails ? { message: 'audit failed' } : null }
          if (table === 'product_groups') return { data: { id: query.row?.id || productId }, error: null }
          throw new Error(`Unexpected single(${table})`)
        },
        async maybeSingle() {
          if (table === 'profiles') return { data: profile, error: null }
          if (table === 'staff_permissions') return { data: permission, error: null }
          if (table === 'categories') return { data: category, error: null }
          if (table === 'product_groups') {
            updated.push({ id: query.filters.find(([field]) => field === 'id')?.[1], fields: query.row })
            return { data: productExists ? { id: productId } : null, error: null }
          }
          throw new Error(`Unexpected maybeSingle(${table})`)
        },
        then(resolve, reject) {
          return Promise.resolve({ error: table === 'staff_pending_actions' && auditFails ? { message: 'audit failed' } : null }).then(resolve, reject)
        },
      }
      return chain
    },
  }
  const context = {
    Request, Response, Headers, URL, crypto, TextEncoder, setTimeout, clearTimeout, exports: {},
    console: { log() {}, warn() {}, error(...args) { errors.push(args.map(String).join(' ')) } },
    Deno: { env: { get: key => key === 'TALLYSTORE_OWNER_USER_ID' ? 'owner-user' : 'test-only' } },
    serve: callback => { handler = callback },
    createClient: () => ++clientCount === 1
      ? { auth: { getUser: async () => ({ data: { user: authUser ? user : null }, error: null }) } }
      : admin,
  }
  vm.runInNewContext(code, context)
  const response = await handler(new Request('https://local/functions/v1/manage-staff', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit_staff_action', permission_key: permissionKey, action_type: actionType, action_data: actionData }),
  }))
  return { status: response.status, body: await response.json(), events, created, updated, errors }
}

const created = await run()
assert.equal(created.status, 200, created.errors.join('\n'))
assert.equal(created.body.applied, true)
assert.equal(created.body.product_group_id, auditId)
assert.deepEqual(created.events, ['staff_pending_actions:insert', 'product_groups:insert'])
assert.deepEqual(Object.keys(created.created[0]).sort(), ['auto_fulfill_enabled', 'category_id', 'description', 'id', 'name', 'price'])
assert.equal(created.created[0].id, auditId)
assert.equal(created.created[0].name, 'EU Accounts')
assert.equal(created.created[0].description, 'Verified stock')
assert.equal(created.created[0].auto_fulfill_enabled, false)
assert.equal(created.created[0].stock_count, undefined)

const edited = await run({ actionType: 'update_product_group', actionData: { id: productId, updates: { category_id: categoryId, name: '  New name ', description: ' New description ', price: '2750.50' } } })
assert.equal(edited.status, 200)
assert.equal(edited.body.applied, true)
assert.deepEqual(edited.events, ['staff_pending_actions:insert', 'product_groups:update'])
assert.equal(edited.updated[0].id, productId)
assert.equal(edited.updated[0].fields.name, 'New name')
assert.equal(edited.updated[0].fields.description, 'New description')
assert.equal(edited.updated[0].fields.price, 2750.5)

const queued = await run({ permission: { is_enabled: true, auto_approve: false } })
assert.equal(queued.status, 200)
assert.equal(queued.body.queued, true)
assert.equal(queued.body.applied, false)
assert.deepEqual(queued.events, ['staff_pending_actions:insert'])

const inactiveCategory = await run({ category: { id: categoryId, is_active: false } })
assert.equal(inactiveCategory.status, 500)
assert.deepEqual(inactiveCategory.events, ['staff_pending_actions:insert', 'staff_pending_actions:update'])
assert.equal(inactiveCategory.created.length, 0)

for (const options of [
  { permission: { is_enabled: false, auto_approve: true } },
  { profile: { is_staff: true, is_admin: false, account_suspended: true } },
  { profile: { is_staff: false, is_admin: false, account_suspended: false } },
  { authUser: false },
]) {
  const denied = await run(options)
  assert.ok([401, 403].includes(denied.status))
  assert.deepEqual(denied.events, [])
}

for (const options of [
  { category: null },
  { actionData: { category_id: categoryId, name: 'Fake stock', price: 100, stock_count: 100 } },
  { actionData: { category_id: categoryId, name: 'Wallet injection', price: 100, wallet_balance: 10000 } },
  { actionData: { category_id: categoryId, name: 'Bad price', price: '1.234' } },
  { actionData: { category_id: categoryId, name: 'Bad price', price: 0 } },
  { actionType: 'update_product_group', actionData: { id: productId, updates: { stock_count: 99 } } },
  { actionType: 'update_product_group', actionData: { id: productId, updates: { wallet_balance: 999 } } },
  { actionType: 'update_product_group', actionData: { id: productId, updates: { name: 'New name' } }, productExists: false },
]) {
  const invalid = await run(options)
  assert.equal(invalid.status, 500)
  assert.equal(invalid.created.length, 0)
  if (options.productExists === false) {
    assert.equal(invalid.updated.length, 1)
    assert.deepEqual(invalid.events, ['staff_pending_actions:insert', 'product_groups:update', 'staff_pending_actions:update'])
  } else {
    assert.equal(invalid.updated.length, 0)
    if (options.actionData?.stock_count || options.actionData?.wallet_balance || options.actionData?.price === '1.234' || options.actionData?.price === 0 || options.actionData?.updates) {
      assert.deepEqual(invalid.events, [])
    }
  }
}

const auditFailure = await run({ auditFails: true })
assert.equal(auditFailure.status, 503)
assert.deepEqual(auditFailure.events, ['staff_pending_actions:insert'])
assert.equal(auditFailure.created.length, 0)

console.log(`${label}: staff catalog handler create/edit, queue/approval, active category, strict fields/prices, audit ordering, and authorization denials passed.`)
}

await exercise(readFileSync('supabase/functions/manage-staff/index.ts', 'utf8'), 'Local source')
const candidatePrefix = process.env.STAFF_CATALOG_ESZIP_PREFIX
if (candidatePrefix) await exercise(await candidateEntry(candidatePrefix), 'Encrypted candidate')
