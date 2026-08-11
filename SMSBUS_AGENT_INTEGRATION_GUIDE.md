# SMSBus Agent Integration Guide

This guide is for an agent implementing SMSBus in another project. The project may already contain the provider docs, so use those docs as the source of truth for exact endpoints and response shapes. This file captures the practical flow, architecture decisions, and mistakes to avoid from the Active Store implementation.

## Goal

Build SMSBus as a reliable SMS provider without exposing provider details to users, without trusting frontend prices, and without creating wallet/refund bugs.

SMSBus has two separate products:

- OTP activations: short-lived numbers for one verification code.
- Rental numbers: long-term numbers rented for one or more months with reusable SMS inboxes.

Treat these as separate flows even if they share one API token.

## Non-Negotiable Rules

- Never expose the SMSBus API token in frontend code.
- Store the API token only in backend/serverless secrets, for example `SMSBUS_API_KEY`.
- Do not trust price, country, service, or stock values sent by the frontend during purchase.
- Always re-fetch live provider price and availability on the backend immediately before wallet debit.
- Debit wallet only after the provider successfully returns a number.
- If wallet debit fails after provider allocation, cancel/release the provider number immediately.
- If DB order creation fails after wallet debit, refund the wallet and cancel/release the provider number.
- Use atomic wallet RPCs or database transactions where available.
- Make cancel/refund idempotent with a status guard such as `where status = 'active'`.
- Store provider identifiers on every order so polling and cancellation route to the correct provider.
- Mask provider/internal errors before showing them to users.
- Log enough context for admins, but never log tokens or full secrets.

## Recommended Backend Shape

Use a shared provider wrapper plus thin endpoint handlers.

Suggested files:

- `server/_shared/smsbus-api.ts`: SMSBus API wrapper.
- `server/functions/smsbus/index.ts`: OTP activations.
- `server/functions/smsbus-rental/index.ts`: rental numbers.
- Existing primary-provider function, if any: add fallback routing here only when SMSBus is used as backup.

Keep the wrapper responsible for:

- Adding the token server-side.
- Calling provider endpoints.
- Normalizing provider responses into consistent app-level objects.
- Mapping provider errors into typed statuses like `waiting`, `received`, `expired`, `no_stock`, `bad_token`, `insufficient_provider_balance`.
- Retrying once on transient network errors only, not on business errors.

Keep endpoint handlers responsible for:

- Auth.
- Wallet lookup.
- Price calculation.
- Wallet debit/credit.
- Order insert/update.
- User-facing response shape.

## OTP Flow

Use this flow for international OTP or any direct SMSBus one-time number product.

1. Frontend loads countries.
2. Backend calls SMSBus countries endpoint and returns normalized `{ id, name, code }`.
3. User selects a country.
4. Frontend loads services for that country.
5. Backend calls prices endpoint and projects/services endpoint.
6. Backend joins price rows to project rows because SMSBus price rows may not contain the service name.
7. Frontend displays service name, price, and stock.
8. User clicks buy.
9. Backend re-fetches live prices for the selected country.
10. Backend finds the selected `project_id`.
11. Backend calculates final user price from live provider cost plus configured margin.
12. Backend checks wallet balance.
13. Backend requests number from SMSBus.
14. If number is returned, backend debits wallet.
15. Backend creates order with `type = 'smsbus'`, provider request ID, phone number, price, expiry, and empty messages array.
16. Frontend polls check-SMS endpoint every few seconds.
17. Backend calls SMSBus SMS endpoint with the stored provider request ID.
18. If waiting, return current order status without changing wallet.
19. If SMS received, store message/code, mark order completed, and return the code.
20. If provider says expired/released, mark order expired and refund once.

Important SMSBus OTP notes:

- There is no `setReady` step.
- There is no `finishActivation` step in the working flow.
- After `get number`, immediately start polling for SMS.
- Store SMSBus `request_id` as the provider verification ID.
- Generate your own public order ID for the app; do not expose provider IDs as primary UI identifiers.
- Polling should be safe to repeat.

## Rental Flow

Use this flow for long-term numbers.

1. Frontend loads rental areas.
2. Backend calls rental areas endpoint.
3. Backend enriches areas with local currency price per month using current exchange rate and rental margin.
4. User selects area and duration.
5. Backend clamps duration to allowed bounds, for example 1 to 12 months.
6. Backend re-fetches area pricing before purchase.
7. Backend calculates final total from provider monthly cost, margin, exchange rate, and months.
8. Backend checks wallet.
9. Backend rents number from SMSBus.
10. Backend debits wallet.
11. Backend creates order with `type = 'smsbus-rental'`.
12. Store provider order ID, mobile number, dialing code, area code, expiration time, keep/reservation deadline, unit provider price, and rent months in `api_response`.
13. Frontend lists user's rental numbers from local orders, optionally merged with live provider status.
14. Latest SMS and SMS history call rental SMS endpoints using stored area code and mobile number.
15. Renew flow re-fetches area pricing, debits wallet, calls provider renew endpoint, then updates expiry.
16. Cancel flow must respect provider cancel rules, usually no SMS received and inside the provider cancel window.

Rental gotchas:

- Provider rental prices may be in cents. Convert once and name variables clearly.
- Store both the local app order ID and provider rental order ID.
- Store both formatted phone number and raw mobile number.
- `expire_at` means service expiry. `keep_at` may be the last reservation/renewal deadline.
- If live provider status shows expired, sync the local order status.

## Fallback Provider Flow

If SMSBus is used as a fallback behind another provider, do not make the fallback visible as a provider brand.

Recommended flow:

1. User sees the primary provider's service list or the app's unified service list.
2. User clicks buy.
3. Backend tries the primary provider first.
4. If primary succeeds, create normal primary-provider order.
5. If primary returns no stock/no number/provider unavailable, try SMSBus for the equivalent country/service.
6. If SMSBus succeeds, create order with a distinct internal type such as `smsbus-us`.
7. Poll and cancel routes must inspect order type and call SMSBus for fallback orders.
8. UI should say neutral copy like "Second option" or simply proceed with the number. Do not show provider names unless the business explicitly wants that.

Fallback pricing rule:

- The displayed price and debited price must come from the same calculation source.
- For fallback orders, use the SMSBus live provider cost plus the configured fallback margin.
- Return that final backend-calculated price to the frontend and store the exact same value in the order.
- Never debit using one formula and display using another formula.

## Pricing Rules

Use one backend utility per product:

OTP:

```text
userPrice = ceil((providerCostUSD + otpMarginUSD) * exchangeRate)
```

Rental:

```text
userPrice = ceil((providerMonthlyCostUSD + rentalMarginUSD) * exchangeRate * months)
```

Recommended margin mapping:

- International OTP: `international` margin.
- US fallback OTP: same margin used by the other US providers, if the business wants comparable prices.
- Rental: `rental` margin.

Implementation details:

- Store `price_usd`, `admin_profit`, `total_price_usd`, `exchange_rate`, and `price_ngn`.
- Wallet balances are often stored in minor units, for example kobo/cents. Convert consistently.
- Use `Math.round(price_ngn * 100)` for kobo debit/credit after final NGN amount is calculated.
- Prefer `ceil` for user-facing prices to avoid undercharging from decimals.

## Order Storage Pattern

Use one phone/SMS orders table if possible.

Recommended columns:

- `order_id`: local public order ID.
- `user_id`: authenticated user.
- `type`: `smsbus`, `smsbus-us`, or `smsbus-rental`.
- `service_id`: SMSBus project ID or rental area code.
- `service_name`: display label.
- `phone_number`: formatted number.
- `verification_id`: SMSBus request ID or provider rental order ID.
- `country`: country code or rental area code.
- `price_usd`: provider base cost.
- `admin_profit`: app margin.
- `total_price_usd`: provider cost plus margin.
- `exchange_rate`: rate used at purchase time.
- `price_ngn`: exact amount charged.
- `status`: `active`, `completed`, `cancelled`, `expired`, or `processing`.
- `messages`: array of received SMS records.
- `expires_at`: provider/app expiry time.
- `can_cancel_at`: app/provider cancel time rule.
- `api_response`: raw normalized provider metadata needed later.
- `refund_amount`, `refunded_at`: for auditability.
- `store`: if the app has multi-store routing.

## Error Handling Map

Handle at least these categories:

- Bad token: internal error, alert admin, never expose token issue to user.
- No service or no number: show sold out/unavailable, or trigger fallback if eligible.
- SMS not received yet: return waiting status; do not mark failed.
- Number expired/released: mark expired and refund once.
- Too many pending provider requests: ask user to try later; alert admin if persistent.
- Provider balance not enough: internal/admin issue; do not charge user.
- Rental minimum duration: show the provider minimum duration.
- Rental cannot cancel because SMS received: show clear no-refund reason.
- Rental cannot renew because number expired: mark expired and show renewal unavailable.

## Frontend UX Guidelines

- Avoid exposing provider names to customers if the business wants a unified product.
- Show "Unavailable" only when all eligible providers are unavailable.
- If fallback exists, the button must remain actionable when the fallback has stock.
- Show exact backend-confirmed price after selection and before final buy.
- If price can change between listing and purchase, backend response must be treated as final.
- Poll active OTP orders every 3-5 seconds.
- Stop polling after completed, cancelled, or expired.
- For rentals, show expiry and renew warnings before `keep_at` or expiry.
- Keep user-facing errors simple. Put provider diagnostics in logs/admin tools.

## Admin Guidelines

- Add provider toggles if multiple providers can serve the same feature.
- Add internal order type filters: `smsbus`, `smsbus-us`, `smsbus-rental`.
- Add provider health visibility: balance, recent order errors, no-stock frequency, cancellation failures.
- Keep fallback provider labels internal unless support staff need them.
- Add logs for `order_created`, `get_number_failed`, `sms_received`, `cancelled`, `expired`, `refund_failed`, and `wallet_debit_failed`.

## Verification Checklist

Before deployment:

- Confirm `SMSBUS_API_KEY` is set only in backend secrets.
- Confirm CORS preflight works.
- Confirm countries endpoint returns normalized country list.
- Confirm services endpoint returns real service names by joining projects with prices.
- Confirm order endpoint re-fetches live price before debit.
- Confirm insufficient wallet does not call provider.
- Confirm provider no-stock does not debit wallet.
- Confirm provider success plus wallet debit creates an order.
- Confirm wallet debit failure cancels provider number.
- Confirm DB insert failure refunds wallet and cancels provider number.
- Confirm SMS polling stores code and marks completed.
- Confirm waiting status does not create duplicate messages.
- Confirm expired status refunds exactly once.
- Confirm user cancel calls provider cancel and refunds exactly once.
- Confirm repeated cancel calls do not double-refund.
- Confirm order history can poll/cancel the correct provider based on order type.
- Confirm frontend displayed price equals backend charged `price_ngn`.
- Confirm logs do not contain API token.

End-to-end tests to run:

- Buy one OTP number, receive/poll SMS, complete order.
- Buy one OTP number and cancel after allowed delay, verify wallet refund.
- Force provider no-stock and verify fallback or clean user error.
- Force wallet insufficient balance and verify no provider order is created.
- Rent one number, view latest SMS/history, renew if possible, cancel only inside allowed rules.
- Run admin order list and filters after creating each SMSBus order type.

## Common Implementation Mistakes

- Using `list/prices` title as service name. In SMSBus OTP, price rows can describe country, not project/service. Join with projects.
- Trusting frontend price during order. Always re-fetch live provider price on backend.
- Debiting wallet before provider returns a number.
- Not cancelling provider allocation when wallet debit or DB insert fails.
- Treating "SMS not received yet" as an error.
- Using same visible price for primary and fallback providers while debiting fallback's different live price.
- Forgetting to route `check-sms` and `cancel` by stored order type.
- Storing only phone number and not provider request/order ID.
- Logging tokenized URLs without masking token.
- Not handling provider balance errors distinctly from user errors.
- Creating a new table when the existing order table can support SMSBus with a `type` value and `api_response`.

## Agent Implementation Prompt

Use this prompt for the implementing agent:

```text
You are integrating SMSBus into this project. First read the local SMSBus provider docs and the existing SMS/order/wallet architecture. Do not write code until you understand the current order table, wallet debit/refund mechanism, auth middleware, provider toggles, and existing SMS provider flows.

Implement SMSBus with a backend-only token. Create a shared provider wrapper, then implement OTP and rental flows incrementally. Never trust frontend price or stock during purchase; re-fetch live provider data on the backend immediately before debit. Debit only after provider allocation succeeds. If wallet debit or DB insert fails, cancel the provider allocation and refund where needed. Store provider request IDs and order metadata so polling, cancellation, refunds, and admin history route correctly.

For OTP, remember SMSBus does not need setReady or finishActivation. After get number, poll get SMS. Treat waiting as a normal status. Treat provider expired/released as expired with one-time refund. For services, join prices with projects because price rows may not include service names.

For fallback, do not expose provider names to customers. The UI should stay unified. The displayed price and debited price must come from the same backend calculation. When fallback fills an order, store a distinct internal type and route check/cancel to SMSBus.

After implementation, run API-level tests, browser smoke tests, wallet debit/refund tests, provider no-stock tests, duplicate-cancel tests, and admin history tests. Do not deploy until displayed price, stored price, debited amount, refund amount, and provider route all match.
```
