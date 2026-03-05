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

// Validate envs
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in .env");
}

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

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

  if (user.telegramId && user.telegramId !== BigInt(telegramId)) {
    return ctx.answerCbQuery(
      "❌ Этот аккаунт уже привязан к другому Telegram.",
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { telegramId: BigInt(telegramId), telegramLinkCode: null },
  });

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

bot.action("menu_withdraw", async (ctx) => {
  const { handleMenuWithdraw } = await import("./src/actions/menus");
  return handleMenuWithdraw(ctx);
});

// Text Handling
bot.on("text", handleTextMessage);

// SBP Polling
onPaymentSuccess(async (payment) => {
  const user = await prisma.user.findUnique({ where: { id: payment.userId } });
  if (user && user.telegramId) {
    bot.telegram.sendMessage(
      Number(user.telegramId),
      `✅ Баланс успешно пополнен на ${payment.amount} ₽!`,
    );
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
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
