import { Context } from "telegraf";
import { prisma } from "../utils/prisma";

export async function handleCreateReferralPromo(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== process.env.ADMIN_TG_ID) return;

  const text = (ctx.message as any).text;
  const parts = text.split(" ");

  if (parts.length < 4) {
    return ctx.reply(
      "🤖 **Формат:**\n `/create_promo <rate_0.XX> <CODE> <max_uses>`\n\nПример: `/create_promo 0.35 VIP35 100` (Установит 35% реферальных начислений)",
    );
  }

  const rate = parseFloat(parts[1]);
  const code = parts[2].toUpperCase();
  const maxUses = parseInt(parts[3]);

  if (isNaN(rate) || isNaN(maxUses)) {
    return ctx.reply(
      "❌ Ошибка: процент или количество использований не являются числами.",
    );
  }

  try {
    await prisma.promoCode.create({
      data: {
        code,
        conditions: [],
        effects: [{ key: "set_referral_rate", value: rate.toString() }],
        maxActivations: maxUses,
      },
    });

    return ctx.reply(
      `✅ Промокод **${code}** успешно создан!\n\nЭффект: Реферальный процент = **${rate * 100}%**\nЛимит: ${maxUses} активаций.`,
    );
  } catch (err: any) {
    return ctx.reply(`❌ Ошибка при создании промокода: ${err.message}`);
  }
}
