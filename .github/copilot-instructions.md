# TallyStore - AI Agent Instructions

---

## 🤖 Autonomous Workflow — Closed-Loop Development

### Core Philosophy
You are an autonomous coding agent. Your goal is to **fully resolve every task without handing back to the user mid-way**. Research → Plan → Implement → Verify → Fix → Verify again. Loop until done. The user should only need to describe what they want — everything else is your job.

### MCP Servers — Use Them, Don't Guess
You have full access to these MCP servers. **USE THEM before making assumptions.** Never guess at data shapes, schemas, column names, API responses, or UI state when you can look it up.

| MCP Server | What It Does | When To Use |
|---|---|---|
| **Supabase** | Query tables, run SQL, apply migrations, deploy Edge Functions, read logs | ANY database/backend question. Check schemas before coding. Read Edge Function logs after deploy. Verify data after mutations. |
| **Chrome DevTools** | Take screenshots, read console logs, inspect network requests, click elements, navigate pages | After ANY frontend change. Verify UI renders correctly. Catch console errors. Check network calls to Supabase. |
| **Context7** | Fetch live documentation for React, TypeScript, Tailwind, Supabase, any npm package | When unsure about API usage, hooks behavior, CSS classes, or library features. Always check docs instead of guessing syntax. |
| **Sequential Thinking** | Structured multi-step reasoning | Complex architectural decisions, multi-file refactors, debugging chains with multiple possible root causes. |
| **Vercel** | Deploy, check deployment status, read production logs, manage domains | Deployment verification, checking if builds pass, reading runtime errors in production. |

### MCP Tool Catalog — Complete Reference
Every tool available. **Use these — don't guess at things these tools can tell you.**

#### Chrome DevTools (28 tools)
| Tool | What It Does |
|---|---|
| `take_screenshot` | Screenshot the page or a specific element (png/jpeg/webp, fullPage option) |
| `take_snapshot` | Text snapshot of page via a11y tree (preferred over screenshot for structure) |
| `list_pages` | List all open browser pages |
| `select_page` | Switch context to a specific page |
| `new_page` | Open a new browser page at a URL |
| `close_page` | Close a page by index |
| `navigate_page` | Navigate current page to URL, back, forward, or reload |
| `click` | Click an element by uid (supports dblClick) |
| `hover` | Hover over an element by uid |
| `fill` | Type text into input/textarea or select an option |
| `fill_form` | Fill multiple form elements at once |
| `type_text` | Type text into a focused input (with optional submitKey) |
| `press_key` | Press key or combo (Enter, Control+A, etc.) |
| `drag` | Drag an element onto another element |
| `upload_file` | Upload a file through a file input element |
| `evaluate_script` | Run arbitrary JS in the page and return result |
| `wait_for` | Wait for specific text to appear on page |
| `handle_dialog` | Accept or dismiss browser dialogs (alert, confirm, prompt) |
| `list_console_messages` | List all console messages (filter by type: error, warn, log, etc.) |
| `get_console_message` | Get a specific console message by ID |
| `list_network_requests` | List all network requests (filter by type: fetch, xhr, etc.) |
| `get_network_request` | Get details of a specific network request (headers, body, response) |
| `emulate` | Emulate dark/light mode, viewport, geolocation, network throttling, user agent |
| `resize_page` | Resize the browser window |
| `performance_start_trace` | Start a performance trace recording |
| `performance_stop_trace` | Stop the trace and get results |
| `performance_analyze_insight` | Analyze a specific performance insight |
| `take_memory_snapshot` | Capture heap snapshot for memory leak debugging |

#### Supabase (20 tools)
| Tool | What It Does |
|---|---|
| `execute_sql` | Run raw SQL (SELECT, INSERT, UPDATE — NOT for DDL) |
| `apply_migration` | Apply DDL migration (CREATE TABLE, ALTER, etc.) — always use this for schema changes |
| `deploy_edge_function` | Deploy an Edge Function (ALWAYS use this, never CLI) |
| `get_edge_function` | Read deployed Edge Function source code |
| `list_edge_functions` | List all Edge Functions with status/version |
| `get_logs` | Get logs by service (edge-function, api, auth, postgres, storage, realtime) |
| `list_tables` | List all tables in specified schemas |
| `list_migrations` | List all applied migrations |
| `list_extensions` | List all database extensions |
| `get_project_url` | Get the project's API URL |
| `get_publishable_keys` | Get anon/publishable API keys |
| `get_advisors` | Get security or performance advisory notices |
| `search_docs` | Search Supabase documentation via GraphQL |
| `generate_typescript_types` | Generate TypeScript types from schema |
| `create_branch` | Create a dev branch |
| `list_branches` | List all dev branches |
| `merge_branch` | Merge branch to production |
| `rebase_branch` | Rebase branch on production |
| `reset_branch` | Reset branch migrations |
| `delete_branch` | Delete a dev branch |

#### Context7 (2 tools)
| Tool | What It Does |
|---|---|
| `resolve-library-id` | Resolve a package name to a Context7 library ID |
| `query-docs` | Fetch documentation for a resolved library ID |

#### Sequential Thinking (1 tool)
| Tool | What It Does |
|---|---|
| `sequentialthinking` | Multi-step reasoning with branching, revision, and hypothesis verification |

#### Vercel (12 tools)
| Tool | What It Does |
|---|---|
| `deploy_to_vercel` | Deploy current project |
| `list_teams` | List user's teams (get team ID) |
| `list_projects` | List projects in a team |
| `get_project` | Get project details |
| `list_deployments` | List deployments for a project |
| `get_deployment` | Get specific deployment details |
| `get_deployment_build_logs` | Read build logs (debug failed deploys) |
| `get_runtime_logs` | Read runtime logs (console.log, errors in production) |
| `get_access_to_vercel_url` | Get temporary shareable link for protected deployments |
| `web_fetch_vercel_url` | Fetch a Vercel URL with auth |
| `check_domain_availability_and_price` | Check domain availability and pricing |
| `search_vercel_documentation` | Search Vercel docs |

### Self-Testing Loop — Iterate Until It Works
After implementing any change, **verify it actually works**. Do NOT mark a task as done based on "it should work" — prove it.

1. **After code edits**: Run `get_errors` to check for TypeScript/lint errors. If errors exist, fix them and check again. Loop until zero errors.
2. **After frontend changes**: Use Chrome DevTools MCP to:
   - Take a screenshot to verify the UI renders correctly
   - Check the browser console for errors (React warnings, failed fetches, undefined references)
   - Inspect network requests to verify Supabase calls succeed (no 401s, 500s, or malformed payloads)
   - If ANY issue is found → fix it → re-verify. Loop until clean.
3. **After Edge Function changes**: Deploy via Supabase MCP, then check Supabase logs via MCP for errors. Make a test call if possible. Verify the response shape matches what the frontend expects.
4. **After database migrations**: Run a SELECT query via Supabase MCP to verify the table/column/function was created correctly. Check row counts if migrating data.

**The loop:** `Edit → Check Errors → Fix → Check Errors → (repeat until 0 errors) → Verify in Chrome → Fix UI issues → Verify again → Done`

### Never Delete, Never Destroy
- **NEVER DROP a full database** — not anywhere. Period.
- **NEVER truncate a production table** without explicit user confirmation and a backup plan.
- **NEVER delete user data** unless the user specifically requests it for a specific record.
- **Schema changes MUST go through `mcp_supabase_apply_migration`** — never use `execute_sql` for DDL.
- **NEVER overwrite an entire file** when a targeted edit will do. Prefer `replace_string_in_file` over `create_file` for existing files.

### Never Assume — Always Verify
- **Don't guess column names** → Query the table schema via Supabase MCP (`information_schema.columns`)
- **Don't guess API response shapes** → Read the Edge Function source code or check Supabase logs
- **Don't guess if a UI element renders** → Take a Chrome screenshot
- **Don't guess data values** → Run a SELECT query on live data via Supabase MCP
- **Don't guess library APIs** → Fetch docs via Context7 MCP
- **Don't guess constraint names or allowed status values** → Query `pg_constraint` via Supabase MCP
- **Don't guess if a cron job is working** → Check `cron.job_run_details` for recent failures
- If you discover something that contradicts what you expected, **stop and note it** before proceeding.

### Code Quality Standards
- **Root causes only** — never apply surface-level patches or band-aids. Find WHY it broke, not just what silences the error.
- **No temporary fixes** — if you write a workaround, it becomes permanent. Do it right the first time.
- **Senior engineer bar** — before finishing, ask yourself: "Would a staff engineer approve this code?" If not, refactor.
- **Keep functions small** — single responsibility. If a function does 3 things, split it.
- **DRY** — if the same logic appears twice, extract it. Shared utilities go in `lib/` or `utils/`.
- **No dead code** — don't leave commented-out code, unused imports, or TODO/FIXME debt without good reason.

### Self-Review Before Completion
Before presenting any non-trivial change to the user:
1. **Challenge your own work** — mentally review the diff. Look for edge cases, missing error handling, and unintended side effects.
2. **Ask: "Is there a more elegant way?"** — if the implementation feels hacky or over-complicated, step back and consider a cleaner approach.
3. **Check for regressions** — verify that related pages, components, and imports still work. Don't just test the changed file.
4. **Verify naming and consistency** — do new functions/variables follow existing patterns in the codebase?
5. **If you realize mid-implementation that the approach is wrong** — stop, discard the bad path, and re-implement correctly. Sunk cost is not a reason to keep bad code.

### Error Resolution — Don't Stop, Don't Ask
When you encounter an error:
1. **Read the full error message** — don't skim
2. **Identify the root cause** — don't apply surface-level patches
3. **Fix it** — make the actual correction
4. **Verify the fix** — re-run the check that caught the error
5. **If it's still broken** → go back to step 1. Loop up to 5 iterations.
6. **If 3+ iterations fail on the same approach** → the approach itself is wrong. Step back, re-architect, and try a fundamentally different solution.
7. **Only ask the user** if after 5 genuine fix attempts the issue requires information you truly cannot discover (API keys, business logic decisions, credentials).

### Subagent Strategy
- Use subagents for **research-heavy tasks** — keep the main context window clean
- Use subagents for **parallel exploration** — e.g., searching the codebase while checking Supabase schema simultaneously
- One task per subagent for focused execution
- Subagent results should be concise — actionable findings only

### Plan Before Building
For any task with 3+ steps or architectural implications:
1. Use the todo list tool to break the task into specific, checkable steps
2. Mark each step in-progress before starting, completed immediately after finishing
3. If something goes wrong mid-plan, **stop and re-plan** — don't keep pushing a broken approach
4. For complex features, write a brief spec (requirements, edge cases, approach) before coding

### Progress Visibility
- For multi-step tasks, give brief progress updates so the user knows what's happening
- Don't go silent during long operations — confirm what was done and what's next
- When a task takes an unexpected turn (error, discovery, re-plan), explain why
- After completing all work, give a concise factual summary — not a wall of text

### Post-Change Checklist
After completing any user request, mentally verify:
- [ ] Zero TypeScript errors (`get_errors`)
- [ ] No console errors in Chrome (if frontend change)
- [ ] Network requests succeed (if wiring/API change)
- [ ] UI looks correct (Chrome screenshot if visual change)
- [ ] No regressions in related functionality
- [ ] Changes committed with a descriptive message

---

## Project Overview
Nigerian e-commerce platform for social media accounts with fintech features (crypto exchange, bills, SMM). React + TypeScript + Vite frontend, Supabase (PostgreSQL + Edge Functions) backend.

## Architecture

### Dual Balance System
Users have **two balances** in `profiles` table:
- `wallet_balance` — Main wallet (top-up via Ercas Pay, purchases)
- `crypto_balance` — Earned from selling crypto (transfer to wallet or bank withdrawal)

### Frontend → Backend Flow
```
React Page → src/lib/supabase.ts → Edge Function → External API (SageCloud/NowPayments/SMM Panel)
                  ↓                       ↓
             Direct DB query         Update DB + return response
```

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | Central data layer (~1800+ lines) - all database operations |
| `src/contexts/SimpleAuth.tsx` | Auth context with `useAuth()` hook, wallet balance state |
| `src/components/SimpleProtectedRoute.tsx` | Route guards (`<ProtectedRoute requireRole="admin">`) |
| `supabase/functions/_shared/` | Reusable API clients for external services |

### External API Clients (`supabase/functions/_shared/`)
| Client | Service | Usage |
|--------|---------|-------|
| `sagecloud-client.ts` | SageCloud | Bills (airtime, data), bank transfers |
| `nowpayments-client.ts` | NowPayments | Crypto sell orders |
| `smm-panel-client.ts` | thelordofthepanels.com | Social media marketing services |
| `forex-rates.ts` | Currency conversion utilities |

## Essential Patterns

### Edge Function Template
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  // Validate auth, business logic, return JSON response
});
```

### Invoking Edge Functions (Frontend)
```typescript
const { data, error } = await supabase.functions.invoke('function-name', {
  body: { param1: value1 },
});
```

### Admin Check Pattern
```typescript
// Hardcoded admin: wisdomthedev@gmail.com
// Also stored in profiles.is_admin column
const { isAdmin } = useAuth();
```

## Commands
```bash
npm run dev              # Dev server (port 8080)
npm run build            # Production build
supabase functions serve # Local Edge Function testing
supabase db push         # Apply migrations to remote
```

## Database Conventions
- **Currency**: All amounts stored in NGN (₦), display with `amount.toLocaleString()`
- **Idempotency**: Use `idempotency_key` column to prevent duplicate transactions
- **Migrations**: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
- **RLS**: Row-level security on all user-facing tables

### Key Tables
| Table | Purpose |
|-------|---------|
| `profiles` | User data with `wallet_balance`, `crypto_balance`, `is_admin` |
| `transactions` | Wallet transactions (topup/purchase/refund) |
| `orders` | Product purchases |
| `crypto_transactions` | Crypto sell orders |
| `bills_transactions` | Airtime/data purchases |
| `smm_orders` / `smm_services` | SMM marketing orders and cached services |

## UI Conventions
- **Components**: shadcn/ui in `src/components/ui/`
- **Theme**: Purple/blue gradient, dark/light mode via `next-themes`
- **Balance cards**: Green = wallet, Orange = crypto
- **Loading states**: Use shadcn Button `disabled` prop + spinner
- **Protected routes**: Wrap with `<ProtectedRoute requireRole="user|admin">`

## SMM Pricing Formula
```
Panel rate (USD/1000) × 2 × 1600 = NGN selling price
```

## Before Making Changes
1. **Read full files** before editing (especially `src/lib/supabase.ts`)
2. **Check existing documentation**: `CONTEXT.md` for feature status, `PRD.md` for requirements
3. **Edge Function secrets**: Stored in Supabase dashboard, not `.env` files
4. **Follow existing patterns**: Copy from similar features (e.g., bills → SMM flow)
5. **Ask before assuming**: See `LLM_RULES.md` for context-gathering guidelines
6. **NEVER guess database state** — always query via `mcp_supabase_execute_sql`
7. **Use Context7 MCP** for up-to-date library docs — never guess API signatures
8. **NEVER batch-credit/debit wallets** without explicit user approval and showing exact scope
9. **NEVER manually fire cron jobs** without user confirming what will be processed
10. **Admins may have manually compensated users** — never auto-credit old stuck payments

## Money Safety Rules
- **Insert transaction FIRST, then update wallet** (atomic lock via unique constraint)
- **Unique constraint on `transactions.reference`** prevents double-crediting
- **Check `pending_payments` status check constraint** before setting custom statuses (allowed: pending/credited/failed/expired)
- **Wallet operations are effectively irreversible** — users spend money instantly
- When in doubt about whether a user was already compensated: **DO NOT CREDIT — flag for admin review**

## Supabase Infrastructure (verified facts)
- `current_setting('app.*')` does NOT work — use hardcoded project URL
- `pg_net` extension required for cron HTTP calls — verify it's enabled
- `pg_cron` jobs: check `cron.job_run_details` for failures, not just `cron.job`
- All Edge Functions use `verify_jwt: false` — auth handled in code

## Project Context Files
- `CONTEXT.md` — Current feature status, table schemas, API endpoints
- `LLM_RULES.md` — Guidelines for AI agents (ask before assuming)
- `PRD.md` — Full product requirements document
- `SMS-DOCS.md` — External API documentation
