import {spawnSync} from 'node:child_process';
const checks=[
 ['Fixed SMS country markups','node',['scripts/customer-sms-markup-test.mjs']],
 ['Country/service SMS cards','node',['scripts/sms-country-cards-test.mjs']],
 ['International SMS admin selection','node',['scripts/sms-international-selection-pglite-test.mjs']],
 ['Storefront navigation authorization','node',['scripts/storefront-route-access-test.mjs']],
 ['Expanded SMS catalogue settings RPC','node',['scripts/sms-catalog-settings-pglite-test.mjs']],
 ['Provider balances, delivery ranking and switches','npx',['-y','deno','test','--allow-env','--node-modules-dir=none','scripts/provider-operations-policy-test.ts']],
 ['Provider operations SQL and scheduled sync','node',['scripts/provider-operations-pglite-test.mjs']],
 ['Provider operations role boundaries','node',['scripts/provider-operations-auth-test.mjs']],
 ['Provider matching, fallback, caching and adapters','npx',['-y','deno','test','--allow-env','--node-modules-dir=none','scripts/provider-integrations-test.ts']],
 ['Live SMM catalogues and fresh purchase quotes','npx',['-y','deno','test','--allow-env','--node-modules-dir=none','scripts/smm-live-catalog-test.ts']],
 ['Live SMM allowlist SQL','node',['scripts/smm-live-catalog-pglite-test.mjs']],
 ['Kora verified wallet SQL','node',['scripts/catalog/korapay-wallet-pglite-test.mjs']],
 ['Rental dispatch and refunds SQL','node',['scripts/sms-rental-routing-pglite-test.mjs']],
 ['SMM dispatch concurrency','node',['scripts/smm-create-order-race-test.mjs']],
 ['SMS purchase authorization','node',['scripts/customer-sms-purchase-boundary-test.mjs']],
 ['SMS allocation evidence','node',['scripts/sms-allocation-evidence-handler-test.mjs']],
 ['SMS status throttle and budget','node',['scripts/sms-status-refresh-throttle-test.mjs']],
 ['SMS exact-once refund and saved rejection recovery','node',['scripts/sms-atomic-refund-pglite-test.mjs']],
 ['SMS atomic cancellation','node',['scripts/sms-atomic-cancellation-handler-test.mjs']],
 ['SMS sweeper','node',['scripts/sms-sweeper-handler-test.mjs']],
 ['Partner SMS/SMM adapters','node',['--experimental-transform-types','scripts/partner-sms-social-adapter-test.mjs']],
 ['Fragment current API transport','node',['scripts/istar-provider-runtime-test.mjs']],
];
let failed=false;
for(const [name,command,args]of checks){const win=process.platform==='win32'&&command==='npx';const r=spawnSync(win?'cmd.exe':command,win?['/d','/c','npx',...args]:args,{encoding:'utf8',timeout:120000});console.log(`${r.status===0?'PASS':'FAIL'} ${name}`);if(r.status!==0){failed=true;console.error((r.stdout+r.stderr).slice(-3500))}}
if(failed)process.exitCode=1;
