import { runSourceMigration } from './source-migration-runner.mjs'

const version = '20261005032000'
const routine = 'public.apply_profile_referral_attribution(uuid,text)'
const guards = `SELECT
  NOT has_function_privilege('anon','${routine}','EXECUTE') AS anon_denied,
  NOT has_function_privilege('authenticated','${routine}','EXECUTE') AS browser_denied,
  has_function_privilege('service_role','${routine}','EXECUTE') AS service_allowed,
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
    FROM pg_proc WHERE oid='${routine}'::regprocedure) AS definer_pinned,
  strpos(pg_get_functiondef('${routine}'::regprocedure),'pg_advisory_xact_lock(723859217, 1)')>0 AS cycle_serialized,
  strpos(pg_get_functiondef('${routine}'::regprocedure),'wallet_financial_truth_internal(p_user_id)')>0 AS trusted_funding_required,
  strpos(pg_get_functiondef('${routine}'::regprocedure),'legacy_first_recorded_funding_at')>0 AS historical_funding_checked,
  strpos(pg_get_functiondef('${routine}'::regprocedure),'referral_cycle_denied')>0 AS ancestry_guard_present,
  public.tally_circle_launch_enabled() IS FALSE AS circle_paused`

await runSourceMigration({
  version,
  name: 'referral_attribution_funding_boundary',
  routine,
  guards,
  migrationPath: `supabase/migrations/${version}_referral_attribution_funding_boundary.sql`,
  probePath: 'scripts/catalog/referral-attribution-live-probe.sql',
  cleanup: `SELECT
    strpos(pg_get_functiondef('${routine}'::regprocedure),'pg_advisory_xact_lock(723859217, 1)')=0 AS original_function_restored,
    NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS history_unchanged,
    public.tally_circle_launch_enabled() IS FALSE AS circle_paused`,
})
