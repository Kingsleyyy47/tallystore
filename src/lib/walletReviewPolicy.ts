export function isPurchasingPausedByProfile(
  accountSuspended: boolean,
  walletReviewRequired: boolean,
  walletReviewedBy: string | null,
): boolean {
  return accountSuspended || (walletReviewRequired && walletReviewedBy !== null)
}
