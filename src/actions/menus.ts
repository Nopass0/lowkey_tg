import { Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { bot, getMainMenu } from "../utils/bot";
import { PLANS, PERIOD_LABELS, PERIOD_DAYS } from "../utils/plans";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

export async function handleMenuMain(ctx: Context) {
  const telegramId = ctx.from?.id;
  let kb = getMainMenu().reply_markup.inline_keyboard;
  const isAdmin =
    telegramId &&
    telegramId.toString() === process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (isAdmin) {
    kb = [...kb, [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }]];
  }

  await ctx.editMessageText("Выберите действие в меню:", {
    reply_markup: { inline_keyboard: kb },
  });
}

export async function handleMenuProfile(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });

  if (!user) return ctx.reply("❌ Аккаунт не найден.");

  let subText = "Нет активной подписки ❌";
  if (user.subscription) {
    if (user.subscription.isLifetime) {
      subText = `Пожизненная (План: ${user.subscription.planName}) 🔥`;
    } else if (user.subscription.activeUntil > new Date()) {
      subText = `До ${user.subscription.activeUntil.toLocaleDateString("ru-RU")} (План: ${user.subscription.planName}) ✅`;
    } else {
      subText = `Истекла ${user.subscription.activeUntil.toLocaleDateString("ru-RU")} ❌`;
    }
  }

  const isAdmin = telegramId.toString() === ADMIN_ID;
  const adminBadge = isAdmin ? "\n⭐ **Администратор** 🛠\n" : "";

  const text =
    `👤 **Ваш профиль**\n${adminBadge}\n` +
    `Логин: \`${user.login}\`\n` +
    `Баланс: **${user.balance} ₽**\n\n` +
    `Подписка: ${subText}`;

  const autoRenewalText = user.subscription?.autoRenewal
    ? "✅ Включено"
    : "❌ Выключено";
  const kb = [[{ text: "💳 Пополнить баланс", callback_data: "menu_topup" }]];

  if (user.subscription && !user.subscription.isLifetime) {
    kb.push([
      {
        text: `🔄 Автопродление: ${autoRenewalText}`,
        callback_data: "toggle_auto_renewal",
      },
    ]);
  }

  if (isAdmin) {
    kb.push([{ text: "🛠 Админ-панель", callback_data: "menu_admin" }]);
  }

  kb.push([{ text: "🚪 Выйти из аккаунта", callback_data: "logout" }]);
  kb.push([{ text: "◀️ Назад в меню", callback_data: "menu_main" }]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: kb,
    },
  });
}

export async function handleToggleAutoRenewal(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });

  if (!user || !user.subscription)
    return ctx.answerCbQuery("❌ Подписка не найдена.");

  await prisma.subscription.update({
    where: { userId: user.id },
    data: { autoRenewal: !user.subscription.autoRenewal },
  });

  await ctx.answerCbQuery(
    `✅ Автопродление ${!user.subscription.autoRenewal ? "включено" : "выключено"}`,
  );
  return handleMenuProfile(ctx);
}

export async function handleLogout(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) return ctx.answerCbQuery("❌ Аккаунт не найден.");

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramId: null },
  });

  await ctx.answerCbQuery("✅ Вы вышли из аккаунта.");
  // We need to use ctx.reply instead of editMessage because the menu main will check telegramId and fail
  return ctx.reply(
    "Вы вышли из аккаунта. Пришлите логин для входа или регистрации.",
  );
}

export async function handleMenuVpn(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });

  if (
    !user ||
    !user.subscription ||
    (user.subscription.activeUntil < new Date() &&
      !user.subscription.isLifetime)
  ) {
    return ctx.editMessageText(
      "❌ У вас нет активной подписки. Оформите ее в разделе 💳 Тарифы.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
          ],
        },
      },
    );
  }

  const servers = await prisma.vpnServer.findMany({
    where: { status: "online" },
  });
  if (servers.length === 0) {
    return ctx.editMessageText("❌ Нет доступных серверов :(", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
        ],
      },
    });
  }

  const server = servers[Math.floor(Math.random() * servers.length)]!;
  let instructions =
    `🛡️ **Ваш VPN**\n\nВаш персональный сервер: IP ${server.ip} (${server.location})\n` +
    `Протоколы: ${server.supportedProtocols.join(", ")}\n\n`;

  if (
    server.connectLinkTemplate &&
    server.connectLinkTemplate.includes("vless://")
  ) {
    const link = server.connectLinkTemplate
      .replace("{uuid}", user.id)
      .replace("{ip}", server.ip);
    instructions += `🔗 **Ваша ссылка:**\n\`\`\`text\n${link}\n\`\`\`\n\n`;
  }

  instructions += `Нажмите на кнопку ниже, чтобы увидеть инструкцию по установке для вашего устройства. 👇`;

  try {
    await ctx.editMessageText(instructions, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📖 Инструкция по подключению",
              callback_data: "how_to_connect",
            },
          ],
          [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
        ],
      },
    });
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) throw err;
  }
}

export async function handleMenuTariffs(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  let text = `💳 **Тарифы Lowkey VPN**\n\nВыберите подходящий вам тарифный план:\n\nВаш баланс: **${user.balance} ₽**\n`;

  const buttons: any[] = [];
  PLANS.forEach((plan) => {
    // Show base monthly price as reference
    text += `🔹 **${plan.name}**\n${plan.features.slice(0, 2).join(", ")}...\n\n`;
    buttons.push([
      {
        text: `💎 ${plan.name} (от ${plan.prices.yearly}₽/мес)`,
        callback_data: `plan_view_${plan.id}`,
      },
    ]);
  });

  buttons.push([{ text: "◀️ Назад в меню", callback_data: "menu_main" }]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

export async function handleMenuTariffPeriods(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  // @ts-ignore
  const planId = ctx.match[1];
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return ctx.answerCbQuery("❌ Тариф не найден.");

  let discountText = "";
  let discountMult = 1;
  let discountFixed = 0;

  if (user.pendingDiscountPct > 0) {
    discountMult = (100 - user.pendingDiscountPct) / 100;
    discountText = `\n🎁 **Активна скидка ${user.pendingDiscountPct}%!**\n`;
  } else if (user.pendingDiscountFixed > 0) {
    discountFixed = user.pendingDiscountFixed;
    discountText = `\n🎁 **Активна скидка ${user.pendingDiscountFixed} ₽!**\n`;
  }

  let text = `💎 **Тариф ${plan.name}**\n\n`;
  plan.features.forEach((f) => (text += `✅ ${f}\n`));
  text += `\nВыберите период оплаты:${discountText}\nВаш баланс: **${user.balance} ₽**`;

  const buttons: any[] = [];
  Object.entries(plan.prices).forEach(([period, pricePerMonth]) => {
    const days = PERIOD_DAYS[period];
    if (days === undefined) return;

    const months = days / 30;
    const baseTotal = pricePerMonth * months;
    const finalPrice = Math.max(
      1,
      Math.round((baseTotal * discountMult - discountFixed) * 100) / 100,
    );

    const label = PERIOD_LABELS[period] || period;
    buttons.push([
      {
        text: `📅 ${label} — ${finalPrice} ₽ (${pricePerMonth} ₽/мес)`,
        callback_data: `buy_${plan.id}_${period}`,
      },
    ]);
  });

  buttons.push([
    { text: "◀️ К списку тарифов", callback_data: "menu_tariffs" },
  ]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

export async function handleMenuPromo(ctx: Context) {
  await ctx.editMessageText(
    "🎁 **Промокоды**\n\nЧтобы активировать промокод, отправьте мне сообщение в формате:\n`/promo ВАШ_КОД`",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
        ],
      },
    },
  );
}

export async function handleMenuReferral(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  const botInfo = await bot.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=${user.referralCode}`;

  const ratePct = (user.referralRate * 100).toFixed(0);
  const referralsCount = await prisma.user.count({
    where: { referredById: user.id },
  });

  await ctx.editMessageText(
    `🤝 **Партнерская программа**\n\n` +
      `Приглашайте друзей и получайте ${ratePct}% от всех их пополнений!\n\n` +
      `👥 Приведено рефералов: **${referralsCount}**\n` +
      `💰 Ваш реферальный баланс: **${user.referralBalance} ₽**\n\n` +
      `Ваша персональная ссылка:\n\`${link}\``,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💸 Вывести средства", callback_data: "menu_withdraw" }],
          [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
        ],
      },
    },
  );
}

export async function handleMenuSupport(ctx: Context) {
  await ctx.editMessageText(
    "💬 **Поддержка**\n\nЧтобы создать тикет, отправьте мне сообщение в формате:\n`/support Опишите вашу проблему подробно`",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
        ],
      },
    },
  );
}

export async function handleMenuTopup(ctx: Context) {
  await ctx.editMessageText(
    "💳 Чтобы пополнить баланс, отправьте мне сумму пополнения (от 100 до 100000 ₽) одним числом. 👇",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "◀️ Назад в меню", callback_data: "menu_main" }],
        ],
      },
    },
  );
}

export async function handleMenuWithdraw(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  if (user.referralBalance < 2000) {
    return ctx.answerCbQuery("❌ Минимальная сумма для вывода: 2000 ₽", {
      show_alert: true,
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { botState: "withdraw_1" },
  });

  await ctx.editMessageText(
    `💸 **Вывод средств (${user.referralBalance} ₽)**\n\n` +
      `Шаг 1/3: Введите номер вашей карты или телефона для перевода:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "menu_referral" }],
        ],
      },
    },
  );
}

import { handleAdminMenu } from "./admin";

export { handleAdminMenu };
