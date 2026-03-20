import { prisma } from "./prisma";
import { PERIOD_DAYS, PERIOD_LABELS, getPlanById, type PlanView } from "./plans";
import { decodeBotState, encodeBotState } from "./state";
import { getEffectiveReferralRate } from "./referrals";

type PurchaseSuccess = {
  ok: true;
  plan: PlanView;
  finalPrice: number;
  newActiveUntil: Date;
  period: string;
};

type PurchaseFailure = {
  ok: false;
  reason: "plan_not_found" | "invalid_period" | "user_not_found" | "insufficient_balance";
  plan?: PlanView;
  finalPrice?: number;
  shortfall?: number;
};

export function calculateDiscountedPrice(
  basePrice: number,
  fixedDiscount = 0,
  pctDiscount = 0,
): number {
  let discountedPrice = basePrice;

  if (fixedDiscount > 0) {
    discountedPrice = Math.max(0, discountedPrice - fixedDiscount);
  }

  if (pctDiscount > 0) {
    discountedPrice = discountedPrice * (1 - pctDiscount / 100);
  }

  return Math.max(1, Math.round(discountedPrice * 100) / 100);
}

export async function purchaseSubscriptionForUser(
  userId: string,
  planId: string,
  period: string,
): Promise<PurchaseSuccess | PurchaseFailure> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) {
    return { ok: false, reason: "user_not_found" };
  }

  const plan = await getPlanById(planId);
  if (!plan) {
    return { ok: false, reason: "plan_not_found" };
  }

  const monthlyPrice = plan.prices[period];
  const days = PERIOD_DAYS[period];
  if (typeof monthlyPrice !== "number" || !days) {
    return { ok: false, reason: "invalid_period", plan };
  }

  const basePrice = monthlyPrice * (days / 30);

  const finalPrice = calculateDiscountedPrice(
    basePrice,
    user.pendingDiscountFixed ?? 0,
    user.pendingDiscountPct ?? 0,
  );

  if (user.balance < finalPrice) {
    return {
      ok: false,
      reason: "insufficient_balance",
      plan,
      finalPrice,
      shortfall: Math.max(1, Math.round((finalPrice - user.balance) * 100) / 100),
    };
  }

  const durationMs = days * 24 * 60 * 60 * 1000;
  let newActiveUntil = new Date(Date.now() + durationMs);

  if (user.subscription && user.subscription.activeUntil > new Date()) {
    newActiveUntil = new Date(user.subscription.activeUntil.getTime() + durationMs);
  }

  const fixedDiscount = user.pendingDiscountFixed ?? 0;
  const pctDiscount = user.pendingDiscountPct ?? 0;
  const discountNote =
    fixedDiscount > 0 || pctDiscount > 0 ? " (скидка)" : "";

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        balance: { decrement: finalPrice },
        pendingDiscountPct: 0,
        pendingDiscountFixed: 0,
        botState:
          user.botState && decodeBotState(user.botState)?.key === "pending_subscription_purchase"
            ? null
            : user.botState,
      },
    });

    if (user.subscription) {
      await tx.subscription.update({
        where: { userId: user.id },
        data: {
          activeUntil: newActiveUntil,
          planId: plan.id,
          planName: plan.name,
          isLifetime: false,
        },
      });
    } else {
      await tx.subscription.create({
        data: {
          userId: user.id,
          activeUntil: newActiveUntil,
          planId: plan.id,
          planName: plan.name,
          isLifetime: false,
        },
      });
    }

    await tx.transaction.create({
      data: {
        userId: user.id,
        type: "subscription",
        amount: -finalPrice,
        title: `Подписка "${plan.name}" на ${PERIOD_LABELS[period]}${discountNote}`,
      },
    });

    if (user.referredById) {
      const referrer = await tx.user.findUnique({
        where: { id: user.referredById },
        select: { referralRate: true },
      });
      const rate = getEffectiveReferralRate(referrer?.referralRate);
      const commission = finalPrice * rate;

      await tx.user.update({
        where: { id: user.referredById },
        data: { referralBalance: { increment: commission } },
      });
      await tx.transaction.create({
        data: {
          userId: user.referredById,
          type: "referral_earning",
          amount: commission,
          title: "Реферальное начисление",
        },
      });
    }
  });

  return {
    ok: true,
    plan,
    finalPrice,
    newActiveUntil,
    period,
  };
}

export async function storePendingSubscriptionPurchase(
  userId: string,
  payload: { planId: string; period: string; expectedAmount: number },
) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      botState: encodeBotState("pending_subscription_purchase", payload),
    },
  });
}

export async function clearPendingSubscriptionPurchase(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { botState: true },
  });

  if (decodeBotState(user?.botState)?.key !== "pending_subscription_purchase") {
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { botState: null },
  });
}

export async function tryCompletePendingSubscriptionPurchase(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { botState: true },
  });
  const state = decodeBotState(user?.botState);
  if (state?.key !== "pending_subscription_purchase") {
    return null;
  }

  const planId = String(state.payload.planId || "");
  const period = String(state.payload.period || "");
  if (!planId || !period) {
    await clearPendingSubscriptionPurchase(userId);
    return null;
  }

  const result = await purchaseSubscriptionForUser(userId, planId, period);
  if (!result.ok && result.reason !== "insufficient_balance") {
    await clearPendingSubscriptionPurchase(userId);
  }

  return result;
}
