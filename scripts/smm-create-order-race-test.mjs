import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/smm-create-order/index.ts', import.meta.url), 'utf8')
const contractSource = readFileSync(new URL('../supabase/functions/_shared/smm-order-contract.ts', import.meta.url), 'utf8')
const contractCode = ts.transpileModule(contractSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const contract = await import(`data:text/javascript;base64,${Buffer.from(contractCode).toString('base64')}`)
let handler
let fixture
globalThis.__smmRaceTest = {
  ...contract,
  serve: callback => { handler = callback },
  createClient: () => fixture.client(++fixture.clients),
  authenticateCustomerRequest: async () => ({ id: fixture.user }),
  smmPanelRequest: async (_url, _key, params) => {
    assert.equal(params.action, 'add')
    fixture.paidAdds++
    fixture.sentParams = params
    return fixture.panelReply ?? { order: 12345 }
  },
}
globalThis.Deno = { env: { get: name => name === 'SMM_ORDERS_ENABLED' ? 'true' : 'TEST_ONLY_KEY' } }
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText.replace(/^import .*(?:\r?\n|$)/gm, '')
const injection = `const { serve, createClient, authenticateCustomerRequest, smmPanelRequest, quoteSmmOrder, validateSmmOrderFields, SMM_QUANTITY_TYPES, SMM_UNAVAILABLE } = globalThis.__smmRaceTest;\nconst console = { error() {}, warn() {}, log() {} };\n${compiled}`
await import(`data:text/javascript;base64,${Buffer.from(injection).toString('base64')}`)
assert.equal(typeof handler, 'function')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function makeFixture({ expectedOrphanReaders = 2, delayedFirstInsert = false, lostInsertAck = false, lateInsertCommit = false, lostClaimAck = false, panelReply = null, serviceType = 'Default', serviceMin = 1000 } = {}) {
  const user = randomUUID(), serviceId = randomUUID(), key = 'race-'+randomUUID()
  let orphanArrivals = 0, releaseOrphans
  const orphanBarrier = new Promise(resolve => { releaseOrphans = resolve })
  const state = {
    user, serviceId, key, panelReply, clients: 0, order: null, debit: null, claims: new Set(), paidAdds: 0,
    debitAttempts: 0, refunds: 0, inserts: 0, insertErrors: 0, claimAttempts: 0,
    async request(link = 'https://example.invalid/post', extra = {}) {
      return handler(new Request('https://example.invalid/functions/v1/smm-create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: serviceId, link, quantity: 1000, expected_price_ngn: 500,
          idempotency_key: key, ...extra }),
      }))
    },
    client(clientNo) {
      return {
        rpc: async (name, args) => {
          if (name === 'wallet_financial_truth_internal')
            return { data: { spending_blocked: false, confirmed_spendable: 5000 }, error: null }
          if (name === 'apply_wallet_transaction') {
            assert.equal(args.p_user_id, user)
            if (args.p_type === 'refund') { state.refunds++; throw new Error('unsafe automatic refund') }
            state.debitAttempts++
            if (!state.debit) {
              state.debit = { id: randomUUID(), user_id: user, reference: args.p_reference,
                idempotency_key: args.p_idempotency_key, amount: -args.p_amount,
                metadata: args.p_metadata, type: 'purchase', status: 'completed', balance_type: 'wallet' }
              return { data: { success: true, transaction: state.debit, balance_after: 4500 }, error: null }
            }
            // Actual wallet SQL compares replay reference as well as amount.
            if (state.debit.reference !== args.p_reference)
              return { data: { success: false, error: 'idempotency_key_reused_with_different_transaction' }, error: null }
            return { data: { success: true, idempotent_replay: true, transaction: state.debit,
              balance_after: 4500 }, error: null }
          }
          if (name === 'claim_smm_dispatch') {
            state.claimAttempts++
            assert.equal(args.p_debit_transaction_id, state.debit.id)
            assert.equal(args.p_payload_sha256, state.order.dispatch_payload_sha256)
            assert.equal(args.p_order_id, state.order.id)
            assert.equal(state.debit.metadata.dispatch_payload_sha256, args.p_payload_sha256)
            if (state.claims.has(args.p_order_id)) return { data: { success: true, send_allowed: false }, error: null }
            state.claims.add(args.p_order_id)
            if (lostClaimAck) return { data: null, error: { code: 'TEST_LOST_ACK' } }
            return { data: { success: true, send_allowed: true }, error: null }
          }
          throw new Error(`unexpected RPC ${name}`)
        },
        from: table => new Query(state, table, clientNo),
      }
    },
  }
  class Query {
    constructor(s, table, client) { this.s=s;this.table=table;this.client=client;this.filters=[];this.kind='read' }
    select() { return this }
    eq(name,value) { this.filters.push([name,value]);return this }
    in() { return this }
    limit() { return this }
    insert(value) { this.kind='insert';this.value=value;return this }
    update(value) { this.kind='update';this.value=value;return this }
    upsert() { this.kind='upsert';return this }
    single() { return this.execute(true) }
    maybeSingle() { return this.execute(true) }
    then(resolve,reject) { return this.execute(false).then(resolve,reject) }
    async execute(single) {
      const filter = name => this.filters.find(row => row[0] === name)?.[1]
      if (this.table === 'revenue_events') return { error: null }
      if (this.table === 'profiles') return { data: filter('id') === user
        ? { is_staff:false,is_admin:false,account_suspended:false,financial_security_version:1 } : null, error: null }
      if (this.table === 'smm_services') return { data: { id:serviceId, external_id:22,service_type:serviceType,
        is_active:true,name:'Synthetic',platform:'instagram',price_ngn:500,rate_usd:0.5,
        min_quantity:serviceMin,max_quantity:10000 },error:null }
      if (this.table === 'transactions') {
        if (filter('idempotency_key') === `smm:purchase:${key}`) {
          orphanArrivals++
          if (orphanArrivals >= expectedOrphanReaders) releaseOrphans()
          await orphanBarrier
          return { data: null, error: null }
        }
        throw new Error('unexpected transaction query')
      }
      if (this.table !== 'smm_orders') throw new Error(`unexpected table ${this.table}`)
      if (this.kind === 'insert') {
        state.inserts++
        if (delayedFirstInsert && this.client === 1) await pause(20)
        const newOrder = { id: randomUUID(), ...this.value }
        if (state.order) { state.insertErrors++;return { data:null,error:{ code:'23505' } } }
        state.order = newOrder
        if (lateInsertCommit) {
          state.order = null
          setTimeout(() => { state.order = newOrder }, 20)
          state.insertErrors++
          return { data:null,error:{ code:'TEST_LOST_ACK' } }
        }
        if (lostInsertAck) { state.insertErrors++;return { data:null,error:{ code:'TEST_LOST_ACK' } } }
        return { data:newOrder,error:null }
      }
      if (this.kind === 'update') {
        if (state.order?.id === filter('id')) Object.assign(state.order,this.value)
        return { data:null,error:null }
      }
      if (filter('idempotency_key') === key) return { data: single ? state.order : state.order ? [state.order] : [], error:null }
      if (filter('status') === 'outcome_unknown') return { data:state.order?.status === 'outcome_unknown'?[state.order]:[],error:null }
      // Model both concurrent preflight reads completing before the winning
      // insert, so the test exercises the debit/claim race rather than relying
      // on the advisory duplicate-link query to serialize requests.
      if (filter('service_id') === serviceId) return { data:[],error:null }
      throw new Error('unexpected order query')
    }
  }
  return state
}

const originalRandom=Math.random,originalNow=Date.now
try {
  Date.now=()=>1_700_000_000_000
  // Two requests with different references: the wallet engine rejects the
  // replay before the second can create an order or send a paid request.
  fixture=makeFixture()
  let n=0;Math.random=()=>++n/100
  const distinct=await Promise.all([fixture.request(),fixture.request()])
  assert.equal(fixture.debitAttempts,2)
  assert.equal(fixture.inserts,1)
  assert.equal(fixture.paidAdds,1)
  assert.equal(fixture.refunds,0)
  assert.deepEqual(distinct.map(r=>r.status).sort(),[200,400])

  // Force identical references so both requests reach the insert. Reverse
  // arrival order and prove that the unique local row + one-use claim sends once.
  fixture=makeFixture({delayedFirstInsert:true})
  Math.random=()=>0.123456789
  const same=await Promise.all([fixture.request(),fixture.request()])
  assert.equal(fixture.debitAttempts,2)
  assert.equal(fixture.inserts,2)
  assert.equal(fixture.insertErrors,1)
  assert.equal(fixture.paidAdds,1)
  assert.equal(fixture.refunds,0)
  assert.deepEqual(same.map(r=>r.status).sort(),[200,202])

  fixture=makeFixture({expectedOrphanReaders:1,lostInsertAck:true})
  assert.equal((await fixture.request()).status,202)
  assert.ok(fixture.order)
  assert.equal(fixture.paidAdds,0)
  assert.equal(fixture.refunds,0)

  fixture=makeFixture({expectedOrphanReaders:1,lateInsertCommit:true})
  assert.equal((await fixture.request()).status,202)
  await pause(30)
  assert.ok(fixture.order)
  assert.equal(fixture.paidAdds,0)
  assert.equal(fixture.refunds,0)

  fixture=makeFixture({expectedOrphanReaders:1,lostClaimAck:true})
  const held=[await fixture.request()]
  assert.equal(fixture.claims.size,1)
  assert.equal(fixture.paidAdds,0)
  assert.equal(fixture.refunds,0)
  assert.ok(held.some(r=>r.status===202))
  assert.equal((await fixture.request()).status,202)
  assert.equal(fixture.paidAdds,0)

  for (const orderValue of ['12345', { id: 12345 }, -1, 0, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    fixture=makeFixture({expectedOrphanReaders:1,panelReply:{order:orderValue}})
    const response=await fixture.request()
    assert.equal(response.status,202,`malformed order ID ${typeof orderValue} must stay under review`)
    assert.equal((await response.json()).code,'SMM_SUPPLIER_OUTCOME_UNKNOWN')
    assert.equal(fixture.order.status,'outcome_unknown')
    assert.equal(fixture.order.external_order_id ?? null,null)
    assert.equal(fixture.paidAdds,1)
    assert.equal(fixture.claims.size,1)
    assert.equal(fixture.refunds,0)
    assert.equal((await fixture.request()).status,202)
    assert.equal(fixture.paidAdds,1)
  }

  for (const [serviceType, input, expectedQuantity, expectedPrice] of [
    ['Custom Comments', { comments: 'first\r\n\nsecond', quantity: 1 }, 2, 1],
    ['Comment Replies', { username: 'owner', comments: 'first\nsecond', quantity: 1 }, 2, 1],
    ['Mentions Custom List', { usernames: 'alice\n\nbob', quantity: 1 }, 2, 1],
    ['Custom Comments Package', { comments: 'first\nsecond' }, 1, 500],
    ['Package', {}, 1, 500],
    ['SEO', { keywords: 'news\ntechnology', quantity: 100 }, 100, 50],
    ['Poll', { answer_number: 2, quantity: 100 }, 100, 50],
  ]) {
    fixture = makeFixture({ expectedOrphanReaders: 1, serviceType, serviceMin: 1 })
    const response = await fixture.request(undefined, { ...input, expected_price_ngn: expectedPrice })
    assert.equal(response.status, 200, serviceType)
    assert.equal(fixture.debit.amount, -expectedPrice, serviceType)
    assert.equal(fixture.order.quantity, expectedQuantity, serviceType)
    assert.equal(fixture.order.dispatch_payload_sha256, fixture.debit.metadata.dispatch_payload_sha256)
    assert.equal(fixture.paidAdds, 1)
    if (['Custom Comments', 'Comment Replies', 'Mentions Custom List', 'Package', 'Custom Comments Package'].includes(serviceType)) {
      assert.equal(fixture.sentParams.quantity, undefined, 'derived/package quantity must not be sent as explicit quantity')
    } else assert.equal(fixture.sentParams.quantity, expectedQuantity)
    if (input.comments) assert.equal(fixture.sentParams.comments, input.comments.split(/\r?\n/).filter(Boolean).join('\n'))
  }
  for (const [serviceType, input] of [
    ['Custom Comments', { comments: Array(10).fill('comment').join('\n'), quantity: 1, expected_price_ngn: 1 }],
    ['Mentions Custom List', { usernames: 'a\nb\nc\nd', quantity: 1, expected_price_ngn: 1 }],
    ['Default', { link: { private: 'not a string' } }],
    ['Subscriptions', { username: 'owner' }], ['Mentions Media Likers', { username: 'owner' }], ['Unknown Type', {}],
  ]) {
    fixture = makeFixture({ expectedOrphanReaders: 1, serviceType, serviceMin: 1 })
    assert.equal((await fixture.request(undefined, input)).status, 400, serviceType)
    assert.equal(fixture.debitAttempts, 0, 'bad/unpriced requests must fail before debit')
    assert.equal(fixture.paidAdds, 0)
  }

  console.log(JSON.stringify({actualHandler:true,distinctReferenceConflict:true,reversedInsertWinner:true,
    oneDebitPerIntent:true,onePaidAddMaximum:true,lostInsertAckNoRefund:true,lateInsertCommitNoRefund:true,
    lostClaimAckNoSend:true,malformedSupplierOrderIdsHeld:true,derivedQuantityPricing:true,packagesFixed:true,
    seoPollQuantity:true,underpricingAndUnsupportedDeniedBeforeDebit:true,paidProviderCalls:0,productionWrites:0}))
} finally {Math.random=originalRandom;Date.now=originalNow}
