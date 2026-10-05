-- One-time correction of the audited TallyStore catalogue (143 product groups).
-- Run only against the live project after confirming the counts below.
-- Product IDs, prices, stock, order history and active flags are unchanged.
BEGIN;

DO $$
DECLARE
  v_email_id uuid;
  v_vpn_id uuid;
  v_proxy_id uuid;
  v_formats_id uuid;
  v_verification_id uuid;
  v_count integer;
BEGIN
  IF (SELECT count(*) FROM public.product_groups) <> 143 THEN
    RAISE EXCEPTION 'Catalogue changed since audit; review every product group again';
  END IF;

  SELECT id INTO v_email_id FROM public.categories WHERE lower(btrim(name)) IN ('gmail', 'email');
  IF v_email_id IS NULL OR (SELECT count(*) FROM public.categories WHERE lower(btrim(name)) IN ('gmail', 'email')) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Gmail/Email category';
  END IF;
  UPDATE public.categories SET name = 'Email', description = 'Gmail, Hotmail, Outlook and other email accounts' WHERE id = v_email_id;

  SELECT id INTO v_vpn_id FROM public.categories WHERE lower(btrim(name)) = 'vpn';
  IF v_vpn_id IS NULL THEN RAISE EXCEPTION 'VPN category missing'; END IF;
  INSERT INTO public.categories (name, description, is_active)
  SELECT 'Proxy', 'PC and phone proxy plans', true
  WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE lower(btrim(name)) = 'proxy');
  SELECT id INTO v_proxy_id FROM public.categories WHERE lower(btrim(name)) = 'proxy';
  IF (SELECT count(*) FROM public.categories WHERE lower(btrim(name)) = 'proxy') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Proxy category';
  END IF;
  SELECT count(*) INTO v_count FROM public.product_groups WHERE category_id = v_vpn_id AND name ~* '\mproxy\M';
  IF v_count NOT IN (0, 18) THEN RAISE EXCEPTION 'Expected 18 proxy products in VPN, found %', v_count; END IF;
  UPDATE public.product_groups SET category_id = v_proxy_id WHERE category_id = v_vpn_id AND name ~* '\mproxy\M';
  IF (SELECT count(*) FROM public.product_groups WHERE category_id = v_proxy_id AND name ~* '\mproxy\M') <> 18 THEN
    RAISE EXCEPTION 'Proxy reassignment did not produce 18 products';
  END IF;

  SELECT id INTO v_formats_id FROM public.categories WHERE lower(btrim(name)) = 'formats';
  IF v_formats_id IS NULL THEN RAISE EXCEPTION 'Formats category missing'; END IF;
  INSERT INTO public.categories (name, description, is_active)
  SELECT 'Phone Verification', 'Phone number verification products', true
  WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE lower(btrim(name)) = 'phone verification');
  SELECT id INTO v_verification_id FROM public.categories WHERE lower(btrim(name)) = 'phone verification';
  IF (SELECT count(*) FROM public.categories WHERE lower(btrim(name)) = 'phone verification') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Phone Verification category';
  END IF;
  SELECT count(*) INTO v_count FROM public.product_groups
  WHERE category_id = v_formats_id AND btrim(name) ILIKE 'American phone number verification';
  IF v_count NOT IN (0, 1) THEN RAISE EXCEPTION 'Expected one phone verification product in Formats'; END IF;
  UPDATE public.product_groups SET category_id = v_verification_id
  WHERE category_id = v_formats_id AND btrim(name) ILIKE 'American phone number verification';
  IF (SELECT count(*) FROM public.product_groups WHERE category_id = v_verification_id AND btrim(name) ILIKE 'American phone number verification') <> 1 THEN
    RAISE EXCEPTION 'Phone verification reassignment failed';
  END IF;
END $$;

COMMIT;
