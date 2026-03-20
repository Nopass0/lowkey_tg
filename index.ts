import { bot } from "./src/utils/bot";
import { prisma } from "./src/utils/prisma";
import { handleStart } from "./src/commands/start";
import { handleTextMessageWithSiteBilling } from "./src/commands/textHandlerSite";
import {
  handleMenuMain,
  handleMenuPromo,
  handleMenuReferral,
  handleMenuSupport,
  handleMenuVpn,
  handleLogout,
} from "./src/actions/menus";
import { handleMenuTopupViaSite } from "./src/actions/siteBilling";
import {
  handleBuyPromoPlan,
  handleMenuTariffPeriodsWithPromo,
  handleMenuTariffsWithPromo,
} from "./src/actions/promoTariffs";
import {
  handleCardAction,
  handleMenuCards,
  handleMenuProfileWithPayments,
  handleToggleAutoRenewalSmart,
} from "./src/actions/profilePayments";
import {
  handleHowToAndroid,
  handleHowToConnect,
  handleHowToIos,
  handleHowToSetup,
  handleHowToWindows,
} from "./src/actions/howToConnect";
import { handleBuyPlan } from "./src/actions/buyPlan";
import { onPaymentSuccess, getSbpClient, startPaymentWorker, processPaymentSuccess } from "./src/utils/sbp";
import { startSubscriptionWorker } from "./src/utils/subscriptionWorker";
import { tryCompletePendingSubscriptionPurchase } from "./src/utils/subscriptionPurchase";
import {
  handleAdminBroadcast,
  handleAdminPromoAction,
  handleAdminPromos,
  handleAdminTicketAction,
  handleAdminTickets,
  handleAdminUserAction,
  handleAdminUserReferrals,
  handleAdminUserTransactions,
  handleAdminUserView,
  handleAdminUsers,
  handleAdminWithdrawalAction,
  handleAdminWithdrawals,
} from "./src/actions/admin";
import {
  handleAdminMenuWithPayments,
  handleAdminPaymentsAction,
} from "./src/actions/adminPayments";
import {
  handleAdminBroadcastFlow,
  handleAdminPromoBuilderAction,
  handleAdminTicketReplyFlow,
  handleSupportAction,
} from "./src/actions/flows";
import { startMailingWorker } from "./src/utils/mailings";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in .env");
}

/**
 * Installs small runtime compatibility patches for Bun and Telegraf.
 */
function applyRuntimePatches() {
  try {
    const originalRedactToken = (bot as any)?.handleError;
    void originalRedactToken;
  } catch (error) {
    console.error("[runtime] failed to apply patches", error);
  }
}

applyRuntimePatches();

process.on("uncaughtException", (error) => {
  console.error("[global] uncaught exception", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[global] unhandled rejection", promise, reason);
});

bot.command("start", async (ctx) => {
  const text = (ctx.message as any)?.text || "";
  (ctx as any).startPayload = text.split(" ")[1] || "";
  await handleStart(ctx);
});

bot.action("menu_main", handleMenuMain);
bot.action("menu_profile", handleMenuProfileWithPayments);
bot.action("menu_vpn", handleMenuVpn);
bot.action("menu_tariffs", handleMenuTariffsWithPromo);
bot.action("menu_promo", handleMenuPromo);
bot.action("menu_referral", handleMenuReferral);
bot.action("menu_support", handleMenuSupport);
bot.action("menu_topup", handleMenuTopupViaSite);
bot.action("toggle_auto_renewal", handleToggleAutoRenewalSmart);
bot.action("menu_cards", handleMenuCards);
bot.action(/^card_(view|default|auto|remove)_.+$/, handleCardAction);
bot.action("logout", handleLogout);
bot.action("menu_withdraw", async (ctx) => {
  const { handleMenuWithdraw } = await import("./src/actions/menus");
  await handleMenuWithdraw(ctx);
});

bot.action("support_create", handleSupportAction);
bot.action(/^support_list:(open|closed):(\d+)$/, handleSupportAction);
bot.action(/^support_view:(.+):(\d+):(open|closed)$/, handleSupportAction);
bot.action("support_confirm", handleSupportAction);
bot.action("support_cancel", handleSupportAction);

bot.action("menu_admin", handleAdminMenuWithPayments);
bot.action("admin_payments", handleAdminPaymentsAction);
bot.action(/^admin_payments_.+$/, handleAdminPaymentsAction);
bot.action(/^admin_users_(\d+)$/, handleAdminUsers);
bot.action(/^admin_user_view_(.+)$/, handleAdminUserView);
bot.action(/^admin_user_referrals_(.+)_(\d+)$/, handleAdminUserReferrals);
bot.action(/^admin_user_transactions_(.+)_(\d+)$/, handleAdminUserTransactions);
bot.action(/^admin_user_(.+)$/, handleAdminUserAction);
bot.action(/^admin_add_sub_(.+)$/, handleAdminUserAction);

bot.action(/^admin_promos(?::\d+)?$/, handleAdminPromos);
bot.action("admin_promo_create", handleAdminPromoAction);
bot.action(/^admin_promo_view:.+$/, handleAdminPromoAction);
bot.action(/^admin_promo_del:.+$/, handleAdminPromoAction);
bot.action(/^admin_promo_(conditions_menu|conditions_done|effects_menu|preview|save|cancel)$/, handleAdminPromoBuilderAction);
bot.action(/^admin_promo_condition:.+$/, handleAdminPromoBuilderAction);
bot.action(/^admin_promo_effect:.+$/, handleAdminPromoBuilderAction);

bot.action(/^admin_tickets:(open|closed):(\d+)$/, handleAdminTickets);
bot.action(/^admin_ticket_view:.+$/, handleAdminTicketAction);
bot.action(/^admin_ticket_reply:.+$/, handleAdminTicketAction);
bot.action(/^admin_ticket_toggle:.+$/, handleAdminTicketAction);
bot.action("admin_ticket_reply_confirm", handleAdminTicketReplyFlow);
bot.action("admin_ticket_reply_cancel", handleAdminTicketReplyFlow);

bot.action("admin_withdrawals", handleAdminWithdrawals);
bot.action(/^admin_wd_(approve|reject)_(.+)$/, handleAdminWithdrawalAction);

bot.action(/^admin_broadcasts(?::\d+)?$/, handleAdminBroadcast);
bot.action("admin_broadcast_create", handleAdminBroadcastFlow);
bot.action(/^admin_broadcast_target:.+$/, handleAdminBroadcastFlow);
bot.action(/^admin_broadcast_schedule:.+$/, handleAdminBroadcastFlow);
bot.action(/^admin_broadcast_view:.+$/, handleAdminBroadcastFlow);
bot.action("admin_broadcast_confirm", handleAdminBroadcastFlow);
bot.action("admin_broadcast_cancel", handleAdminBroadcastFlow);

bot.action("how_to_connect", handleHowToConnect);
bot.action("how_to_android", handleHowToAndroid);
bot.action("how_to_ios", handleHowToIos);
bot.action("how_to_windows", handleHowToWindows);
bot.action("how_to_setup", handleHowToSetup);

bot.action(/^legal_accept_all:(.+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const userId = (ctx as any).match?.[1];
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const shadowUser = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { tempReferrerId: true, id: true, login: true },
  });

  const finalReferredById = user.referredById || shadowUser?.tempReferrerId || null;

  if (user.telegramId && user.telegramId !== BigInt(telegramId)) {
    await ctx.answerCbQuery("Аккаунт уже привязан к другому Telegram.", {
      show_alert: true,
    });
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramId: BigInt(telegramId),
      telegramLinkCode: null,
      referredById: finalReferredById,
    },
  });

  if (shadowUser && shadowUser.id !== userId && shadowUser.login.startsWith("tg_")) {
    await prisma.user.delete({ where: { id: shadowUser.id } }).catch(() => {});
  }

  await ctx.answerCbQuery("Аккаунт привязан.");
  await handleMenuMain(ctx);
});

bot.action(/^plan_view_(.+)$/, handleMenuTariffPeriodsWithPromo);
bot.action(/^buy_(.+)_(.+)$/, handleBuyPlan);
bot.action(/^buypromo_(.+)$/, handleBuyPromoPlan);

bot.action(/^check_payment_(.+)$/, async (ctx) => {
  const qrcId = (ctx as any).match?.[1];
  const payment = await prisma.payment.findFirst({
    where: {
      sbpPaymentId: qrcId,
      status: { in: ["pending", "expired", "failed"] },
    },
  });

  if (!payment) {
    await ctx.answerCbQuery("Платёж не найден.", { show_alert: true });
    return;
  }

  try {
    const sbp = getSbpClient();
    let statusData: any = await sbp.getPaymentStatus(qrcId || "");
    let firstStatus = Array.isArray(statusData) ? statusData[0] : statusData;
    if (firstStatus?.data && Array.isArray(firstStatus.data)) {
      firstStatus = firstStatus.data[0];
    }

    const status = firstStatus?.operationStatus || firstStatus?.status;
    if (!status) {
      await ctx.answerCbQuery("Платёж ещё в обработке.", { show_alert: true });
      return;
    }

    if (["ACWP", "ACSC", "Accepted"].includes(status)) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "success" },
      });
      await processPaymentSuccess(payment.userId, payment.amount);
      await ctx.editMessageText(`Платёж на ${payment.amount} ₽ успешно завершён.`);
      await ctx.answerCbQuery("Оплата подтверждена.");
      return;
    }

    if (["RJCT", "CANC", "Rejected"].includes(status)) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "failed" },
      });
      await ctx.editMessageText(`Платёж на ${payment.amount} ₽ отклонён.`);
      await ctx.answerCbQuery("Оплата отклонена.");
      return;
    }

    await ctx.answerCbQuery("Платёж ещё в обработке.", { show_alert: true });
  } catch (error) {
    console.error("[payment-check] failed", error);
    await ctx.answerCbQuery("Не удалось проверить оплату.", { show_alert: true });
  }
});

bot.on("text", handleTextMessageWithSiteBilling);

onPaymentSuccess(async ({ userId, amount, referrerId, commission }) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.telegramId) {
      await bot.telegram.sendMessage(
        Number(user.telegramId),
        `✅ Ваш платёж на ${amount} ₽ получен.`,
      ).catch(() => {});

      const purchaseResult = await tryCompletePendingSubscriptionPurchase(userId);
      if (purchaseResult?.ok) {
        await bot.telegram.sendMessage(
          Number(user.telegramId),
          `✅ Подписка "${purchaseResult.plan.name}" автоматически оформлена до ${purchaseResult.newActiveUntil.toLocaleDateString("ru-RU")}.`,
        ).catch(() => {});
      } else if (purchaseResult && !purchaseResult.ok && purchaseResult.reason === "insufficient_balance") {
        await bot.telegram.sendMessage(
          Number(user.telegramId),
          `Платёж зачислен, но для тарифа всё ещё не хватает ${purchaseResult.shortfall ?? 0} ₽.`,
        ).catch(() => {});
      }
    }

    if (referrerId && commission > 0) {
      const referrer = await prisma.user.findUnique({ where: { id: referrerId } });
      if (referrer?.telegramId) {
        await bot.telegram.sendMessage(
          Number(referrer.telegramId),
          `🤝 Начислена реферальная комиссия ${commission.toFixed(2)} ₽.`,
        ).catch(() => {});
      }
    }
  } catch (error) {
    console.error("[payment-notify] failed", error);
  }
});

startSubscriptionWorker();
startPaymentWorker();
startMailingWorker();

bot
  .launch()
  .then(() => {
    console.log("Bot started");
  })
  .catch((error) => {
    console.error("[bot.launch] failed", error);
  });

process.once("SIGINT", () => {
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
});
