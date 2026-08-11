# TallyStore - LLM Context

## Overview
TallyStore is a Nigerian e-commerce platform selling premium social media accounts, with fintech features (crypto exchange, bills payment, SMM services).

## Tech Stack
- **Frontend**: React + TypeScript + Vite + TailwindCSS + shadcn/ui
- **Backend**: Supabase (PostgreSQL + Edge Functions + Auth)
- **Payments**: Ercas Pay (wallet top-up), NowPayments (crypto), SageCloud (bills, withdrawals)
- **Hosting**: Vercel (frontend), Supabase (backend)

## Supabase Project
- **Ref**: `dssvvswvqnxanyzfhixf`
- **URL**: `https://dssvvswvqnxanyzfhixf.supabase.co`
- **CLI**: `C:\Users\Wisdom\Downloads\supabase_windows_amd64\supabase.exe`

## Database Tables

### Core
| Table | Purpose |
|-------|---------|
| `profiles` | User data: `id`, `email`, `wallet_balance`, `crypto_balance`, `is_admin` |
| `transactions` | Wallet transactions: `type` (topup/purchase/refund), `amount`, `balance_after` |
| `orders` | Product purchases |
| `categories` | Product categories |
| `product_groups` | Product templates with pricing |
| `individual_accounts` | Actual account credentials (inventory) |

### Fintech
| Table | Purpose |
|-------|---------|
| `crypto_transactions` | Crypto sell orders (NowPayments) |
| `crypto_withdrawals` | Bank withdrawal requests (SageCloud) |
| `crypto_exchange_rates` | BTC/USDT/USDC rates |
| `bills_transactions` | Airtime/data purchases |

### SMM (New)
| Table | Purpose |
|-------|---------|
| `smm_services` | Cached services from panel (9449 services) |
| `smm_orders` | User SMM orders |
| `smm_settings` | Config like `usd_ngn_rate` (currently 1600) |

## Dual Balance System
Users have TWO balances in `profiles`:
1. **`wallet_balance`** - Main wallet (top-up via Ercas, used for purchases)
2. **`crypto_balance`** - Earned from selling crypto (can transfer to wallet or withdraw to bank)

## Edge Functions

### Existing
| Function | Purpose |
|----------|---------|
| `purchase-bills` | Buy airtime/data via SageCloud |
| `get-data-plans` | Fetch data plans from SageCloud |
| `create-crypto-sell-order` | Create NowPayments crypto sell order |
| `nowpayments-webhook` | Handle NowPayments callbacks |
| `create-withdrawal-request` | Bank withdrawal via SageCloud |
| `validate-bank-account` | Verify bank account name |
| `update-crypto-rates` | Fetch live crypto rates |
| `get-available-cryptos` | List supported cryptos |

### SMM (New)
| Function | Purpose |
|----------|---------|
| `smm-sync-services` | Admin: Fetch & cache all panel services |
| `smm-get-services` | Get cached services for users |
| `smm-create-order` | Place SMM order (deduct wallet, call panel) |
| `smm-check-status` | Check order status from panel |

## Shared Utilities (`_shared/`)
- `sagecloud-client.ts` - SageCloud API wrapper
- `nowpayments-client.ts` - NowPayments API wrapper
- `smm-panel-client.ts` - SMM Panel API wrapper
- `forex-rates.ts` - Currency conversion

## Key Secrets (Supabase Edge Functions)
- `SAGECLOUD_PUBLIC_KEY`, `SAGECLOUD_SECRET_KEY`
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`
- `SMM_PANEL_API_KEY` (940e5626409a55af066916ebdd7f3561)

## Frontend Routes
| Route | Page | Access |
|-------|------|--------|
| `/` | Landing page | Public |
| `/products` | Product catalog | Public |
| `/dashboard` | User dashboard | User |
| `/wallet` | Wallet top-up | User |
| `/crypto-exchange` | Sell crypto | User |
| `/bills` | Airtime/data | User |
| `/social-boost` | SMM services | Admin (testing) → User |
| `/admin` | Admin panel | Admin only |

## Frontend Pages

### SocialBoostPage.tsx (`/social-boost`)
- **Status**: ✅ Phase 3 Complete - Admin testing
- **Features**:
  - Platform filter tabs (Instagram, TikTok, YouTube, etc.)
  - Search-based service discovery (doesn't dump all 9449 services)
  - Service cards with pricing (₦/1000)
  - Order form with URL validation per platform
  - Quick quantity presets
  - Order history tab with status badges
  - Admin sync button to refresh services from panel
- **Styling**: Matches Bills page (pink/purple gradient header)
- **Payment**: Wallet only
- **Pricing**: Panel rate × 2 × 1600 = NGN price

## UI Patterns
- **NavbarAuth**: Main nav with user dropdown, wallet balance display
- **Cards**: shadcn Card components with gradient backgrounds
- **Balance cards**: Green for wallet, Orange for crypto
- **Page headers**: Purple gradient nav (like Bills page) or standard NavbarAuth
- **Forms**: shadcn Input, Select, Button with loading states

## Admin Account
- Email: `wisdomthedev@gmail.com` (hardcoded admin check)

## Conventions
- Edge Functions use `corsHeaders` pattern
- Auth via `Authorization: Bearer <token>` header
- Idempotency keys prevent duplicate transactions
- All amounts in NGN (₦) internally
- Prices display with `toLocaleString()` formatting

## SMM Panel API
- **URL**: `https://thelordofthepanels.com/api/v2`
- **Method**: POST with `key` + `action` parameters
- **Actions**: `services`, `add`, `status`, `balance`, `refill`, `cancel`
- **Pricing**: Panel rate (USD per 1000) × 2 × NGN rate = selling price
