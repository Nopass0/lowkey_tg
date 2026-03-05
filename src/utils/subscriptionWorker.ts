import { bot } from "./bot";
import { prisma } from "./prisma";
import { PLANS, PERIOD_DAYS } from "./plans";

export async function startSubscriptionWorker() {
  console.log("🕒 Starting Subscription Worker...");

  // Run once on startup, then every 6 hours
  await checkSubscriptions();
  setInterval(checkSubscriptions, 6 * 60 * 60 * 1000);
}

async function checkSubscriptions() {
  try {
    console.log("🔍 Checking subscriptions for notifications and renewals...");
    const now = new Date();

    const sevenDaysAway = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const threeDaysAway = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayAway = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // We find active subscriptions that are about to expire
    const subs = await prisma.subscription.findMany({
      where: {
        isLifetime: false,
        activeUntil: { gt: now, lt: sevenDaysAway },
      },
      include: { user: true },
    });

    for (const sub of subs) {
      if (!sub.user.telegramId) continue;

      const diffHours =
        (sub.activeUntil.getTime() - now.getTime()) / (1000 * 60 * 60);
      const diffDays = Math.ceil(diffHours / 24);

      let message = "";
      if (diffDays === 7)
        message = "🗓 **До конца вашей подписки осталось 7 дней.**";
      else if (diffDays === 3)
        message = "🗓 **До конца вашей подписки осталось 3 дня.**";
      else if (diffDays === 1)
        message = "⚠️ **Ваша подписка истекает завтра!**";

      if (message) {
        const renewalMethod = sub.autoRenewal
          ? "\n\n🔄 У вас включено автопродление. Убедитесь, что на балансе достаточно средств."
          : "\n\n❌ Автопродление выключено. Продлите подписку в меню профиля.";

        try {
          await bot.telegram.sendMessage(
            sub.user.telegramId.toString(),
            message + renewalMethod,
            {
              parse_mode: "Markdown",
            },
          );
        } catch (e) {}
      }
    }

    // Handle actual expiration (Auto-renewal)
    const expiringNow = await prisma.subscription.findMany({
      where: {
        isLifetime: false,
        activeUntil: { lte: now },
        autoRenewal: true,
      },
      include: { user: true },
    });

    for (const sub of expiringNow) {
      // Attempt renewal
      await attemptAutoRenewal(sub);
    }
  } catch (err: any) {
    if (err.code === "P1017" || err.message?.includes("connection")) {
      console.log(
        "🕒 Subscription Worker: Database connection lost, retrying in next cycle...",
      );
    } else {
      console.error("🕒 Subscription Worker error:", err);
    }
  }
}

async function attemptAutoRenewal(subscription: any) {
  const user = subscription.user;
  // Assume monthly renewal for simplicity, or look up the last period from transactions (default to monthly)
  const period = "monthly";
  const plan = PLANS.find((p) => p.id === subscription.planId) || PLANS[0];
  const price = (plan.prices as any)[period];

  if (user.balance >= price) {
    const durationMs = PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
    const newUntil = new Date(subscription.activeUntil.getTime() + durationMs);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: price } },
      });
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { activeUntil: newUntil },
      });
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "subscription_auto",
          amount: -price,
          title: `Автопродление "${plan.name}"`,
        },
      });
    });

    try {
      await bot.telegram.sendMessage(
        user.telegramId.toString(),
        `✅ **Ваша подписка "${plan.name}" была успешно продлена на месяц.**\n\nСледующее списание: ${newUntil.toLocaleDateString("ru-RU")}`,
        { parse_mode: "Markdown" },
      );
    } catch (e) {}
  } else {
    // Not enough balance
    try {
      await bot.telegram.sendMessage(
        user.telegramId.toString(),
        `❌ **Ошибка автопродления!**\n\nНа вашем балансе недостаточно средств (${user.balance} ₽) для продления подписки "${plan.name}" за ${price} ₽.\n\nПодписка временно приостановлена. Пополните баланс для возобновления.`,
        { parse_mode: "Markdown" },
      );
    } catch (e) {}

    // Switch off auto-renewal to stop spamming every check
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { autoRenewal: false },
    });
  }
}
