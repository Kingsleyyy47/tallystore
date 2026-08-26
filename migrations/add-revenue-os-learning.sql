-- ============================================================
-- Revenue OS: Measurement & Learning Layer
-- Run in Supabase SQL Editor AFTER existing schema is in place
-- All statements are safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ============================================================

-- ── 1. Extend revenue_events with intervention / decision linkage ────────────
alter table revenue_events add column if not exists intervention_id uuid;
alter table revenue_events add column if not exists decision_id     text;

create index if not exists idx_revenue_events_intervention_id
  on revenue_events (intervention_id) where intervention_id is not null;

-- ── 2. CRO Interventions ─────────────────────────────────────────────────────
-- One row per customer-facing CRO action (externally visible event).
-- Internal scoring calculations are NOT interventions.
create table if not exists cro_interventions (
  id                  uuid        primary key default gen_random_uuid(),
  decision_id         text,                       -- references cro_decision_audit.decision_id
  session_id          text,
  visitor_id          text,
  customer_id         uuid,

  action_type         text        not null,        -- SHOW_UPGRADE, SHOW_ALTERNATIVE, etc.
  source_product_id   uuid,
  target_product_id   uuid,
  surface             text        not null,        -- product_page | homepage | chat | post_purchase

  experiment_id       text,
  variant_id          text,
  strategy_key        text,                        -- logical key for grouping strategy stats

  -- Exposure funnel timestamps (each set once, idempotent)
  rendered_at         timestamptz,                 -- component mounted in DOM
  viewed_at           timestamptz,                 -- >= 50% visible for >= 500 ms
  clicked_at          timestamptz,                 -- customer clicked recommendation
  dismissed_at        timestamptz,                 -- customer explicitly dismissed
  buy_clicked_at      timestamptz,                 -- customer clicked buy on the recommended product

  -- Attribution
  attributed_order_id uuid,
  attributed_at       timestamptz,
  attribution_type    text,                        -- direct | assisted | none
  attribution_window_h int,                        -- 24 | 168 (7d) | 720 (30d)

  -- Outcome lifecycle
  outcome             text        not null default 'pending',
  -- pending | purchased | dismissed | ignored
  outcome_closed_at   timestamptz,

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists idx_cro_interventions_session    on cro_interventions (session_id);
create index if not exists idx_cro_interventions_visitor    on cro_interventions (visitor_id);
create index if not exists idx_cro_interventions_customer   on cro_interventions (customer_id);
create index if not exists idx_cro_interventions_outcome    on cro_interventions (outcome, created_at);
create index if not exists idx_cro_interventions_strategy   on cro_interventions (strategy_key);
create index if not exists idx_cro_interventions_experiment on cro_interventions (experiment_id, variant_id);

-- ── 3. CRO Outcomes ──────────────────────────────────────────────────────────
-- Written once per attribution window close by the revenue-os-loop function.
create table if not exists cro_outcomes (
  id                      uuid    primary key default gen_random_uuid(),
  intervention_id         uuid    not null references cro_interventions (id) on delete cascade,
  order_id                uuid,
  outcome_type            text    not null,  -- purchased | dismissed | ignored | reversed
  revenue_ngn             numeric,
  attribution_type        text,              -- direct | assisted | incremental_estimate
  window_h                int,
  is_incremental_estimate boolean default false,
  confidence              numeric,
  created_at              timestamptz default now()
);

create index if not exists idx_cro_outcomes_intervention on cro_outcomes (intervention_id);
create index if not exists idx_cro_outcomes_order        on cro_outcomes (order_id) where order_id is not null;

-- ── 4. Sticky experiment assignments ─────────────────────────────────────────
-- Written on first exposure so variant never changes mid-experiment.
create table if not exists cro_experiment_assignments (
  subject_key       text        not null,   -- visitor_id or user_id
  experiment_key    text        not null,
  variant_id        text        not null,
  is_holdout        boolean     default false,
  is_global_holdout boolean     default false,
  assigned_at       timestamptz default now(),
  exposed_at        timestamptz,
  primary key (subject_key, experiment_key)
);

create index if not exists idx_cro_assignments_experiment on cro_experiment_assignments (experiment_key);

-- ── 5. Strategy stats & learning states ──────────────────────────────────────
create table if not exists cro_strategy_stats (
  id                          uuid    primary key default gen_random_uuid(),
  strategy_key                text    unique not null,
  action_type                 text    not null,
  surface                     text    not null default 'all',
  context_key                 text    not null default 'all',

  -- Learning state machine
  -- NEW | EXPLORING | PROMISING | PROVEN | DECLINING | HARMFUL | RETIRED
  learning_state              text    not null default 'NEW',

  -- Exposure funnel (treatment arm)
  total_rendered              bigint  not null default 0,
  total_viewed                bigint  not null default 0,
  total_clicked               bigint  not null default 0,
  total_dismissed             bigint  not null default 0,
  total_purchases             bigint  not null default 0,
  total_revenue_ngn           numeric not null default 0,

  -- Control arm (from experiments / global holdout)
  control_rendered            bigint  not null default 0,
  control_purchases           bigint  not null default 0,
  control_revenue_ngn         numeric not null default 0,

  -- Calculated (updated by learning loop)
  view_rate                   numeric,   -- viewed / rendered
  click_rate                  numeric,   -- clicked / viewed
  purchase_rate               numeric,   -- purchases / viewed
  control_purchase_rate       numeric,
  uplift_pp                   numeric,   -- treatment_purchase_rate - control_purchase_rate (percentage points)
  uplift_revenue_per_visitor  numeric,   -- (treatment_rpv - control_rpv) in NGN
  confidence                  numeric,   -- statistical confidence 0–1

  -- Guardrail deltas (relative to control)
  exit_rate_delta             numeric,
  refund_rate_delta           numeric,
  payment_completion_delta    numeric,
  guardrails_healthy          boolean    default true,

  -- Linkage
  experiment_key              text,
  current_version             int        not null default 1,

  -- Lifecycle
  auto_promoted_at            timestamptz,
  auto_rolled_back_at         timestamptz,
  rollback_reason             text,
  last_evaluated_at           timestamptz,

  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

-- ── 6. Strategy version registry ─────────────────────────────────────────────
-- Every deployed policy change is a new version — enables rollback.
create table if not exists cro_strategy_versions (
  id               uuid    primary key default gen_random_uuid(),
  strategy_key     text    not null,
  version          int     not null,
  config           jsonb   not null default '{}',
  -- SHADOW | EXPERIMENT | LIVE | ROLLED_BACK | RETIRED
  status           text    not null default 'SHADOW',
  evidence         jsonb,
  experiment_key   text,
  previous_version int,
  promoted_at      timestamptz,
  rolled_back_at   timestamptz,
  rollback_reason  text,
  created_at       timestamptz default now(),
  unique (strategy_key, version)
);

-- ── 7. Chat sessions ─────────────────────────────────────────────────────────
create table if not exists chat_sessions (
  id                       uuid    primary key default gen_random_uuid(),
  session_id               text,
  visitor_id               text,
  customer_id              uuid,

  opened_at                timestamptz default now(),
  closed_at                timestamptz,
  first_message_at         timestamptz,

  messages_sent            int     not null default 0,
  products_shown           int     not null default 0,
  recommendations_accepted int     not null default 0,
  recommendations_rejected int     not null default 0,
  support_handoff          boolean not null default false,
  buy_click                boolean not null default false,
  purchased                boolean not null default false,
  revenue_ngn              numeric,

  created_at               timestamptz default now()
);

create index if not exists idx_chat_sessions_session  on chat_sessions (session_id);
create index if not exists idx_chat_sessions_visitor  on chat_sessions (visitor_id);
create index if not exists idx_chat_sessions_customer on chat_sessions (customer_id);

-- ── 8. Chat interventions ─────────────────────────────────────────────────────
-- One row per chat message that made a product recommendation.
create table if not exists chat_interventions (
  id                  uuid    primary key default gen_random_uuid(),
  chat_session_id     uuid    references chat_sessions (id) on delete set null,
  intervention_id     uuid    references cro_interventions (id) on delete set null,
  session_id          text,
  visitor_id          text,
  customer_id         uuid,

  intent              text,   -- CHEAPER | COMPARE | PRODUCT_SEARCH | etc.
  action              text,   -- SHOW_PRODUCT | SHOW_COMPARISON | etc.
  strategy            text,   -- PRICE_SAVING | UPGRADE | etc.
  product_id          uuid,
  template_family     text,
  template_variant    text,
  tone                text,
  cta_variant         text,
  sales_stage         text,
  confidence          numeric,

  -- Outcome (set by loop or client)
  accepted            boolean,
  rejected            boolean,
  buy_clicked         boolean not null default false,
  purchased           boolean not null default false,
  revenue_ngn         numeric,
  attributed_order_id uuid,
  outcome_closed_at   timestamptz,

  created_at          timestamptz default now()
);

create index if not exists idx_chat_interventions_session  on chat_interventions (session_id);
create index if not exists idx_chat_interventions_intent   on chat_interventions (intent);
create index if not exists idx_chat_interventions_strategy on chat_interventions (strategy);
create index if not exists idx_chat_interventions_product  on chat_interventions (product_id) where product_id is not null;

-- ── 9. Product relationship stats ────────────────────────────────────────────
create table if not exists product_relationship_stats (
  id                      uuid    primary key default gen_random_uuid(),
  source_product_id       uuid    not null,
  target_product_id       uuid    not null,
  relationship_type       text    not null,   -- SUBSTITUTE | UPGRADE | COMPLEMENT | PURCHASED_NEXT | etc.
  surface                 text    not null default 'all',
  time_bucket             text    not null default 'all',  -- immediate | 24h | 7d | 30d | all
  context_key             text    not null default 'all',

  exposures               bigint  not null default 0,
  views                   bigint  not null default 0,
  clicks                  bigint  not null default 0,
  purchases               bigint  not null default 0,
  revenue_ngn             numeric not null default 0,

  control_exposures       bigint  not null default 0,
  control_purchases       bigint  not null default 0,

  conversion_rate         numeric,
  control_conversion_rate numeric,
  uplift_pp               numeric,
  confidence              numeric,

  strength                numeric not null default 0.5,
  -- HYPOTHESIS | EXPLORING | WEAK | MODERATE | STRONG | HARMFUL
  evidence_grade          text    not null default 'HYPOTHESIS',

  first_observed_at       timestamptz default now(),
  last_updated_at         timestamptz default now(),

  unique (source_product_id, target_product_id, relationship_type, surface, time_bucket, context_key)
);

create index if not exists idx_product_rel_source on product_relationship_stats (source_product_id);
create index if not exists idx_product_rel_target on product_relationship_stats (target_product_id);

-- ── 10. CRO Opportunities ─────────────────────────────────────────────────────
create table if not exists cro_opportunities (
  id                             uuid    primary key default gen_random_uuid(),
  opportunity_key                text    unique not null,
  -- UNDEREXPOSED_WINNER | PURCHASE_SEQUENCE | FUNNEL_DROP | COLD_START | etc.
  type                           text    not null,
  scope                          text    not null,
  description                    text,
  evidence                       jsonb,
  estimated_monthly_audience     int,
  estimated_revenue_opportunity  numeric,
  confidence                     numeric,
  risk                           numeric default 0.5,
  effort                         numeric default 0.5,
  priority                       numeric,
  -- open | watching | testing | resolved | dismissed
  status                         text    not null default 'open',
  experiment_key                 text,
  created_at                     timestamptz default now(),
  updated_at                     timestamptz default now()
);

-- ── 11. CRO Insights ─────────────────────────────────────────────────────────
create table if not exists cro_insights (
  id               uuid    primary key default gen_random_uuid(),
  insight_key      text    unique not null,
  type             text    not null,
  scope            text    not null,
  description      text    not null,
  evidence         jsonb,
  sample_size      int,
  effect_size      numeric,
  confidence       numeric,
  -- HYPOTHESIS | TESTING | VERIFIED | ACTIVE | RETIRED
  status           text    not null default 'HYPOTHESIS',
  -- DETECTOR | EXPERIMENT | MANUAL
  source           text,
  created_at       timestamptz default now(),
  last_verified_at timestamptz
);

-- ── 12. Attribution window closure log ───────────────────────────────────────
create table if not exists cro_attribution_closures (
  id                      uuid    primary key default gen_random_uuid(),
  run_at                  timestamptz default now(),
  window_h                int     not null,
  interventions_evaluated int     not null default 0,
  outcomes_written        int     not null default 0,
  errors                  int     not null default 0,
  details                 jsonb
);

-- ── RLS (service role only — all reads go through edge functions) ─────────────
alter table cro_interventions           enable row level security;
alter table cro_outcomes                enable row level security;
alter table cro_experiment_assignments  enable row level security;
alter table cro_strategy_stats          enable row level security;
alter table cro_strategy_versions       enable row level security;
alter table chat_sessions               enable row level security;
alter table chat_interventions          enable row level security;
alter table product_relationship_stats  enable row level security;
alter table cro_opportunities           enable row level security;
alter table cro_insights                enable row level security;
alter table cro_attribution_closures    enable row level security;
