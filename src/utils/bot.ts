import { Markup, Telegraf } from "telegraf";

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.catch((err: any, ctx) => {
  const errorMessage = err?.message || err?.description || String(err);
  if (errorMessage.includes("message is not modified")) {
    return;
  }

  console.error(`[Telegraf] Error for ${ctx.updateType}:`, err);
});

/**
 * Builds the main inline menu for regular users.
 *
 * @returns Telegram inline keyboard.
 */
export function getMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👤 Мой профиль", "menu_profile")],
    [Markup.button.callback("🛡️ Мой VPN", "menu_vpn")],
    [
      Markup.button.callback("💳 Пополнить баланс", "menu_topup"),
      Markup.button.callback("💎 Тарифы", "menu_tariffs"),
    ],
    [
      Markup.button.callback("🎃 Промокод", "menu_promo"),
      Markup.button.callback("🤝 Рефералы", "menu_referral"),
    ],
    [Markup.button.callback("💬 Поддержка", "menu_support")],
  ]);
}
