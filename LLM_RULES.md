# 🤖 LLM Development Rules

> **Core Principle: NEVER ASSUME — ALWAYS VERIFY WITH DATA**

---

## 0. ABSOLUTE RULES (NON-NEGOTIABLE)

### NEVER GUESS — ALWAYS FACT-CHECK WITH MCP/SUPABASE
- **NEVER** assume database state — query with `mcp_supabase_execute_sql` first
- **NEVER** assume a schema, column, or constraint exists — verify with `information_schema` queries
- **NEVER** run bulk operations (credits, debits, mass updates) without explicit user approval
- **NEVER** manually trigger cron jobs or batch-process payments without user confirming scope
- **NEVER** assume admin actions — admins may have already compensated users manually
- **ALWAYS** use Context7 MCP for up-to-date library docs instead of guessing API signatures
- **ALWAYS** verify SQL results before acting — check row counts, amounts, affected users
- **ALWAYS** query the ACTUAL database state, not cached/assumed state from earlier in the conversation

### Money Operations — EXTREME CAUTION
- Wallet credits/debits are **irreversible in practice** (users spend money immediately)
- Before crediting: verify the payment is ACTUALLY successful at the payment gateway
- Before batch operations: show the user EXACTLY what will happen (user list, amounts, total)
- **NEVER** auto-credit old/stuck payments — flag for admin review instead
- The `transactions` table is the source of truth — unique constraint on `reference` prevents dupes
- Insert transaction FIRST, then update wallet (atomic lock pattern)
- If unsure whether a user was already compensated: **DO NOT CREDIT — ask the user**

### Cron Job Safety
- Cron jobs run automatically every N minutes — changes take effect IMMEDIATELY
- Before scheduling/modifying cron: verify the function handles idempotency correctly
- Before manually firing a cron: confirm with the user WHAT will be processed and HOW MANY
- The `check-pending-payments` cron processes up to 50 pending payments per run
- The `pending_payments.status` check constraint allows: 'pending', 'credited', 'failed', 'expired'
- `pg_cron` uses `pg_net` for HTTP calls — both extensions must be enabled
- `current_setting('app.*')` does NOT work on Supabase — use hardcoded URLs instead

---

## 1. Context Gathering (Before ANY Work)

### Always Request:
- Current file contents before editing
- Table definitions before writing SQL — **verify with `information_schema` queries via MCP**
- Existing patterns before creating new components
- Business requirements before implementing logic
- User preferences before making design decisions

### Never:
- Assume database schema — **query `information_schema.columns` via MCP**
- Assume file structure — ask or search first
- Assume naming conventions — check existing code
- Assume business logic — clarify requirements
- Assume UI preferences — ask for design direction
- Assume a column, constraint, or extension exists — **verify via SQL query**

---

## 2. Database Operations

### Before Writing SQL:
```
□ Request current table definition
□ Check for existing related tables
□ Verify column names and types
□ Ask about RLS policies needed
□ Confirm foreign key relationships
```

### Before Creating Tables:
```
□ Confirm table doesn't already exist
□ Ask for required columns and types
□ Clarify constraints and defaults
□ Discuss indexing needs
□ Plan RLS policies
```

---

## 3. Code Modifications

### Before Editing Files:
```
□ Read the FULL file (not just snippets)
□ Understand connected components
□ Check for side effects
□ Verify import paths
□ Test after changes
```

### Before Creating New Files:
```
□ Confirm file doesn't exist
□ Match existing project patterns
□ Use consistent naming conventions
□ Follow established folder structure
```

---

## 4. API & External Services

### Before Integration:
```
□ Request API documentation or endpoints
□ Ask for API keys/credentials
□ Clarify where secrets are stored
□ Understand rate limits
□ Plan error handling
```

---

## 5. UI/UX Decisions

### Always Ask About:
- Navigation placement
- Color scheme consistency
- Mobile responsiveness needs
- Loading/error states
- User flow preferences

---

## 6. Communication Style

### Do:
- Ask clarifying questions upfront
- Propose plans before implementing
- Explain trade-offs and options
- Request feedback on approach
- Summarize understanding before proceeding

### Don't:
- Make assumptions to "save time"
- Implement without confirmation
- Skip validation steps
- Ignore edge cases
- Assume user intent

---

## 7. Quality Checklist

Before delivering any solution:
```
□ Does it match the request exactly?
□ Did I verify all assumptions with actual data (MCP queries)?
□ Are there any missing pieces?
□ Did I test or validate the code?
□ Are error cases handled?
□ For money operations: did I get explicit user approval?
□ For bulk operations: did I show the user the exact scope?
```

---

## 8. When Uncertain

**Ask questions like:**
- "Can you share the current [file/table/component]?"
- "What's your preference for [X vs Y]?"
- "Should this follow the pattern in [existing feature]?"
- "What's the expected behavior when [edge case]?"
- "Where should I find [credentials/config/docs]?"

---

## 9. Supabase-Specific Rules

### Infrastructure Facts (verified, do not guess)
- **Project ID**: `dssvvswvqnxanyzfhixf` (region: eu-north-1)
- **pg_net**: Must be enabled for cron HTTP calls. Creates `net` schema.
- **pg_cron**: Runs in `cron` schema. Jobs visible in `cron.job`, logs in `cron.job_run_details`.
- **`current_setting('app.*')`**: Does NOT work on Supabase Cloud — permission denied to set custom GUC params. Use hardcoded URLs.
- **Edge Functions**: All use `verify_jwt: false`. Auth handled in function code.
- **Service Role calls**: Pass `user_id` in body, verify auth header contains service role key.
- **Allowed `pending_payments.status` values**: `'pending'`, `'credited'`, `'failed'`, `'expired'` — enforced by CHECK constraint.

### Verify Before Acting
```
□ Query actual table schema before writing INSERT/UPDATE
□ Check constraint names/definitions before assuming status values
□ Verify extension existence before using (e.g., pg_net, pg_cron)
□ Check cron.job_run_details for recent failures before assuming cron works
□ Verify with mcp_supabase_execute_sql — NEVER guess database state
```

---

*Remember: A SQL query takes 2 seconds. Guessing wrong costs hours of damage control and real money.*
