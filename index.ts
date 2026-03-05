import { bot } from "./src/utils/bot";
import { prisma } from "./src/utils/prisma";
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
  handleMenuAdmin,
  handleToggleAutoRenewal,
} from "./src/actions/menus";
import {
  handleHowToConnect,
  handleHowToAndroid,
  handleHowToIos,
  handleHowToSetup,
  handleHowToWindows,
} from "./src/actions/howToConnect";
import { handleBuyPlan } from "./src/actions/buyPlan";
import { getSbpClient, onPaymentSuccess } from "./src/utils/sbp";
import { startSubscriptionWorker } from "./src/utils/subscriptionWorker";

// Validate envs
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in .env");
}

// Commands
bot.command("start", handleStart);

// Actions
bot.action("menu_main", handleMenuMain);
bot.action("menu_profile", handleMenuProfile);
bot.action("menu_vpn", handleMenuVpn);
bot.action("menu_tariffs", handleMenuTariffs);
bot.action("menu_promo", handleMenuPromo);
bot.action("menu_referral", handleMenuReferral);
bot.action("menu_support", handleMenuSupport);
bot.action("menu_topup", handleMenuTopup);
bot.action("menu_admin", handleMenuAdmin);

bot.action("how_to_connect", handleHowToConnect);
bot.action("how_to_android", handleHowToAndroid);
bot.action("how_to_ios", handleHowToIos);
bot.action("how_to_setup", handleHowToSetup);
bot.action("how_to_windows", handleHowToWindows);
bot.action("toggle_auto_renewal", handleToggleAutoRenewal);

bot.action(/^plan_view_(.+)$/, handleMenuTariffPeriods);
bot.action(/^buy_(.+?)_(.+)$/, handleBuyPlan);

bot.action(/^check_payment_(.+)$/, async (ctx) => {
  // @ts-ignore
  const paymentId = ctx.match[1];
  if (!paymentId) return;

  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment)
      return ctx.answerCbQuery("❌ Платеж не найден.", { show_alert: true });

    if (payment.status === "success") {
      return ctx.answerCbQuery(`✅ Этот платеж уже успешно оплачен!`, {
        show_alert: true,
      });
    }

    if (new Date() > payment.expiresAt) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "expired" },
      });
      return ctx.answerCbQuery("❌ Время на оплату вышло.", {
        show_alert: true,
      });
    }

    // Check with API
    const sbp = getSbpClient();
    const [statusData] = await sbp.getPaymentStatus(payment.sbpPaymentId);

    if (statusData) {
      const sbpStatus =
        (statusData as any).status || (statusData as any).operationStatus;

      if (
        sbpStatus === "ACWP" ||
        sbpStatus === "ACSC" ||
        sbpStatus === "Accepted"
      ) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "success" },
        });
        await onPaymentSuccess(payment.userId, payment.amount);

        await ctx.answerCbQuery(
          `✅ Оплата на ${payment.amount} ₽ успешно зачислена!`,
          { show_alert: true },
        );

        // Return to main menu
        if (ctx.callbackQuery.message) {
          await ctx.editMessageText(
            `✅ Баланс успешно пополнен на **${payment.amount} ₽**.\n\nСпасибо за оплату!`,
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
        return;
      } else if (
        sbpStatus === "RJCT" ||
        sbpStatus === "CANC" ||
        sbpStatus === "Rejected"
      ) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "failed" },
        });
        return ctx.answerCbQuery("❌ Платеж отклонен банком.", {
          show_alert: true,
        });
      }
    }

    await ctx.answerCbQuery(
      "⏳ Ваша оплата еще обрабатывается банком. Пожалуйста, подождите немного и нажмите кнопку проверки снова.",
      { show_alert: true },
    );
  } catch (err) {
    console.error("[Bot] Check payment error:", err);
    await ctx.answerCbQuery("❌ Ошибка при проверке статуса.", {
      show_alert: true,
    });
  }
});

// Temp stub for all other queries
bot.on("callback_query", (ctx, next) => {
  // Try to match other actions if needed, or pass
  return next();
});

// Text handling for user linking, topups, support & promo
bot.on("text", handleTextMessage);

// Launch
bot
  .launch()
  .then(() => {
    console.log("🤖 Lowkey VPN Bot is running!");
    startSubscriptionWorker();
  })
  .catch((err) => console.error("Failed to start bot:", err));

// Graceful stop
process.once("SIGINT", async () => {
  bot.stop("SIGINT");
  await prisma.$disconnect();
});
process.once("SIGTERM", async () => {
  bot.stop("SIGTERM");
  await prisma.$disconnect();
});
