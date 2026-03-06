import { Telegraf, Markup } from "telegraf";
import { prisma } from "../utils/prisma";

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.catch((err: any, ctx) => {
  const errorMessage = err?.message || err?.description || String(err);
  if (errorMessage.includes("message is not modified")) {
    // Ignore this common error when users click inline buttons multiple times
    return;
  }
  console.error(`[Telegraf] Error for ${ctx.updateType}:`, err);
});

export function getMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👤 Мой профиль", "menu_profile")],
    [Markup.button.callback("🛡️ Мой VPN (Настройки подключения)", "menu_vpn")],
    [Markup.button.callback("💳 Тарифы и пополнение", "menu_tariffs")],
    [
      Markup.button.callback("🎁 Промокоды", "menu_promo"),
      Markup.button.callback("🤝 Рефералы", "menu_referral"),
    ],
    [Markup.button.callback("💬 Поддержка", "menu_support")],
  ]);
}
