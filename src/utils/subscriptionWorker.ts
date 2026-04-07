import { Markup } from "telegraf";
import { bot } from "./bot";
import { prisma } from "./prisma";
import { PERIOD_DAYS, PERIOD_LABELS, getPlanById } from "./plans";
import { calculateDiscountedPrice } from "./subscriptionPurchase";

export async function startSubscriptionWorker() {
  console.log("Starting Subscription Worker...");

  await checkSubscriptions();
  setInterval(checkSubscriptions, 40 * 60 * 1000);
}

async function checkSubscriptions() {
  try {
    console.log("Checking subscriptions for notifications and renewals...");
    const now = new Date();
    const oneDayAway = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const expiringSoon = await prisma.subscription.findMany({
      where: {
        isLifetime: false,
        activeUntil: { gt: now, lte: oneDayAway },
      },
      include: { user: true },
    });

    for (const subscription of expiringSoon) {
      if (!subscription.user.telegramId) continue;
      await sendExpiryReminder(subscription);
    }

    const expiringNow = await prisma.subscription.findMany({
      where: {
        isLifetime: false,
        activeUntil: { lte: now },
        autoRenewal: true,
      },
      include: { user: true },
    });

    for (const subscription of expiringNow) {
      await attemptAutoRenewal(subscription);
    }
  } catch (err: any) {
    if (err.code === "P1017" || err.message?.includes("connection")) {
      console.log(
        "Subscription Worker: Database connection lost, retrying in next cycle...",
      );
    } else {
      console.error("Subscription Worker error:", err);
    }
  }
}

async function sendExpiryReminder(subscription: any) {
  const plan = await getPlanById(subscription.planId);
  if (!plan) return;

  const fixedDiscount = subscription.user.pendingDiscountFixed ?? 0;
  const pctDiscount = subscription.user.pendingDiscountPct ?? 0;

  const buttons = Object.entries(plan.prices)
    .filter(([period]) => period in PERIOD_DAYS && period in PERIOD_LABELS)
    .map(([period, monthlyPrice]) => {
      const periodDays = PERIOD_DAYS[period];
      const periodLabel = PERIOD_LABELS[period];
      if (!periodDays || !periodLabel) {
        return null;
      }

      const totalPrice = calculateDiscountedPrice(
        monthlyPrice * (periodDays / 30),
        fixedDiscount,
        pctDiscount,
      );
      return [
        Markup.button.callback(
          `${periodLabel} · ${totalPrice} ₽`,
          `buy_${plan.id}_${period}`,
        ),
      ];
    })
    .filter((buttonRow): buttonRow is ReturnType<typeof Markup.button.callback>[] => Boolean(buttonRow));

  buttons.push([Markup.button.callback("💳 Пополнить баланс", "menu_topup")]);

  const renewalNote = subscription.autoRenewal
    ? "\n\nАвтопродление включено, но вы можете продлить подписку вручную уже сейчас."
    : "\n\nАвтопродление выключено. Продлите подписку заранее, чтобы не было паузы.";
  const discountNote =
    pctDiscount > 0
      ? `\nАктивна скидка: ${pctDiscount}%`
      : fixedDiscount > 0
        ? `\nАктивна скидка: ${fixedDiscount} ₽`
        : "";

  await bot.telegram
    .sendMessage(
      subscription.user.telegramId.toString(),
      `⚠️ *Подписка "${plan.name}" заканчивается завтра*\n\n` +
        `Действует до: *${subscription.activeUntil.toLocaleDateString("ru-RU")}*\n` +
        `Баланс: *${subscription.user.balance} ₽*` +
        discountNote +
        `\n\n` +
        `Если не продлить подписку вовремя, сервис отключится и могут возникнуть проблемы с подключением к интернету.` +
        renewalNote +
        `\n\nВыберите срок продления по текущей цене:`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      },
    )
    .catch((error) => {
      console.error("[subscription-reminder] failed", error);
    });
}

async function attemptAutoRenewal(subscription: any) {
  const user = subscription.user;
  const period = "monthly";
  const plan = await getPlanById(subscription.planId);
  if (!user || !plan) return;

  const telegramChatId = user.telegramId?.toString();

  const durationDays = PERIOD_DAYS[period];
  const monthlyPrice = plan.prices[period];
  if (typeof monthlyPrice !== "number" || typeof durationDays !== "number") {
    return;
  }

  const totalPrice = monthlyPrice * (durationDays / 30);

  if (user.balance >= totalPrice) {
    const durationMs = durationDays * 24 * 60 * 60 * 1000;
    const newUntil = new Date(subscription.activeUntil.getTime() + durationMs);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: totalPrice } },
      });
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { activeUntil: newUntil },
      });
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "subscription_auto",
          amount: -totalPrice,
          title: `Автопродление "${plan.name}"`,
        },
      });
    });

    if (telegramChatId) {
      await bot.telegram
        .sendMessage(
          telegramChatId,
          `✅ *Ваша подписка "${plan.name}" продлена на 1 мес.*\n\nСледующее списание: ${newUntil.toLocaleDateString("ru-RU")}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
  } else {
    if (telegramChatId) {
      await bot.telegram
        .sendMessage(
          telegramChatId,
          `❌ *Автопродление не выполнено*\n\nНа балансе ${user.balance} ₽, а для продления "${plan.name}" нужен ${totalPrice} ₽.`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { autoRenewal: false },
    });
  }
}
