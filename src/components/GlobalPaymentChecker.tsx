/**
 * GlobalPaymentChecker
 * 
 * Renders nothing visible — just runs the usePaymentStatusChecker hook
 * at the app level (inside AuthProvider) so payment polling works
 * regardless of which page the user is on.
 * 
 * Previously, payment polling only ran on WalletPage, meaning if a user
 * navigated away after paying, their wallet would never get credited
 * until they returned to the wallet page (or the webhook/cron kicked in).
 */

import { usePaymentStatusChecker } from '@/hooks/usePaymentStatusChecker';

export default function GlobalPaymentChecker() {
  // Hook internally checks for user and pending_topup before doing anything
  usePaymentStatusChecker();
  return null;
}
