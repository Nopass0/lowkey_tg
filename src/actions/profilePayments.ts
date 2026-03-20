import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { handleMenuProfile as handleLegacyMenuProfile } from "./menus";
import { createSitePaymentLink, createSiteSessionLink, buildBillingPath } from "../utils/siteLinks";
import { editOrReply } from "../utils/telegram";

export async function handleMenuProfileWithPayments(ctx: Context) {
  await handleLegacyMenuProfile(ctx);

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true, paymentMethods: true },
  });
  if (!user) return;

  const defaultCard =
    user.paymentMethods.find((item) => item.isDefault) ?? user.paymentMethods[0] ?? null;
  const linkCardUrl = await createSitePaymentLink({
    userId: user.id,
    action: "link_card",
    fallbackRedirect: buildBillingPath({ tab: "cards", source: "telegram" }),
  });

  await ctx.reply(
    `💳 Платёжные методы\n\n` +
      `Привязанных карт: ${user.paymentMethods.length}\n` +
      `Основная: ${defaultCard ? `${defaultCard.title}` : "нет"}\n` +
      `Автопродление: ${
        user.subscription?.autoRenewal
          ? user.subscription.autoRenewPaymentMethodId
            ? "включено"
            : "включено без карты"
          : "выключено"
      }`,
    {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("💳 Мои карты", "menu_cards")],
        [Markup.button.url("➕ Привязать карту", linkCardUrl)],
      ]).reply_markup,
    },
  );
}

export async function handleToggleAutoRenewalSmart(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true, paymentMethods: true },
  });

  if (!user?.subscription) {
    await ctx.answerCbQuery("Подписка не найдена.");
    return;
  }

  if (user.subscription.autoRenewal) {
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { autoRenewal: false },
    });
    await ctx.answerCbQuery("Автопродление выключено.");
    await handleMenuProfileWithPayments(ctx);
    return;
  }

  const method =
    user.paymentMethods.find(
      (item) =>
        item.allowAutoCharge !== false &&
        item.id === user.subscription?.autoRenewPaymentMethodId,
    ) ??
    user.paymentMethods.find(
      (item) => item.allowAutoCharge !== false && item.isDefault,
    ) ??
    user.paymentMethods.find((item) => item.allowAutoCharge !== false);

  if (!method) {
    const linkCardUrl = await createSitePaymentLink({
      userId: user.id,
      action: "link_card",
      fallbackRedirect: buildBillingPath({ tab: "cards", source: "telegram" }),
    });
    await ctx.answerCbQuery("Сначала привяжите карту.", { show_alert: true });
    await ctx.reply("Для автопродления нужна сохранённая карта:", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url("➕ Привязать карту", linkCardUrl)],
      ]).reply_markup,
    });
    return;
  }

  await prisma.subscription.update({
    where: { userId: user.id },
    data: {
      autoRenewal: true,
      autoRenewPaymentMethodId: method.id,
    },
  });
  await ctx.answerCbQuery("Автопродление включено.");
  await handleMenuProfileWithPayments(ctx);
}

export async function handleMenuCards(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { paymentMethods: true, subscription: true },
  });
  if (!user) return;

  const linkCardUrl = await createSitePaymentLink({
    userId: user.id,
    action: "link_card",
    fallbackRedirect: buildBillingPath({ tab: "cards", source: "telegram" }),
  });

  const rows = user.paymentMethods.map((card) => [
    Markup.button.callback(
      `${card.isDefault ? "⭐ " : ""}${card.title}${card.allowAutoCharge === false ? " · авто выкл" : ""}`,
      `card_view_${card.id}`,
    ),
  ]);

  await editOrReply(
    ctx,
    user.paymentMethods.length
      ? "Выберите карту:"
      : "Привязанных карт пока нет.",
    {
      reply_markup: Markup.inlineKeyboard([
        ...rows,
        [Markup.button.url("➕ Привязать карту", linkCardUrl)],
        [Markup.button.callback("◀️ В профиль", "menu_profile")],
      ]).reply_markup,
    },
  );
}

export async function handleCardAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const data = (ctx.callbackQuery as any)?.data as string;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });
  if (!user) return;

  if (data.startsWith("card_view_")) {
    const cardId = data.slice("card_view_".length);
    const card = await prisma.paymentMethod.findFirst({
      where: { id: cardId, userId: user.id },
    });
    if (!card) {
      await ctx.answerCbQuery("Карта не найдена.");
      return;
    }

    await editOrReply(
      ctx,
      `💳 ${card.title}\n\nАвтосписание: ${
        card.allowAutoCharge === false ? "выключено" : "включено"
      }\nОсновная: ${card.isDefault ? "да" : "нет"}`,
      {
        reply_markup: Markup.inlineKeyboard([
          !card.isDefault
            ? [Markup.button.callback("⭐ Сделать основной", `card_default_${card.id}`)]
            : [Markup.button.callback("⭐ Основная карта", "menu_cards")],
          [
            Markup.button.callback(
              card.allowAutoCharge === false ? "Включить авто" : "Выключить авто",
              `card_auto_${card.id}`,
            ),
          ],
          [Markup.button.callback("🗑 Отвязать", `card_remove_${card.id}`)],
          [Markup.button.callback("◀️ К картам", "menu_cards")],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data.startsWith("card_default_")) {
    const cardId = data.slice("card_default_".length);
    await prisma.$transaction(async (tx) => {
      await tx.paymentMethod.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
      await tx.paymentMethod.update({
        where: { id: cardId },
        data: { isDefault: true },
      });
      await tx.subscription.updateMany({
        where: { userId: user.id, autoRenewal: true },
        data: { autoRenewPaymentMethodId: cardId },
      });
    });
    await ctx.answerCbQuery("Основная карта обновлена.");
    await handleMenuCards(ctx);
    return;
  }

  if (data.startsWith("card_auto_")) {
    const cardId = data.slice("card_auto_".length);
    const card = await prisma.paymentMethod.findFirst({
      where: { id: cardId, userId: user.id },
    });
    if (!card) return;

    await prisma.paymentMethod.update({
      where: { id: card.id },
      data: { allowAutoCharge: !card.allowAutoCharge },
    });
    if (card.allowAutoCharge && user.subscription?.autoRenewPaymentMethodId === card.id) {
      await prisma.subscription.update({
        where: { userId: user.id },
        data: { autoRenewal: false, autoRenewPaymentMethodId: null },
      });
    }
    await ctx.answerCbQuery("Настройка карты обновлена.");
    await handleMenuCards(ctx);
    return;
  }

  if (data.startsWith("card_remove_")) {
    const cardId = data.slice("card_remove_".length);
    await prisma.$transaction(async (tx) => {
      await tx.paymentMethod.deleteMany({
        where: { id: cardId, userId: user.id },
      });
      if (user.subscription?.autoRenewPaymentMethodId === cardId) {
        await tx.subscription.update({
          where: { userId: user.id },
          data: { autoRenewal: false, autoRenewPaymentMethodId: null },
        });
      }
    });
    await ctx.answerCbQuery("Карта отвязана.");
    await handleMenuCards(ctx);
  }
}

