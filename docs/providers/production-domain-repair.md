# Production domain and SMS repair — 23 November 2026

The customer-facing site is `https://www.tallystore.org` (the apex redirects
there). Its build identified commit `4b85c0640bb271282863a8f4d42f9cf83aba6e59`
from `Kingsleyyy47/tallystore` main. The separately deployed
`tally-store-steel.vercel.app` address used `Kingsleyyy47/TALLY-STORE`; checking
that address did not verify the customer domain.

This release starts from the actual production commit and brings in the provider
integrations, dashboard controls, current SMM catalogue and SMS catalogue surface.
The original working directory's unrelated changes are preserved separately.

Admins can now browse customer routes instead of being redirected from every
`requireRole="user"` route to `/admin`. Login and current-role checks remain in
place. Admin/staff management routes retain their permissions, staff-only account
restrictions are unchanged, and server purchase authorization is unchanged.

TextVerify has no fixed place in the fallback order. Its current availability,
delivery history and speed determine its position. Supplier catalogue failures
remove its offers until a later refresh succeeds. Confirmed/no-charge failures
can try another exact product match; accepted or uncertain paid outcomes remain
pinned to prevent duplicate purchases.

SMS owner settings now use one service-only POST RPC with a JSON result. This
avoids catalogue-sized query URLs and PostgREST's row cap. The SQL fixture checks
1,500 long service codes, existing visibility/price choices and browser denial.
The internal `smsbus` `catalog_smoke` action verifies the actual full pricing and
catalogue builder without supplier purchases, settings sync or customer data.
Its live check returned 931 products and 931 visible products. Anonymous requests
to both that action and purchase actions returned 401.

Validation includes the real route component, TextVerify's automatic ranking
recovery, the existing provider suite, SQL ownership controls, frontend types,
production build and credential scan. Live paid fulfilment was not tested.
