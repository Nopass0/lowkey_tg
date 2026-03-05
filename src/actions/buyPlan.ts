import { Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { PLANS, PERIOD_DAYS } from "../utils/plans";

export async function handleBuyPlan(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // @ts-ignore
  const planId = ctx.match[1];
  // @ts-ignore
  const period = ctx.match[2];

  if (!planId || !period) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });
  if (!user) return;

  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) {
    return ctx.answerCbQuery("❌ Тариф не найден или больше недоступен", {
      show_alert: true,
    });
  }

  // @ts-ignore
  const pricePerMonth = plan.prices[period];
  if (pricePerMonth === undefined) {
    return ctx.answerCbQuery("❌ Неверный период оплаты.", {
      show_alert: true,
    });
  }

  const days = PERIOD_DAYS[period];
  if (!days) return;

  const months = days / 30;
  const baseTotalPrice = pricePerMonth * months;

  const fixedDiscount = user.pendingDiscountFixed ?? 0;
  const pctDiscount = user.pendingDiscountPct ?? 0;
  let discountedPrice = baseTotalPrice;

  if (fixedDiscount > 0) {
    discountedPrice = Math.max(0, discountedPrice - fixedDiscount);
  }
  if (pctDiscount > 0) {
    discountedPrice = discountedPrice * (1 - pctDiscount / 100);
  }
  const finalPrice = Math.max(1, Math.round(discountedPrice * 100) / 100);

  if (user.balance < finalPrice) {
    return ctx.answerCbQuery(
      "❌ Недостаточно средств на балансе. Пополните счет.",
      { show_alert: true },
    );
  }

  // Calculate new activeUntil
  const durationMs = days * 24 * 60 * 60 * 1000;
  let newActiveUntil = new Date(Date.now() + durationMs);

  if (user.subscription && user.subscription.activeUntil > new Date()) {
    // Extend existing
    newActiveUntil = new Date(
      user.subscription.activeUntil.getTime() + durationMs,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Deduct balance and clear discounts
    await tx.user.update({
      where: { id: user.id },
      data: {
        balance: { decrement: finalPrice },
        pendingDiscountPct: 0,
        pendingDiscountFixed: 0,
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

    const periodLabel =
      period === "monthly"
        ? "1 мес."
        : period === "3months"
          ? "3 мес."
          : period === "6months"
            ? "6 мес."
            : "1 год";
    const discountNote =
      fixedDiscount > 0 || pctDiscount > 0 ? ` (скидка)` : "";

    await tx.transaction.create({
      data: {
        userId: user.id,
        type: "subscription",
        amount: -finalPrice,
        title: `Подписка "${plan.name}" на ${periodLabel}${discountNote}`,
      },
    });

    // 4. Award dynamic referral commission
    // 3. Award dynamic referral commission
    // The `user` object is already available from the outer scope.
    // We use `user.id` and `finalPrice` for the commission calculation.
    if (user.referredById) {
      const referrer = await tx.user.findUnique({
        where: { id: user.referredById },
        select: { referralRate: true },
      });
      const rate = referrer?.referralRate ?? 0.2;
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

  await ctx.answerCbQuery(`✅ Тариф ${plan.name} успешно оплачен!`, {
    show_alert: true,
  });
  await ctx.editMessageText(
    `✅ Вы успешно оплатили тариф **${plan.name}** за ${finalPrice} ₽.\n\nПодписка активна до ${newActiveUntil.toLocaleDateString("ru-RU")}.\n\nПерейдите в 🛡️ Мой VPN для получения ссылки на подключение.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "◀️ В главное меню", callback_data: "menu_main" }],
        ],
      },
    },
  );
}
