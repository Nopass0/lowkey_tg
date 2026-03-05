import { Telegraf, Markup } from "telegraf";
import { prisma } from "../utils/prisma";

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

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
