import { bot } from "./src/utils/bot";
import { prisma } from "./src/utils/prisma";

// --- GLOBAL STABILITY FIXES ---
// 1. Bun/Telegraf compatibility: Telegraf's redactToken tries to modify Error.message which can be readonly in Bun.
try {
  // More aggressive patch: ensure it's writable on the instance or prototype
  const originalError = Error;
  (globalThis as any).Error = function (...args: any[]) {
    const err = new originalError(...args);
    Object.defineProperty(err, "message", {
      value: err.message,
      writable: true,
      configurable: true,
    });
    return err;
  };
  Object.setPrototypeOf(globalThis.Error, originalError);
  Object.defineProperty(globalThis.Error, "prototype", {
    value: originalError.prototype,
    writable: false,
    configurable: true,
  });

  // Fallback for existing items
  Object.defineProperty(Error.prototype, "message", {
    get() {
      return (this as any)._message;
    },
    set(v) {
      (this as any)._message = v;
    },
    configurable: true,
  });
} catch (e) {
  console.error("Failed to apply stability patches:", e);
}

// 2. Global Error Handlers
process.on("uncaughtException", (err) => {
  console.error("[Global] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Global] Unhandled Rejection at:", promise, "reason:", reason);
});
// ------------------------------

import { handleStart } from "./src/commands/start";
import { handleTextMessage } from "./src/commands/textHandler";
import {
  handleMenuMain,
  handleMenuProfile,
  handleMenuVpn,
  handleMenuTariffs,
  handleMenuPromo,
  handleMenuReferral,
  handleMenuSupport,
  handleMenuTopup,
  handleMenuTariffPeriods,
  handleToggleAutoRenewal,
  handleLogout,
} from "./src/actions/menus";
import {
  handleHowToConnect,
  handleHowToAndroid,
  handleHowToIos,
  handleHowToSetup,
  handleHowToWindows,
} from "./src/actions/howToConnect";
import { handleBuyPlan } from "./src/actions/buyPlan";
import {
  getSbpClient,
  onPaymentSuccess,
  startPaymentWorker,
} from "./src/utils/sbp";
import { startSubscriptionWorker } from "./src/utils/subscriptionWorker";
import {
  handleAdminMenu,
  handleAdminUsers,
  handleAdminUserView,
  handleAdminUserAction,
  handleAdminPromos,
  handleAdminPromoAction,
  handleAdminTickets,
  handleAdminTicketAction,
  handleAdminWithdrawals,
  handleAdminWithdrawalAction,
  handleAdminBroadcast,
} from "./src/actions/admin";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in .env");
}

bot.catch((err: any, ctx) => {
  console.error(`[Telegraf] Error for ${ctx.updateType}:`, err);
});

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

// Commands
bot.command("start", async (ctx) => {
  console.log(`[/start] Received from ${ctx.from?.id}`);
  const text = (ctx.message as any)?.text || "";
  const payload = text.split(" ")[1] || "";
  (ctx as any).startPayload = payload;
  console.log(`[/start] Payload: "${payload}"`);
  return handleStart(ctx);
});

// Actions
bot.action("menu_main", handleMenuMain);
bot.action("menu_profile", handleMenuProfile);
bot.action("menu_vpn", handleMenuVpn);
bot.action("menu_tariffs", handleMenuTariffs);
bot.action("menu_promo", handleMenuPromo);
bot.action("menu_referral", handleMenuReferral);
bot.action("menu_support", handleMenuSupport);
bot.action("menu_topup", handleMenuTopup);
bot.action("menu_admin", handleAdminMenu);

bot.action(/^admin_users_(\d+)$/, handleAdminUsers);
bot.action(/^admin_user_view_(.+)$/, handleAdminUserView);
bot.action(/^admin_user_(.+)$/, handleAdminUserAction);
bot.action(/^admin_add_sub_(.+)$/, handleAdminUserAction);

bot.action("admin_promos", handleAdminPromos);
bot.action(/^admin_promo_del_(.+)$/, handleAdminPromoAction);
bot.action("admin_promo_create", handleAdminPromoAction);

bot.action("admin_tickets", handleAdminTickets);
bot.action(/^admin_ticket_view_(.+)$/, handleAdminTicketAction);

bot.action("admin_withdrawals", handleAdminWithdrawals);
bot.action(/^admin_wd_(approve|reject)_(.+)$/, handleAdminWithdrawalAction);

bot.action("admin_broadcast", handleAdminBroadcast);

bot.action("how_to_connect", handleHowToConnect);
bot.action("how_to_android", handleHowToAndroid);
bot.action("how_to_ios", handleHowToIos);
bot.action("how_to_windows", handleHowToWindows);
bot.action("how_to_setup", handleHowToSetup);

bot.action("legal_offer", async (ctx) => {
  const text =
    `📜 **Публичная оферта**\n\n` +
    `Настоящая публичная оферта является официальным предложением ИП Галин Богдан Маратович для заключения пользовательского соглашения.\n\n` +
    `1. **Отказ от ответственности**: Сервис предоставляется "как есть". Исполнитель не несет ответственности за любые убытки или финансовые потери.\n\n` +
    `2. **Претензии**: Пользователь отказывается от любых претензий, связанных с работой сервиса или блокировками.\n\n` +
    `3. **Возврат средств**: Возврат денежных средств за оплаченные услуги **не предусмотрен ни при каких обстоятельствах.**\n\n` +
    `4. **Обязательства**: Исполнитель не имеет обязательств по доступности сервиса и может ограничить доступ в любое время.`;
  await ctx.reply(text, { parse_mode: "Markdown" });
  return ctx.answerCbQuery();
});

bot.action("legal_privacy", async (ctx) => {
  const text =
    `🔒 **Политика конфиденциальности**\n\n` +
    `Мы собираем информацию о вашей активности для обеспечения работы сервиса.\n\n` +
    `1. **Сбор данных**: Включает технические характеристики, IP-адреса и логи соединений.\n\n` +
    `2. **Хранение**: Мы оставляем за собой право хранить данные без ограничения по времени.\n\n` +
    `3. **Передача третьим лицам**: Пользователь соглашается с тем, что Исполнитель имеет неограниченное право передавать и продавать собранную информацию любым третьим лицам по собственному усмотрению.`;
  await ctx.reply(text, { parse_mode: "Markdown" });
  return ctx.answerCbQuery();
});

bot.action(/^legal_accept_all:(.+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const userId = ctx.match[1];
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return ctx.answerCbQuery("❌ Ошибка: пользователь не найден.");

  // Fetch the shadow user to get potential referral link from the Current Session
  const shadowUser = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { tempReferrerId: true, id: true, login: true },
  });

  const finalReferredById =
    user.referredById || shadowUser?.tempReferrerId || null;

  if (user.telegramId && user.telegramId !== BigInt(telegramId)) {
    return ctx.answerCbQuery(
      "❌ Этот аккаунт уже привязан к другому Telegram.",
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramId: BigInt(telegramId),
      telegramLinkCode: null,
      referredById: finalReferredById,
    },
  });

  // If a referral was just applied (user didn't have one, but session did)
  if (!user.referredById && finalReferredById) {
    const referrer = await prisma.user.findUnique({
      where: { id: finalReferredById },
      select: { telegramId: true },
    });
    if (referrer?.telegramId) {
      try {
        await bot.telegram.sendMessage(
          Number(referrer.telegramId),
          `🤝 Пользователь <b>${user.login}</b> (уже был аккаунт) привязался по вашей ссылке!`,
          { parse_mode: "HTML" },
        );
      } catch {}
    }
  }

  // Cleanup: if the session user was separate shadow record, delete it
  if (
    shadowUser &&
    shadowUser.id !== userId &&
    shadowUser.login.startsWith("tg_")
  ) {
    await prisma.user.delete({ where: { id: shadowUser.id } }).catch(() => {});
  }

  await ctx.answerCbQuery("✅ Вы успешно привязали аккаунт!");
  await ctx.editMessageText(
    `🎉 Поздравляем, **${user.login}**! Ваш аккаунт успешно привязан.`,
    { parse_mode: "Markdown" },
  );
  return handleMenuMain(ctx);
});

bot.action("toggle_auto_renewal", handleToggleAutoRenewal);
bot.action("logout", handleLogout);

bot.action(/^plan_view_(.+)$/, handleMenuTariffPeriods);
bot.action(/^buy_(.+)_(.+)$/, handleBuyPlan);

bot.action(/^check_payment_(.+)$/, async (ctx) => {
  const qrcId = ctx.match[1];
  const payment = await prisma.payment.findFirst({
    where: {
      sbpPaymentId: qrcId,
      status: { in: ["pending", "expired", "failed"] },
    },
  });

  if (!payment) {
    return ctx.answerCbQuery("❌ Платеж не найден или уже обработан.", {
      show_alert: true,
    });
  }

  const sbp = getSbpClient();
  try {
    let statusData: any = await sbp.getPaymentStatus(qrcId || "");
    let firstStatus = Array.isArray(statusData) ? statusData[0] : statusData;
    if (firstStatus?.data && Array.isArray(firstStatus.data)) {
      firstStatus = firstStatus.data[0];
    }

    if (!firstStatus) {
      return ctx.answerCbQuery(
        "⏳ Платёж еще не прошел. Подождите пару минут.",
        {
          show_alert: true,
        },
      );
    }

    const status = firstStatus.operationStatus || firstStatus.status;

    if (!status) {
      return ctx.answerCbQuery(
        "⏳ Платёж еще не прошел. Подождите пару минут.",
        {
          show_alert: true,
        },
      );
    }

    if (status === "ACWP" || status === "ACSC" || status === "Accepted") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "success" },
      });
      // Import the success handler directly
      const { processPaymentSuccess } = await import("./src/utils/sbp");
      await processPaymentSuccess(payment.userId, payment.amount);

      await ctx.editMessageText(
        `✅ Платеж на **${payment.amount} ₽** успешно завершен!\nБаланс пополнен.`,
        { parse_mode: "Markdown" },
      );
      return ctx.answerCbQuery("✅ Оплата прошла успешно!");
    } else if (
      status === "RJCT" ||
      status === "CANC" ||
      status === "Rejected"
    ) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "failed" },
      });
      await ctx.editMessageText(
        `❌ Платеж на **${payment.amount} ₽** был отменен или отклонен.`,
        { parse_mode: "Markdown" },
      );
      return ctx.answerCbQuery("❌ Оплата отклонена.");
    }

    return ctx.answerCbQuery(
      "⏳ Оплата еще в процессе. Если вы уже оплатили, подождите еще пару минут.",
      {
        show_alert: true,
      },
    );
  } catch (err) {
    console.error("Manual check error:", err);
    return ctx.answerCbQuery(
      "❌ Ошибка при проверке статуса. Попробуйте позже.",
      {
        show_alert: true,
      },
    );
  }
});

bot.action("menu_withdraw", async (ctx) => {
  const { handleMenuWithdraw } = await import("./src/actions/menus");
  return handleMenuWithdraw(ctx);
});

// Text Handling
bot.on("text", handleTextMessage);

// Polling notification listener
onPaymentSuccess(async (data: any) => {
  const { userId, amount, referrerId, commission } = data;

  try {
    // 1. Notify the user who paid
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && user.telegramId) {
      try {
        await bot.telegram.sendMessage(
          Number(user.telegramId),
          `✅ Ваша оплата на **${amount} ₽** получена! Баланс пополнен.`,
          { parse_mode: "Markdown" },
        );
      } catch (err) {
        console.error(
          `Failed to send payment notification to user ${userId}:`,
          err,
        );
      }
    }

    // 2. Notify the referrer if applicable
    if (referrerId && commission > 0) {
      const referrer = await prisma.user.findUnique({
        where: { id: referrerId },
      });
      if (referrer && referrer.telegramId) {
        try {
          await bot.telegram.sendMessage(
            Number(referrer.telegramId),
            `🤝 Вам начислено **${commission.toFixed(2)} ₽** реферальных за пополнение вашего партнера **${user?.login}**!`,
            { parse_mode: "Markdown" },
          );
        } catch (err) {
          console.error(
            `Failed to send referral notification to referrer ${referrerId}:`,
            err,
          );
        }
      }
    }
  } catch (err) {
    console.error("General error in onPaymentSuccess handler:", err);
  }
});

// Start workers
startSubscriptionWorker();
startPaymentWorker();

// Launch
bot.launch().then(() => {
  console.log("Bot started!");
});

// Enable graceful stop
process.once("SIGINT", () => {
  try {
    bot.stop("SIGINT");
  } catch (e) {}
});
process.once("SIGTERM", () => {
  try {
    bot.stop("SIGTERM");
  } catch (e) {}
});
