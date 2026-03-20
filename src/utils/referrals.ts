/**
 * Default referral percentage for legacy-safe fallback behavior.
 */
export const DEFAULT_REFERRAL_RATE = 0.05;

/**
 * Returns a valid referral rate with fallback to the default 5%.
 *
 * @param referralRate Raw stored rate.
 * @returns Normalized rate in decimal form.
 */
export function getEffectiveReferralRate(
  referralRate: number | null | undefined,
): number {
  if (
    typeof referralRate !== "number" ||
    Number.isNaN(referralRate) ||
    referralRate <= 0
  ) {
    return DEFAULT_REFERRAL_RATE;
  }

  return referralRate;
}
