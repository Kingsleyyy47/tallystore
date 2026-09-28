-- Provider evidence must match the ledger amount exactly. Rounding both sides
-- could turn an over-precise historical mismatch into trusted principal.
DO $patch$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_pairs text[][];
  v_index integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;

  v_pairs := ARRAY[
    ARRAY[
      'round((t.metadata->>''verified_amount_ngn'')::numeric, 2) = round(t.amount, 2)',
      '(t.metadata->>''verified_amount_ngn'')::numeric = t.amount'
    ],
    ARRAY[
      'round(pp.amount, 2) = round(t.amount, 2)',
      'pp.amount = t.amount'
    ],
    ARRAY[
      'round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)',
      'pwl.verified_amount_ngn = t.amount'
    ]
  ];
  FOR v_index IN 1..array_length(v_pairs, 1) LOOP
    v_old := v_pairs[v_index][1];
    v_new := v_pairs[v_index][2];
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'Unexpected canonical gateway evidence amount check: %', v_old;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END LOOP;
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition,
    'v_financial_truth := public.wallet_financial_truth_internal(p_user_id);') = 0
  THEN
    RAISE EXCEPTION 'Canonical wallet purchase gate must exist before exact amount patch';
  END IF;
  v_pairs := ARRAY[
    ARRAY[
      'round((COALESCE(p_metadata, ''{}''::jsonb)->>''verified_amount_ngn'')::numeric, 2) <> round(v_amount, 2)',
      '(COALESCE(p_metadata, ''{}''::jsonb)->>''verified_amount_ngn'')::numeric <> v_amount'
    ],
    ARRAY[
      'round(pp.amount, 2) = round(v_amount, 2)',
      'pp.amount = v_amount'
    ],
    ARRAY[
      'round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(v_amount, 2)',
      'pwl.verified_amount_ngn = v_amount'
    ],
    ARRAY[
      'round((t.metadata->>''verified_amount_ngn'')::numeric, 2) = round(t.amount, 2)',
      '(t.metadata->>''verified_amount_ngn'')::numeric = t.amount'
    ],
    ARRAY[
      'round(pp.amount, 2) = round(t.amount, 2)',
      'pp.amount = t.amount'
    ],
    ARRAY[
      'round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)',
      'pwl.verified_amount_ngn = t.amount'
    ]
  ];
  FOR v_index IN 1..array_length(v_pairs, 1) LOOP
    v_old := v_pairs[v_index][1];
    v_new := v_pairs[v_index][2];
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      IF v_index > 3
        AND pg_catalog.strpos(v_definition, v_new) = 0
        AND pg_catalog.strpos(v_definition, 'round(t.amount, 2)') = 0
      THEN
        -- The old history scan was removed by the canonical purchase gate.
        CONTINUE;
      END IF;
      IF pg_catalog.strpos(v_definition, v_new) > 0 THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Unexpected wallet engine gateway evidence amount check: %', v_old;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END LOOP;
  EXECUTE v_definition;
END;
$patch$;
