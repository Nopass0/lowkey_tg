import crypto from "node:crypto";
import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { editOrReply } from "../utils/telegram";
import { PAGINATION, SUPPORT_STATUS } from "../utils/constants";
import { parseTicketMessage } from "../utils/support";
import { describePromoConditions, describePromoEffects, describePromoStats } from "../utils/promo";
import { PLANS } from "../utils/plans";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

/**
 * Checks whether current Telegram user is the configured admin.
 *
 * @param ctx Telegram context.
 * @returns `true` for admin.
 */
function isAdmin(ctx: Context): boolean {
  return Boolean(ctx.from?.id && ctx.from.id.toString() === ADMIN_ID);
}

/**
 * Shows the admin home screen.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminMenu(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const [usersCount, ticketsOpen, withdrawalsPending, promosCount, mailingCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.supportTicket.count({ where: { status: SUPPORT_STATUS.open } }),
      prisma.withdrawal.count({ where: { status: "pending" } }),
      prisma.promoCode.count(),
      prisma.telegram_mailings.count(),
    ]);

  await editOrReply(
    ctx,
    `🛠 *Админ-панель*\n\n` +
      `Пользователи: *${usersCount}*\n` +
      `Открытые тикеты: *${ticketsOpen}*\n` +
      `Заявки на вывод: *${withdrawalsPending}*\n` +
      `Промокоды: *${promosCount}*\n` +
      `Рассылки: *${mailingCount}*`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback("👤 Пользователи", "admin_users_0"),
          Markup.button.callback("🎃 Промокоды", "admin_promos:0"),
        ],
        [
          Markup.button.callback("💬 Тикеты", "admin_tickets:open:0"),
          Markup.button.callback("💸 Выплаты", "admin_withdrawals"),
        ],
        [Markup.button.callback("📢 Рассылки", "admin_broadcasts:0")],
        [Markup.button.callback("◀️ Главное меню", "menu_main")],
      ]).reply_markup,
    },
  );
}

/**
 * Shows paginated users list.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminUsers(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const page = Number((ctx.callbackQuery as any)?.data?.split("_")[2] || "0");
  const users = await prisma.user.findMany({
    skip: page * PAGINATION.users,
    take: PAGINATION.users,
    orderBy: { joinedAt: "desc" },
  });
  const total = await prisma.user.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.users));

  const buttons = users.map((user) => [
    Markup.button.callback(
      `${user.isAdmin ? "⭐ " : ""}${user.login} · ${user.balance} ₽`,
      `admin_user_view_${user.id}`,
    ),
  ]);
  const pager = [];
  if (page > 0) pager.push(Markup.button.callback("⬅️ Назад", `admin_users_${page - 1}`));
  pager.push(Markup.button.callback("🔎 Поиск", "admin_user_search"));
  if (page + 1 < totalPages) {
    pager.push(Markup.button.callback("Вперёд ➡️", `admin_users_${page + 1}`));
  }
  buttons.push(pager);
  buttons.push([Markup.button.callback("◀️ В админку", "menu_admin")]);

  await editOrReply(
    ctx,
    `👤 *Пользователи*\nСтраница ${page + 1}/${totalPages}\n\n` +
      users.map((user) => `• \`${user.login}\` · ${user.balance} ₽`).join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Shows a detailed user profile for admin actions.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminUserView(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const userId = (ctx.callbackQuery as any).data.split("_")[3];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
      _count: { select: { referrals: true } },
    },
  });

  if (!user) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const subscriptionText = user.subscription
    ? `${user.subscription.planName} до ${user.subscription.activeUntil.toLocaleString("ru-RU")}`
    : "Нет активной подписки";

  const keyboard = [
    [
      Markup.button.callback("💰 Баланс", `admin_user_balance_${user.id}`),
      Markup.button.callback("🤝 Реф. баланс", `admin_user_refbalance_${user.id}`),
    ],
    [
      Markup.button.callback("⏱ Выдать подписку", `admin_user_sub_${user.id}`),
      Markup.button.callback(
        user.isBanned ? "✅ Разбанить" : "🚫 Забанить",
        `admin_user_toggle_ban_${user.id}`,
      ),
    ],
    [
      Markup.button.callback(
        `👥 Рефералы (${user._count.referrals})`,
        `admin_user_referrals_${user.id}_0`,
      ),
      Markup.button.callback("📜 Транзакции", `admin_user_transactions_${user.id}_0`),
    ],
    [
      Markup.button.callback(
        "🎫 Recovery-промо",
        `admin_user_gen_recovery_${user.id}`,
      ),
    ],
  ];

  if (user.referredById) {
    keyboard.push([
      Markup.button.callback("◀️ Назад", `admin_user_view_${user.referredById}`),
    ]);
  }

  keyboard.push([Markup.button.callback("◀️ К списку", "admin_users_0")]);

  await editOrReply(
    ctx,
    `👤 *${user.login}*\n\n` +
      `ID: \`${user.id}\`\n` +
      `Баланс: *${user.balance} ₽*\n` +
      `Реферальный баланс: *${user.referralBalance} ₽*\n` +
      `Привел рефералов: *${user._count.referrals}*\n` +
      `Подписка: ${subscriptionText}\n` +
      `Telegram: ${user.telegramId ? "привязан" : "не привязан"}\n` +
      `Статус: ${user.isBanned ? "заблокирован" : "активен"}`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
    },
  );
}

/**
 * Shows paginated referrals list for a specific user.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminUserReferrals(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const match = (ctx as any).match as RegExpExecArray | undefined;
  const userId = match?.[1];
  const page = Number(match?.[2] || "0");
  if (!userId) return;

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, login: true },
  });

  if (!owner) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const [referrals, total] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: userId },
      skip: page * PAGINATION.users,
      take: PAGINATION.users,
      orderBy: { joinedAt: "desc" },
    }),
    prisma.user.count({
      where: { referredById: userId },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.users));
  const buttons = referrals.map((user) => [
    Markup.button.callback(
      `${user.login} · ${user.balance} ₽`,
      `admin_user_view_${user.id}`,
    ),
  ]);

  const pager = [];
  if (page > 0) {
    pager.push(
      Markup.button.callback(
        "⬅️ Назад",
        `admin_user_referrals_${userId}_${page - 1}`,
      ),
    );
  }
  if (page + 1 < totalPages) {
    pager.push(
      Markup.button.callback(
        "Вперёд ➡️",
        `admin_user_referrals_${userId}_${page + 1}`,
      ),
    );
  }
  if (pager.length) {
    buttons.push(pager);
  }

  buttons.push([
    Markup.button.callback("◀️ К пользователю", `admin_user_view_${userId}`),
  ]);

  const listText = referrals.length
    ? referrals
        .map(
          (user) =>
            `• \`${user.login}\` · ${user.balance} ₽ · ${user.joinedAt.toLocaleDateString("ru-RU")}`,
        )
        .join("\n")
    : "Рефералов пока нет.";

  await editOrReply(
    ctx,
    `👥 *Рефералы ${owner.login}*\nСтраница ${page + 1}/${totalPages}\n\n${listText}`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Shows paginated transactions list for a specific user.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminUserTransactions(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const match = (ctx as any).match as RegExpExecArray | undefined;
  const userId = match?.[1];
  const page = Number(match?.[2] || "0");
  if (!userId) return;

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, login: true },
  });

  if (!owner) {
    await ctx.answerCbQuery("Пользователь не найден.");
    return;
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      skip: page * PAGINATION.transactions,
      take: PAGINATION.transactions,
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.count({
      where: { userId },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.transactions));
  const buttons = [];

  const pager = [];
  if (page > 0) {
    pager.push(
      Markup.button.callback(
        "⬅️ Назад",
        `admin_user_transactions_${userId}_${page - 1}`,
      ),
    );
  }
  if (page + 1 < totalPages) {
    pager.push(
      Markup.button.callback(
        "Вперёд ➡️",
        `admin_user_transactions_${userId}_${page + 1}`,
      ),
    );
  }
  if (pager.length) {
    buttons.push(pager);
  }

  buttons.push([
    Markup.button.callback("◀️ К пользователю", `admin_user_view_${userId}`),
  ]);

  const listText = transactions.length
    ? transactions
        .map((item) => {
          const sign = item.amount >= 0 ? "+" : "";
          const direction = item.amount >= 0 ? "зачисление" : "расход";
          return (
            `• ${item.createdAt.toLocaleString("ru-RU")}\n` +
            `\`${sign}${item.amount} ₽\` · ${direction}\n` +
            `${item.title}\n` +
            `Тип: ${item.type}`
          );
        })
        .join("\n\n")
    : "Транзакций пока нет.";

  await editOrReply(
    ctx,
    `📜 *Транзакции ${owner.login}*\nСтраница ${page + 1}/${totalPages}\n\n${listText}`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Handles admin user actions driven by inline buttons.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminUserAction(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = (ctx.callbackQuery as any).data as string;
  const telegramId = BigInt(ctx.from!.id);

  if (data === "admin_user_search") {
    await prisma.user.update({
      where: { telegramId },
      data: { botState: "admin_search_user" },
    });
    await ctx.reply("Введите логин пользователя для поиска.");
    return;
  }

  if (data === "admin_recovery_start") {
    await prisma.user.update({
      where: { telegramId },
      data: { botState: "admin_find_referrer_for_recovery" },
    });
    await ctx.reply("Введите логин пригласившего для recovery-промокода.");
    return;
  }

  if (data.startsWith("admin_user_balance_")) {
    const userId = data.split("_")[3];
    await prisma.user.update({
      where: { telegramId },
      data: { botState: `admin_edit_balance:${userId}` },
    });
    await ctx.reply("Введите новый баланс числом.");
    return;
  }

  if (data.startsWith("admin_user_refbalance_")) {
    const userId = data.split("_")[3];
    await prisma.user.update({
      where: { telegramId },
      data: { botState: `admin_edit_refbalance:${userId}` },
    });
    await ctx.reply("Введите новый реферальный баланс числом.");
    return;
  }

  if (data.startsWith("admin_user_toggle_ban_")) {
    const userId = data.split("_")[4];
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await ctx.answerCbQuery("Пользователь не найден.");
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: !user.isBanned },
    });
    await handleAdminUserView(ctx);
    return;
  }

  if (data.startsWith("admin_user_gen_recovery_")) {
    const userId = data.split("_")[4];
    await prisma.user.update({
      where: { telegramId },
      data: { botState: `admin_gen_recovery_custom:${userId}` },
    });
    await ctx.reply("Введите код recovery-промокода. Он должен начинаться с `RECOVERY_`.", {
      parse_mode: "Markdown",
    });
    return;
  }

  if (data.startsWith("admin_user_sub_")) {
    const userId = data.split("_")[3];
    await editOrReply(ctx, "Выберите тариф для выдачи на 30 дней.", {
      reply_markup: Markup.inlineKeyboard([
        ...PLANS.map((plan) => [
          Markup.button.callback(
            `➕ ${plan.name}`,
            `admin_add_sub_${userId}_${plan.id}`,
          ),
        ]),
        [Markup.button.callback("◀️ Назад", `admin_user_view_${userId}`)],
      ]).reply_markup,
    });
    return;
  }

  if (data.startsWith("admin_add_sub_")) {
    const [, , , userId, planId] = data.split("_");
    if (!userId) {
      await ctx.answerCbQuery("Пользователь не найден.");
      return;
    }
    const plan = PLANS.find((entry) => entry.id === planId);
    if (!plan) {
      await ctx.answerCbQuery("Тариф не найден.");
      return;
    }

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

    await ctx.answerCbQuery("Подписка выдана.");
    await handleAdminUserView(ctx);
  }
}

/**
 * Shows paginated promo list.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminPromos(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = ((ctx.callbackQuery as any)?.data as string) || "admin_promos:0";
  const page = Number(data.split(":")[1] || "0");

  const promos = await prisma.promoCode.findMany({
    include: { activations: true },
    orderBy: { createdAt: "desc" },
    skip: page * PAGINATION.promos,
    take: PAGINATION.promos,
  });
  const total = await prisma.promoCode.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.promos));

  const buttons = promos.map((promo) => [
    Markup.button.callback(
      `🎃 ${promo.code} · ${promo.activations.length}`,
      `admin_promo_view:${promo.id}:${page}`,
    ),
  ]);

  const pager = [];
  if (page > 0) pager.push(Markup.button.callback("⬅️ Назад", `admin_promos:${page - 1}`));
  pager.push(Markup.button.callback("➕ Создать", "admin_promo_create"));
  if (page + 1 < totalPages) {
    pager.push(Markup.button.callback("Вперёд ➡️", `admin_promos:${page + 1}`));
  }
  buttons.push(pager);
  buttons.push([Markup.button.callback("◀️ В админку", "menu_admin")]);

  await editOrReply(
    ctx,
    `🎃 *Промокоды*\nСтраница ${page + 1}/${totalPages}\n\n` +
      (promos.length
        ? promos.map((promo) => `• ${describePromoStats(promo, promo.activations)}`).join("\n")
        : "Промокодов пока нет."),
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Handles promo admin actions such as preview, delete and create entrypoint.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminPromoAction(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = (ctx.callbackQuery as any).data as string;
  const adminTelegramId = BigInt(ctx.from!.id);

  if (data === "admin_promo_create") {
    await prisma.user.update({
      where: { telegramId: adminTelegramId },
      data: { botState: "admin_promo_create_code" },
    });
    await ctx.reply("Введите код нового промокода.");
    return;
  }

  if (data.startsWith("admin_promo_view:")) {
    const [, promoId, pageRaw] = data.split(":");
    const page = Number(pageRaw || "0");
    const promo = await prisma.promoCode.findUnique({
      where: { id: promoId },
      include: {
        activations: {
          orderBy: { activatedAt: "desc" },
          take: 10,
          include: { user: true },
        },
      },
    });

    if (!promo) {
      await ctx.answerCbQuery("Промокод не найден.");
      return;
    }

    const conditions = describePromoConditions(promo);
    const effects = describePromoEffects(promo);
    const stats =
      promo.activations.length > 0
        ? promo.activations
            .map((activation) => {
              return `• ${activation.user.login} · ${activation.activatedAt.toLocaleString("ru-RU")}`;
            })
            .join("\n")
        : "Активаций пока нет.";

    await editOrReply(
      ctx,
      `🎃 *${promo.code}*\n\n` +
        `Условия:\n${conditions.map((line) => `• ${line}`).join("\n")}\n\n` +
        `Эффекты:\n${effects.map((line) => `• ${line}`).join("\n")}\n\n` +
        `Статистика:\n${stats}`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🗑 Удалить", `admin_promo_del:${promo.id}:${page}`)],
          [Markup.button.callback("◀️ К списку", `admin_promos:${page}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data.startsWith("admin_promo_del:")) {
    const [, promoId, pageRaw] = data.split(":");
    await prisma.promoCode.delete({ where: { id: promoId } });
    await ctx.answerCbQuery("Промокод удалён.");
    await handleAdminPromos({
      ...ctx,
      callbackQuery: {
        ...(ctx.callbackQuery as any),
        data: `admin_promos:${pageRaw || "0"}`,
      },
    } as Context);
  }
}

/**
 * Shows paginated ticket list for admin by status.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminTickets(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = ((ctx.callbackQuery as any)?.data as string) || "admin_tickets:open:0";
  const [, statusRaw, pageRaw] = data.split(":");
  const status = statusRaw === "closed" ? "closed" : "open";
  const page = Number(pageRaw || "0");

  const tickets = await prisma.supportTicket.findMany({
    where: { status },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    skip: page * PAGINATION.tickets,
    take: PAGINATION.tickets,
  });
  const total = await prisma.supportTicket.count({ where: { status } });
  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.tickets));

  const buttons = [
    [
      Markup.button.callback("🟢 Открытые", "admin_tickets:open:0"),
      Markup.button.callback("⚪ Закрытые", "admin_tickets:closed:0"),
    ],
    ...tickets.map((ticket) => {
      const parsed = parseTicketMessage(ticket.message);
      return [
        Markup.button.callback(
          `${ticket.user.login} · ${parsed.subject}`,
          `admin_ticket_view:${ticket.id}:${status}:${page}`,
        ),
      ];
    }),
  ];

  const pager = [];
  if (page > 0) pager.push(Markup.button.callback("⬅️ Назад", `admin_tickets:${status}:${page - 1}`));
  if (page + 1 < totalPages) {
    pager.push(Markup.button.callback("Вперёд ➡️", `admin_tickets:${status}:${page + 1}`));
  }
  if (pager.length) buttons.push(pager);
  buttons.push([Markup.button.callback("◀️ В админку", "menu_admin")]);

  const listText =
    tickets.length > 0
      ? tickets
          .map((ticket) => {
            const parsed = parseTicketMessage(ticket.message);
            return `• ${ticket.user.login} · ${ticket.createdAt.toLocaleString("ru-RU")} · ${parsed.subject}`;
          })
          .join("\n")
      : "Тикетов нет.";

  await editOrReply(
    ctx,
    `💬 *Тикеты: ${status === "open" ? "открытые" : "закрытые"}*\nСтраница ${page + 1}/${totalPages}\n\n${listText}`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Handles ticket details, reply entrypoint and status changes.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminTicketAction(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = (ctx.callbackQuery as any).data as string;
  const adminTelegramId = BigInt(ctx.from!.id);

  if (data.startsWith("admin_ticket_view:")) {
    const [, ticketId, status, pageRaw] = data.split(":");
    const page = Number(pageRaw || "0");
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: true },
    });

    if (!ticket) {
      await ctx.answerCbQuery("Тикет не найден.");
      return;
    }

    const parsed = parseTicketMessage(ticket.message);
    await editOrReply(
      ctx,
      `💬 *Тикет*\n\n` +
        `От: *${ticket.user.login}*\n` +
        `Дата: ${ticket.createdAt.toLocaleString("ru-RU")}\n` +
        `Статус: ${ticket.status}\n` +
        `Тема: *${parsed.subject}*\n\n` +
        `${parsed.description}\n\n` +
        `${ticket.reply ? `Последний ответ:\n${ticket.reply}` : "Ответа пока нет."}`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("✍️ Ответить", `admin_ticket_reply:${ticket.id}`)],
          [
            Markup.button.callback(
              ticket.status === SUPPORT_STATUS.closed ? "🔓 Открыть" : "🔒 Закрыть",
              `admin_ticket_toggle:${ticket.id}:${status}:${page}`,
            ),
          ],
          [Markup.button.callback("◀️ К списку", `admin_tickets:${status}:${page}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data.startsWith("admin_ticket_reply:")) {
    const ticketId = data.split(":")[1];
    await prisma.user.update({
      where: { telegramId: adminTelegramId },
      data: { botState: `admin_reply_ticket:${ticketId}` },
    });
    await ctx.reply("Введите ответ пользователю. Перед отправкой будет предпросмотр.");
    return;
  }

  if (data.startsWith("admin_ticket_toggle:")) {
    const [, ticketId, status, pageRaw] = data.split(":");
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      await ctx.answerCbQuery("Тикет не найден.");
      return;
    }

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status:
          ticket.status === SUPPORT_STATUS.closed
            ? SUPPORT_STATUS.open
            : SUPPORT_STATUS.closed,
      },
    });

    await handleAdminTickets({
      ...ctx,
      callbackQuery: {
        ...(ctx.callbackQuery as any),
        data: `admin_tickets:${status}:${pageRaw}`,
      },
    } as Context);
  }
}

/**
 * Shows pending withdrawals.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminWithdrawals(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const withdrawals = await prisma.withdrawal.findMany({
    where: { status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  await editOrReply(
    ctx,
    `💸 *Заявки на вывод*\n\n` +
      (withdrawals.length
        ? withdrawals
            .map(
              (item) =>
                `• ${item.user.login} · ${item.amount} ₽ · ${item.createdAt.toLocaleString("ru-RU")}\n${item.target} (${item.bank})`,
            )
            .join("\n\n")
        : "Нет ожидающих заявок."),
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        ...withdrawals.map((item) => [
          Markup.button.callback("✅ Одобрить", `admin_wd_approve_${item.id}`),
          Markup.button.callback("❌ Отклонить", `admin_wd_reject_${item.id}`),
        ]),
        [Markup.button.callback("◀️ В админку", "menu_admin")],
      ]).reply_markup,
    },
  );
}

/**
 * Approves or rejects a withdrawal request.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminWithdrawalAction(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = (ctx.callbackQuery as any).data as string;
  const withdrawalId = data.split("_")[3];
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: { user: true },
  });

  if (!withdrawal) {
    await ctx.answerCbQuery("Заявка не найдена.");
    return;
  }

  if (data.startsWith("admin_wd_approve_")) {
    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: "approved", processedAt: new Date() },
    });
  } else {
    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: "rejected", processedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: withdrawal.userId },
        data: { referralBalance: { increment: withdrawal.amount } },
      }),
    ]);
  }

  await handleAdminWithdrawals(ctx);
}

/**
 * Shows mailing list and create button.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminBroadcast(ctx: Context) {
  if (!isAdmin(ctx)) return;

  const data = ((ctx.callbackQuery as any)?.data as string) || "admin_broadcasts:0";
  const page = Number(data.split(":")[1] || "0");
  const mailings = await prisma.telegram_mailings.findMany({
    orderBy: { createdAt: "desc" },
    skip: page * PAGINATION.mailings,
    take: PAGINATION.mailings,
  });
  const total = await prisma.telegram_mailings.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.mailings));

  const buttons = [
    [Markup.button.callback("➕ Создать рассылку", "admin_broadcast_create")],
    ...mailings.map((mailing) => [
      Markup.button.callback(
        `${mailing.title} · ${mailing.status}`,
        `admin_broadcast_view:${mailing.id}:${page}`,
      ),
    ]),
  ];

  const pager = [];
  if (page > 0) pager.push(Markup.button.callback("⬅️ Назад", `admin_broadcasts:${page - 1}`));
  if (page + 1 < totalPages) {
    pager.push(Markup.button.callback("Вперёд ➡️", `admin_broadcasts:${page + 1}`));
  }
  if (pager.length) buttons.push(pager);
  buttons.push([Markup.button.callback("◀️ В админку", "menu_admin")]);

  await editOrReply(
    ctx,
    `📢 *Рассылки*\nСтраница ${page + 1}/${totalPages}\n\n` +
      (mailings.length
        ? mailings
            .map(
              (mailing) =>
                `• ${mailing.title} · ${mailing.status} · ${mailing.scheduledAt.toLocaleString("ru-RU")}`,
            )
            .join("\n")
        : "Рассылок пока нет."),
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Creates a single-use recovery promo code for an existing referrer.
 *
 * @param referrerId Referrer user id.
 * @param code Promo code.
 */
export async function createRecoveryPromo(referrerId: string, code: string) {
  await prisma.promoCode.create({
    data: {
      code,
      maxActivations: 1,
      conditions: [],
      effects: [
        { key: "referrer_id", value: referrerId },
        { key: "add_balance", value: "100" },
      ],
    },
  });
}

/**
 * Generates a random promo code suffix.
 *
 * @returns Short uppercase suffix.
 */
export function generatePromoSuffix() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
