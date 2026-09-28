# Historical source exposure

Local review date: 2026-09-24. This combines a reachable-Git-history source
audit with a read-only public-bundle check. Neither proves account compromise
or the deployed database state. No matched email addresses or credential
values are recorded here.

`npm run security:history-leaks` scanned 78 reachable commits. Literal personal
email addresses occurred in historical browser files
`src/contexts/SimpleAuth.tsx` and `src/pages/SimpleLogin.tsx`, and in server
functions `admin-adjust-balance`, `manage-staff`, and
`revenue-os-maintenance`. The committed browser auth code compared an email
literal when setting its client-side admin state. The current worktree uses
profile role fields instead and contains no matching personal email literal
in the current browser build, according to the local leak guard. Client-side
role display alone is not proof that database admin permissions were granted;
the deployed RLS and function definitions must be checked separately.

The two exact staff email addresses supplied during this incident were not
found by Git pickaxe in reachable `src`, `public`, `api`, or Edge-function
history. This does **not** explain how anyone learned them, and does not rule
out a public database response, a deployed artifact outside this checkout,
an account/profile listing, a staff communication, or a compromised mailbox.

The separate `.env` history audit identified non-placeholder values under
five provider/supplier secret-like variable names; see
`wallet-env-secret-inventory.md` for the names and owner rotation work. The
history scanner reports categories and paths only, never values. Its
`findingsPresent` result means older source contains material worth review,
not that the current release still serves it.

The 25 September path-scoped history scan also found secret-shaped literals in
historical `scripts/wallet-deployed-smoke-test.mjs`,
`scripts/wallet-deployed-version-evidence.mjs`,
`scripts/wallet-production-evidence-check.mjs`, and
`scripts/wallet-provider-evidence-template.mjs`. The current-tree signature
scan found no matching literals in those files. These may be synthetic test
values; the scanner cannot establish whether they were live credentials. The
owner must compare any relevant provider/dashboard key identities privately,
rotate active matches, and check whether the flagged commit was published.
Do not bypass repository push protection on the basis of this path-only scan.

A current-tree SQL sweep also found email-based read exceptions in the
historical `transaction_ledger_blocked_attempts` and `wallet_security_events`
RLS policies. Their source definitions now require current `profiles.is_admin`,
and migration `20260924011000_remove_email_based_financial_audit_access.sql`
replaces the policies on already-migrated databases. This is a repository
patch only; the read-only query pack has a deployed-policy check for the owner.

Owner verification still required: inspect actually deployed browser assets
and old deployment artifacts, compare production RLS/grants and role records,
review staff authentication and mailbox events, and rotate still-active
historical credentials. Preserve evidence before making corrective changes.

## Public bundle check, 24 September 2026

An unauthenticated GET of `https://tallystore.org/` returned HTTP 200 and
`/assets/index-DrJ7OMpz.js`. A cache-bypassed homepage GET returned the same
script path. In that public bundle, the previously identified owner-email
literal is still present, while the two exact staff-email literals supplied
during this incident were not found. The bundle references
`get_recent_activity_feed` but contains neither canonical admin financial-truth
RPC name nor the new admin fraud-visit RPC name. The new "Excess quarantined"
label is also absent. Only these named indicators were checked; this is not a
complete scan of every possible public identifier or secret.

This is evidence that the browser deployment is older than the current
worktree and that the owner-email exposure remains live. It does not prove
whether the activity RPC is executable or which database migrations are
applied. The owner should deploy the reviewed frontend only after staging
checks, then repeat the public-bundle scan; rotate any historical provider
credential confirmed active independently of frontend deployment.
