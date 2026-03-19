import { Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { PERIOD_LABELS, getPlanById } from "../utils/plans";
import { buildBillingPath, createSiteSessionLink } from "../utils/siteLinks";

export async function handleBuyPlan(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // @ts-ignore
  const planId = ctx.match[1];
  // @ts-ignore
  const period = ctx.match[2];

  if (!planId || !period) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  const plan = await getPlanById(planId);
  if (!plan) {
    return ctx.answerCbQuery("Тариф не найден или больше недоступен.", {
      show_alert: true,
    });
  }

  const periodLabel = PERIOD_LABELS[period];
  if (!periodLabel) {
    return ctx.answerCbQuery("Неверный период оплаты.", {
      show_alert: true,
    });
  }

  const billingUrl = await createSiteSessionLink(
    user.id,
    buildBillingPath({
      intent: "subscribe",
      plan: planId,
      period,
      tab: "plans",
      source: "telegram",
    }),
  );

  await ctx.answerCbQuery("Открываю оплату на сайте.", {
    show_alert: false,
  });

  await ctx.editMessageText(
    `Покупка тарифа **${plan.name}** на **${periodLabel}** перенесена на сайт.\n\n` +
      `На сайте оплата идёт через YooKassa с привязкой карты и автосписанием. ` +
      `Если баланса уже хватает, сайт всё равно попросит один раз привязать карту для автопродления.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗 Открыть оплату на сайте", url: billingUrl }],
          [{ text: "◀️ К тарифам", callback_data: "menu_tariffs" }],
        ],
      },
    },
  );
}

