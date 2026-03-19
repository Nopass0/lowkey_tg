import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { editOrReply } from "../utils/telegram";
import { handleAdminMenu as handleLegacyAdminMenu } from "./admin";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

function isAdmin(ctx: Context): boolean {
  return Boolean(ctx.from?.id && ctx.from.id.toString() === ADMIN_ID);
}

async function getSettings() {
  return prisma.yokassaSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", mode: "test", testSubscriptionEnabled: false },
  });
}

async function renderAdminPayments(ctx: Context) {
  const settings = await getSettings();

  await editOrReply(
    ctx,
    `💳 *Платежи*\n\n` +
      `Режим YooKassa: *${settings.mode === "production" ? "боевой" : "тестовый"}*\n` +
      `Тестовая подписка 10 ₽ / 2 мин: *${settings.testSubscriptionEnabled ? "включена" : "выключена"}*\n` +
      `СБП-провайдер: *${settings.sbpProvider === "yookassa" ? "YooKassa" : "Точка Банк"}*`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback("Тестовый режим", "admin_payments_mode_test"),
          Markup.button.callback("Боевой режим", "admin_payments_mode_production"),
        ],
        [
          Markup.button.callback(
            settings.testSubscriptionEnabled
              ? "Выключить тест-подписку"
              : "Включить тест-подписку",
            "admin_payments_test_sub_toggle",
          ),
        ],
        [
          Markup.button.callback("СБП: Точка", "admin_payments_sbp_tochka"),
          Markup.button.callback("СБП: YooKassa", "admin_payments_sbp_yookassa"),
        ],
        [Markup.button.callback("◀️ В админку", "menu_admin")],
      ]).reply_markup,
    },
  );
}

export async function handleAdminMenuWithPayments(ctx: Context) {
  if (!isAdmin(ctx)) return;

  await handleLegacyAdminMenu(ctx);
  await ctx.reply("Быстрые настройки платежей:", {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback("💳 Платежи", "admin_payments")],
    ]).reply_markup,
  });
}

export async function handleAdminPaymentsAction(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = (ctx.callbackQuery as any)?.data as string;
  if (!data) return;

  if (data === "admin_payments") {
    await renderAdminPayments(ctx);
    return;
  }

  if (data === "admin_payments_mode_test") {
    await prisma.yokassaSettings.upsert({
      where: { id: "global" },
      update: { mode: "test" },
      create: { id: "global", mode: "test", testSubscriptionEnabled: false },
    });
    await ctx.answerCbQuery("Переключено в тестовый режим.");
    await renderAdminPayments(ctx);
    return;
  }

  if (data === "admin_payments_mode_production") {
    await prisma.yokassaSettings.upsert({
      where: { id: "global" },
      update: { mode: "production" },
      create: { id: "global", mode: "production", testSubscriptionEnabled: false },
    });
    await ctx.answerCbQuery("Переключено в боевой режим.");
    await renderAdminPayments(ctx);
    return;
  }

  if (data === "admin_payments_test_sub_toggle") {
    const settings = await getSettings();
    await prisma.yokassaSettings.update({
      where: { id: "global" },
      data: { testSubscriptionEnabled: !settings.testSubscriptionEnabled },
    });
    await ctx.answerCbQuery("Настройка обновлена.");
    await renderAdminPayments(ctx);
    return;
  }

  if (data === "admin_payments_sbp_tochka" || data === "admin_payments_sbp_yookassa") {
    await prisma.yokassaSettings.upsert({
      where: { id: "global" },
      update: { sbpProvider: data.endsWith("yookassa") ? "yookassa" : "tochka" },
      create: {
        id: "global",
        mode: "test",
        testSubscriptionEnabled: false,
        sbpProvider: data.endsWith("yookassa") ? "yookassa" : "tochka",
      },
    });
    await ctx.answerCbQuery("Провайдер СБП обновлён.");
    await renderAdminPayments(ctx);
  }
}
