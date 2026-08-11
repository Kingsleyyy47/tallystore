# TallyStore Maintenance Mode

## Overview
Maintenance mode was enabled on **January 31, 2026** to allow for site fixes and improvements.

---

## What Was Implemented

### 1. Maintenance Page (`src/components/MaintenancePage.tsx`)
- Purple gradient background matching site branding
- TallyStore logo display
- "Under Maintenance" message with animated indicator
- **36-hour countdown timer** (ends Feb 1, 2026 at ~10:27 PM WAT)
- Yellow notice box for top-up issues with Telegram link
- Direct link to Telegram support channel

### 2. Maintenance Toggle (`src/App.tsx`)
```typescript
// ⚠️ MAINTENANCE MODE - Set to false to restore normal site
const MAINTENANCE_MODE = true;
```
When `true`, shows only the maintenance page. Set to `false` to restore full site access.

### 3. Cache Busting (`vercel.json`)
Added aggressive no-cache headers to force all users to see the maintenance page:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Pragma", "value": "no-cache" },
        { "key": "Expires", "value": "0" }
      ]
    }
  ]
}
```

---

## How to Restore the Site

1. **Edit `src/App.tsx`** line ~14:
   ```typescript
   const MAINTENANCE_MODE = false;
   ```

2. **(Optional)** Remove cache-busting headers from `vercel.json` to restore normal caching

3. **Commit and push**:
   ```bash
   git add -A
   git commit -m "Disable maintenance mode"
   git push
   ```

---

## Files Modified
| File | Change |
|------|--------|
| `src/components/MaintenancePage.tsx` | **NEW** - Maintenance page component |
| `src/App.tsx` | Added `MAINTENANCE_MODE` flag and import |
| `vercel.json` | Added no-cache headers |

---

## Support During Maintenance
Users directed to: https://t.me/+2347072517332
