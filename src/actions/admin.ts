import type { User } from "@prisma/client";
import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { PLANS } from "../utils/plans";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

export async function handleAdminMenu(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const usersCount = await prisma.user.count();
  const ticketsCount = await prisma.supportTicket.count({
    where: { status: "open" },
  });
  const withdrawalsCount = await prisma.withdrawal.count({
    where: { status: "pending" },
  });

  const text =
    `🛠 **Админ-панель**\n\n` +
    `👤 Пользователей: **${usersCount}**\n` +
    `💬 Тикетов: **${ticketsCount}**\n` +
    `💸 Выплат: **${withdrawalsCount}**\n\n` +
    `Выберите категорию управления:`;

  const kb = [
    [
      Markup.button.callback("👤 Пользователи", "admin_users_0"),
      Markup.button.callback("🎁 Промокоды", "admin_promos"),
    ],
    [
      Markup.button.callback("💬 Поддержка", "admin_tickets"),
      Markup.button.callback("💸 Выплаты", "admin_withdrawals"),
    ],
    [Markup.button.callback("📢 Рассылка", "admin_broadcast")],
    [Markup.button.callback("◀️ Главное меню", "menu_main")],
  ];

  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(kb),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(kb),
      });
    }
  } catch (e: any) {
    if (e.description?.includes("message is not modified")) return;
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(kb),
    });
  }
}

export async function handleAdminUsers(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const page = parseInt((ctx.callbackQuery as any).data.split("_")[2]) || 0;
  const pageSize = 10;

  const users = await prisma.user.findMany({
    skip: page * pageSize,
    take: pageSize,
    orderBy: { joinedAt: "desc" },
  });

  const total = await prisma.user.count();
  const totalPages = Math.ceil(total / pageSize);

  let text = `👤 **Список пользователей** (Стр. ${page + 1}/${totalPages})\n\n`;
  const kb = [];

  for (const u of users) {
    text += `• \`${u.login}\` - ${u.balance} ₽\n`;
    kb.push([
      Markup.button.callback(`👤 ${u.login}`, `admin_user_view_${u.id}`),
    ]);
  }

  const nav = [];
  if (page > 0)
    nav.push(Markup.button.callback("⬅️ Пред.", `admin_users_${page - 1}`));
  nav.push(Markup.button.callback("🔍 Поиск", "admin_user_search"));
  if ((page + 1) * pageSize < total)
    nav.push(Markup.button.callback("След. ➡️", `admin_users_${page + 1}`));

  kb.push(nav);
  kb.push([Markup.button.callback("◀️ Назад", "menu_admin")]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb),
  });
}

export async function handleAdminUserView(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const userId = (ctx.callbackQuery as any).data.split("_")[3];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  if (!user) return ctx.answerCbQuery("❌ Пользователь не найден.");

  const subText = user.subscription
    ? `${user.subscription.planName} (до ${user.subscription.activeUntil.toLocaleDateString("ru-RU")})`
    : "Нет активной подписки";

  const text =
    `👤 **Инфо о пользователе**\n\n` +
    `ID: \`${user.id}\`\n` +
    `Логин: \`${user.login}\`\n` +
    `Баланс: **${user.balance} ₽**\n` +
    `Подписка: ${subText}\n` +
    `Реферал. баланс: ${user.referralBalance} ₽\n` +
    `Дата регистрации: ${user.joinedAt.toLocaleDateString("ru-RU")}\n\n` +
    `Выберите действие:`;

  const kb = [
    [
      Markup.button.callback(
        "💰 Изменить баланс",
        `admin_user_balance_${user.id}`,
      ),
      Markup.button.callback(
        "⏳ Добавить подписку",
        `admin_user_sub_${user.id}`,
      ),
    ],
    [
      Markup.button.callback(
        user.isBanned ? "✅ Разбанить" : "🚫 Забанить",
        `admin_user_toggle_ban_${user.id}`,
      ),
    ],
    [Markup.button.callback("◀️ Назад к списку", "admin_users_0")],
  ];

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb),
  });
}

export async function handleAdminUserAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const data = (ctx.callbackQuery as any).data;

  if (data === "admin_user_search") {
    await prisma.user.update({
      where: { telegramId: BigInt(telegramId) },
      data: { botState: "admin_search_user" },
    });
    return ctx.reply("🔍 Введите логин пользователя для поиска:");
  }

  if (data.startsWith("admin_user_balance_")) {
    const userId = data.split("_")[3];
    await prisma.user.update({
      where: { telegramId: BigInt(telegramId) },
      data: { botState: `admin_edit_balance:${userId}` },
    });
    return ctx.reply("💰 Введите новую сумму баланса в ₽ (число):");
  }

  if (data.startsWith("admin_user_toggle_ban_")) {
    const userId = data.split("_")[4];
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return ctx.answerCbQuery("❌ Ошибка");

    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: !user.isBanned },
    });

    return handleAdminUserView(ctx);
  }

  if (data.startsWith("admin_user_sub_")) {
    const userId = data.split("_")[3];
    const kb = [
      ...PLANS.map((plan) => [
        Markup.button.callback(
          `➕ ${plan.name}`,
          `admin_add_sub_${userId}_${plan.id}`,
        ),
      ]),
      [Markup.button.callback("◀️ Назад", `admin_user_view_${userId}`)],
    ];
    return ctx.editMessageText(
      "Выберите тарифный план для добавления (на 30 дней):",
      Markup.inlineKeyboard(kb),
    );
  }

  if (data.startsWith("admin_add_sub_")) {
    const parts = data.split("_");
    const userId = parts[3];
    const planId = parts[4];
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) return ctx.answerCbQuery("❌ План не найден");

    const activeUntil = new Date();
    activeUntil.setDate(activeUntil.getDate() + 30);

    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId: plan.id,
        planName: plan.name,
        activeUntil,
        autoRenewal: true,
      },
      update: {
        planId: plan.id,
        planName: plan.name,
        activeUntil,
      },
    });

    await ctx.answerCbQuery(`✅ Подписка ${plan.name} добавлена`);
    return handleAdminUserView(ctx);
  }
}

// ─────────────────────────────────────────────
// ADMIN: PROMO CODES
// ─────────────────────────────────────────────

export async function handleAdminPromos(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const promos = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  let text = "🎁 **Управление промокодами**\n\n";
  const kb = [];

  for (const p of promos) {
    text += `• \`${p.code}\` (Лимит: ${p.maxActivations ?? "∞"})\n`;
    kb.push([
      Markup.button.callback(`❌ Удалить ${p.code}`, `admin_promo_del_${p.id}`),
    ]);
  }

  kb.push([
    Markup.button.callback("➕ Создать промокод", "admin_promo_create"),
  ]);
  kb.push([Markup.button.callback("◀️ Назад", "menu_admin")]);

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb),
  });
}

export async function handleAdminPromoAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const data = (ctx.callbackQuery as any).data;

  if (data === "admin_promo_create") {
    return ctx.reply(
      "Введите новый промокод в формате:\n`/create_promo <rate_0.XX> <CODE> <limit>`\n\nПример:\n`/create_promo 0.3 NOPASS30 100`",
      { parse_mode: "Markdown" },
    );
  }

  if (data.startsWith("admin_promo_del_")) {
    const id = data.split("_")[3];
    await prisma.promoCode.delete({ where: { id } });
    await ctx.answerCbQuery("✅ Промокод удален");
    return handleAdminPromos(ctx);
  }
}

// ─────────────────────────────────────────────
// ADMIN: SUPPORT TICKETS
// ─────────────────────────────────────────────

export async function handleAdminTickets(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const tickets = await prisma.supportTicket.findMany({
    where: { status: "open" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  let text = `💬 **Открытые тикеты** (${tickets.length})\n\n`;
  const kb = [];

  if (tickets.length === 0) text += "Нет новых обращений.";

  for (const t of tickets) {
    text += `• [${t.user.login}]: ${t.message.slice(0, 50)}...\n`;
    kb.push([
      Markup.button.callback(
        `💬 Ответить ${t.user.login}`,
        `admin_ticket_view_${t.id}`,
      ),
    ]);
  }

  kb.push([Markup.button.callback("◀️ Назад", "menu_admin")]);
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb),
  });
}

export async function handleAdminTicketAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const data = (ctx.callbackQuery as any).data;

  if (data.startsWith("admin_ticket_view_")) {
    const id = data.split("_")[3];
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!ticket) return ctx.answerCbQuery("❌ Не найден");

    await prisma.user.update({
      where: { telegramId: BigInt(telegramId) },
      data: { botState: `admin_reply_ticket:${ticket.id}` },
    });

    return ctx.reply(
      `💬 **Тикет от ${ticket.user.login}**\n\nВопрос: ${ticket.message}\n\nВведите ответ для пользователя:`,
      { parse_mode: "Markdown" },
    );
  }
}

// ─────────────────────────────────────────────
// ADMIN: WITHDRAWALS
// ─────────────────────────────────────────────

export async function handleAdminWithdrawals(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const list = await prisma.withdrawal.findMany({
    where: { status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  let text = `💸 **Заявки на выплату** (${list.length})\n\n`;
  const kb = [];

  for (const w of list) {
    text += `• ${w.user.login}: **${w.amount} ₽**\n   ${w.target} (${w.bank})\n\n`;
    kb.push([
      Markup.button.callback(
        `✅ Одобрить ${w.amount}`,
        `admin_wd_approve_${w.id}`,
      ),
      Markup.button.callback(`❌ Отклонить`, `admin_wd_reject_${w.id}`),
    ]);
  }

  kb.push([Markup.button.callback("◀️ Назад", "menu_admin")]);
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb),
  });
}

export async function handleAdminWithdrawalAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const data = (ctx.callbackQuery as any).data;
  const id = data.split("_")[3];
  const w = await prisma.withdrawal.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!w) return ctx.answerCbQuery("❌ Не найдена");

  if (data.startsWith("admin_wd_approve_")) {
    await prisma.withdrawal.update({
      where: { id },
      data: { status: "approved", processedAt: new Date() },
    });
    await ctx.answerCbQuery("✅ Одобрено");
    try {
      await bot.telegram.sendMessage(
        Number(w.user.telegramId),
        `✅ Ваша заявка на вывод ${w.amount} ₽ одобрена!`,
      );
    } catch {}
  } else if (data.startsWith("admin_wd_reject_")) {
    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id },
        data: { status: "rejected", processedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: w.userId },
        data: { referralBalance: { increment: w.amount } },
      }),
    ]);
    await ctx.answerCbQuery("❌ Отклонено");
    try {
      await bot.telegram.sendMessage(
        Number(w.user.telegramId),
        `❌ Ваша заявка на вывод ${w.amount} ₽ отклонена, средства возвращены на реф. баланс.`,
      );
    } catch {}
  }

  return handleAdminWithdrawals(ctx);
}

// ─────────────────────────────────────────────
// ADMIN: BROADCAST
// ─────────────────────────────────────────────

export async function handleAdminBroadcast(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  await prisma.user.update({
    where: { telegramId: BigInt(telegramId) },
    data: { botState: "admin_broadcast" },
  });

  return ctx.reply(
    "📢 Введите сообщение для рассылки всем пользователям (поддерживается Markdown):",
  );
}

import { bot } from "../utils/bot";
