import { type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { buildBillingPath, createSiteSessionLink } from "../utils/siteLinks";
import { handleTextMessage as handleLegacyTextMessage } from "./textHandler";

export async function handleTextMessageWithSiteBilling(ctx: Context) {
  if (!ctx.message || !("text" in ctx.message)) {
    return handleLegacyTextMessage(ctx);
  }

  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return handleLegacyTextMessage(ctx);
  }

  const rawText = ctx.message.text.trim();
  const amountToTopup = Number(rawText);
  const isTopupAmount =
    !Number.isNaN(amountToTopup) &&
    amountToTopup >= 100 &&
    amountToTopup <= 100000;

  if (!isTopupAmount) {
    return handleLegacyTextMessage(ctx);
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { id: true },
  });
  if (!user) {
    return handleLegacyTextMessage(ctx);
  }

  const billingUrl = await createSiteSessionLink(
    user.id,
    buildBillingPath({
      intent: "topup",
      amount: amountToTopup,
      tab: "plans",
      source: "telegram",
    }),
  );

  await ctx.reply(`Сумма к оплате: ${amountToTopup} ₽`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔗 Открыть оплату на сайте", url: billingUrl }],
      ],
    },
  });
}

