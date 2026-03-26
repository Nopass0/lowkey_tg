import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { editOrReply } from "../utils/telegram";
import { PERIOD_DAYS, PERIOD_LABELS, getPlanMonthlyPrice } from "../utils/plans";
import { calculateDiscountedPrice } from "../utils/subscriptionPurchase";
import { createSitePaymentLink } from "../utils/siteLinks";

function formatPromoDuration(count?: number | null, unit?: string | null) {
  const safeCount = count && count > 0 ? count : 1;
  if (unit === "day") return safeCount === 1 ? "1 день" : `${safeCount} дн.`;
  if (unit === "week") return safeCount === 1 ? "1 неделю" : `${safeCount} нед.`;
  return safeCount === 1 ? "1 месяц" : `${safeCount} мес.`;
}

export async function handleMenuTariffsWithPromo(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const [user, plans] = await Promise.all([
    prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } }),
    prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      include: { prices: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  if (!user) return;

  const mapped = plans.map((plan) => ({
    id: plan.slug,
    name: plan.name,
    features: plan.features,
    isPopular: plan.isPopular,
    promoActive: plan.promoActive,
    promoPrice: plan.promoPrice,
    promoDurationCount: plan.promoDurationCount,
    promoDurationUnit: plan.promoDurationUnit,
    prices: Object.fromEntries(plan.prices.map((item: any) => [item.period, item.price])),
  }));

  const buttons = mapped.map((plan) => [
    Markup.button.callback(
      `${plan.promoActive && plan.promoPrice != null ? `🔥 ${plan.name} от ${plan.promoPrice} ₽` : `💎 ${plan.name} от ${Math.round(getPlanMonthlyPrice(plan as any))} ₽/мес`}`,
      `plan_view_${plan.id}`,
    ),
  ]);

  buttons.push([Markup.button.callback("💳 Пополнить баланс", "menu_topup")]);
  buttons.push([Markup.button.callback("◀️ Назад", "menu_main")]);

  await editOrReply(
    ctx,
    `💎 *Тарифы Lowkey*\n\nВаш баланс: *${user.balance} ₽*\n\n` +
      mapped
        .map(
          (plan) =>
            `• *${plan.name}*${plan.promoActive && plan.promoPrice != null ? ` — акция ${plan.promoPrice} ₽ на ${formatPromoDuration(plan.promoDurationCount, plan.promoDurationUnit)}` : ""}`,
        )
        .join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

export async function handleMenuTariffPeriodsWithPromo(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  const planId = (ctx as any).match?.[1];
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { slug: planId },
    include: { prices: true },
  });
  if (!plan) {
    await ctx.answerCbQuery("Тариф не найден.");
    return;
  }

  const priceMap = Object.fromEntries(plan.prices.map((item: any) => [item.period, item.price]));
  const buttons = Object.entries(priceMap)
    .filter(([period]) => period in PERIOD_DAYS && period in PERIOD_LABELS)
    .map(([period, monthlyPrice]) => {
      const days = PERIOD_DAYS[period];
      if (!days) {
        return null;
      }
      const discounted = calculateDiscountedPrice(
        monthlyPrice * (days / 30),
        user.pendingDiscountFixed,
        user.pendingDiscountPct,
      );

      const title =
        plan.promoActive && plan.promoPrice != null && period === "monthly"
          ? `${PERIOD_LABELS[period]} · ${discounted} ₽ · акция ${plan.promoPrice} ₽`
          : `${PERIOD_LABELS[period]} · ${discounted} ₽`;

      return [Markup.button.callback(title, `buy_${plan.slug}_${period}`)];
    })
    .filter((item): item is ReturnType<typeof Markup.button.callback>[] => Boolean(item));

  if (plan.promoActive && plan.promoPrice != null) {
    buttons.push([
      Markup.button.callback(
        `🔥 Оформить за ${plan.promoPrice} ₽`,
        `buypromo_${plan.slug}`,
      ),
    ]);
  }

  buttons.push([Markup.button.callback("◀️ К тарифам", "menu_tariffs")]);

  const promoText =
    plan.promoActive && plan.promoPrice != null
      ? `\n\n🔥 Акция: ${plan.promoPrice} ₽ на ${formatPromoDuration(plan.promoDurationCount, plan.promoDurationUnit)}, далее ${priceMap.monthly ?? 0} ₽/мес`
      : "";
  const featuresText = (plan.features as any[]).map((item) => `• ${item}`).join("\n");

  await editOrReply(
    ctx,
    `💎 *${plan.name}*\n\n${featuresText}${promoText}\n\nБаланс: *${user.balance} ₽*`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

export async function handleBuyPromoPlan(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const planId = (ctx as any).match?.[1];
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user || !planId) return;

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { slug: planId },
    select: {
      slug: true,
      name: true,
      promoActive: true,
      promoPrice: true,
      promoDurationCount: true,
      promoDurationUnit: true,
      prices: { where: { period: "monthly" }, select: { price: true } },
    },
  });
  if (!plan || !plan.promoActive || plan.promoPrice == null) {
    await ctx.answerCbQuery("Акция недоступна.", { show_alert: true });
    return;
  }

  const promoUrl = await createSitePaymentLink({
    userId: user.id,
    action: "promo_subscribe",
    plan: plan.slug,
    fallbackRedirect: "/me/billing?subscribed=1",
  });

  await ctx.answerCbQuery("Платёж создан.", { show_alert: false });
  await ctx.reply(
    `🔥 Акция по тарифу *${plan.name}*\n\n` +
      `Цена: *${plan.promoPrice} ₽*\n` +
      `Срок: *${formatPromoDuration(plan.promoDurationCount, plan.promoDurationUnit)}*\n` +
      `Далее: *${plan.prices[0]?.price ?? 0} ₽/мес*`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url(`Оформить за ${plan.promoPrice} ₽`, promoUrl)],
        [Markup.button.callback("◀️ К тарифам", "menu_tariffs")],
      ]).reply_markup,
    },
  );
}
