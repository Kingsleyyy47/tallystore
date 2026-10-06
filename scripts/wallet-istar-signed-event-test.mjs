// Preserve the suite entrypoint and run each global-transport fixture in sequence.
await import('./istar-webhook-edge-test.mjs')
await import('./istar-webhook-proxy-test.mjs')
await import('./istar-webhook-wallet-pglite-test.mjs')
