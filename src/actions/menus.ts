import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { bot, getMainMenu } from "../utils/bot";
import {
  PERIOD_DAYS,
  PERIOD_LABELS,
  getAvailablePlans,
  getPlanById,
  getPlanMonthlyPrice,
} from "../utils/plans";
import { editOrReply } from "../utils/telegram";
import { PAGINATION } from "../utils/constants";
import { encodeBotState } from "../utils/state";
import { normalizeTicketStatus, parseTicketMessage } from "../utils/support";
import { getEffectiveReferralRate } from "../utils/referrals";
import { calculateDiscountedPrice } from "../utils/subscriptionPurchase";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

type TelegramProxyPlan = {
  isTelegramPlan?: boolean | null;
  telegramProxyEnabled?: boolean | null;
} | null;

type MtprotoSettings = {
  enabled?: boolean | null;
  port?: number | null;
  secret?: string | null;
} | null;

function toMtprotoPublicSecret(value?: string | null) {
  const secret = value?.trim().toLowerCase();
  if (!secret) {
    return null;
  }
  if (/^(dd|ee)[0-9a-f]{32}$/.test(secret)) {
    return secret.slice(2);
  }
  return /^[0-9a-f]{32}$/.test(secret) ? secret : null;
}

function planHasTelegramProxy(plan: TelegramProxyPlan): boolean {
  return Boolean(plan?.isTelegramPlan || plan?.telegramProxyEnabled);
}

function buildVlessLink(
  template: string | null | undefined,
  userId: string,
  serverIp: string,
  serverHost?: string | null,
): string | null {
  if (!template) {
    return null;
  }

  const serverAddress = serverHost || serverIp;
  let link = template
    .replaceAll("{uuid}", userId)
    .replaceAll("{ip}", serverIp)
    .replaceAll("{host}", serverAddress);

  if (link.includes("vless://")) {
    const [baseUrl, tag] = link.split("#");
    let normalized = baseUrl ?? link;
    if (!normalized.includes("type=")) {
      const separator = normalized.includes("?") ? "&" : "?";
      normalized = `${normalized}${separator}type=tcp`;
    }
    if (
      normalized.includes("security=reality") &&
      !normalized.includes("flow=")
    ) {
      normalized = normalized.replace(
        "security=reality",
        "flow=xtls-rprx-vision&security=reality",
      );
    }
    link = `${normalized}${tag ? `#${tag}` : ""}`;
  }

  return link;
}

function buildMtprotoProxyLinks(
  settings: MtprotoSettings,
  serverIp: string,
  serverHost?: string | null,
) {
  const secret = toMtprotoPublicSecret(settings?.secret);
  if (!settings?.enabled || !secret) {
    return null;
  }

  const host = (serverHost || serverIp).trim();
  if (!host) {
    return null;
  }

  const port =
    typeof settings.port === "number" && Number.isFinite(settings.port)
      ? Math.max(1, settings.port)
      : 443;

  const params = new URLSearchParams({
    server: host,
    port: String(port),
    secret,
  });

  return {
    tgLink: `tg://proxy?${params.toString()}`,
    shareLink: `https://t.me/proxy?${params.toString()}`,
  };
}

/**
 * Shows the main inline menu.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuMain(ctx: Context) {
  const telegramId = ctx.from?.id;
  let keyboard = getMainMenu().reply_markup.inline_keyboard;

  if (telegramId && telegramId.toString() === ADMIN_ID) {
    keyboard = [
      ...keyboard,
      [Markup.button.callback("🛠 Админ-панель", "menu_admin")],
    ];
  }

  await editOrReply(ctx, "Выберите действие:", {
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Shows the current user profile.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuProfile(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });

  if (!user) {
    await editOrReply(ctx, "Аккаунт не найден.");
    return;
  }

  let subscriptionText = "Нет активной подписки";
  if (user.subscription) {
    if (user.subscription.isLifetime) {
      subscriptionText = `Пожизненная (${user.subscription.planName})`;
    } else {
      const suffix =
        user.subscription.activeUntil > new Date() ? "активна" : "истекла";
      subscriptionText = `${user.subscription.planName} до ${user.subscription.activeUntil.toLocaleDateString("ru-RU")} (${suffix})`;
    }
  }

  const keyboard = [];
  if (user.subscription && !user.subscription.isLifetime) {
    keyboard.push([
      Markup.button.callback(
        `🔁 Автопродление: ${user.subscription.autoRenewal ? "вкл" : "выкл"}`,
        "toggle_auto_renewal",
      ),
    ]);
  }

  keyboard.push([Markup.button.callback("🚪 Выйти из аккаунта", "logout")]);
  keyboard.push([Markup.button.callback("◀️ Назад", "menu_main")]);

  await editOrReply(
    ctx,
    `👤 *Ваш профиль*\n\nЛогин: \`${user.login}\`\nБаланс: *${user.balance} ₽*\nПодписка: ${subscriptionText}`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
    },
  );
}

/**
 * Toggles subscription auto-renewal for the current user.
 *
 * @param ctx Telegram context.
 */
export async function handleToggleAutoRenewal(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });

  if (!user?.subscription) {
    await ctx.answerCbQuery("Подписка не найдена.");
    return;
  }

  await prisma.subscription.update({
    where: { userId: user.id },
    data: { autoRenewal: !user.subscription.autoRenewal },
  });

  await ctx.answerCbQuery("Настройка обновлена.");
  await handleMenuProfile(ctx);
}

/**
 * Logs the user out from Telegram binding.
 *
 * @param ctx Telegram context.
 */
export async function handleLogout(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) {
    await ctx.answerCbQuery("Аккаунт не найден.");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramId: null, botState: null },
  });

  await ctx.answerCbQuery("Telegram отвязан.");
  await ctx.reply(
    "Вы вышли из аккаунта. Отправьте логин, чтобы войти или зарегистрироваться заново.",
  );
}

/**
 * Shows VPN connection info and setup entrypoint.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuVpn(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { subscription: true },
  });

  if (
    !user?.subscription ||
    (!user.subscription.isLifetime && user.subscription.activeUntil < new Date())
  ) {
    await editOrReply(
      ctx,
      "У вас нет активной подписки. Оформите её в разделе тарифов.",
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("💎 Тарифы", "menu_tariffs")],
          [Markup.button.callback("◀️ Назад", "menu_main")],
        ]).reply_markup,
      },
    );
    return;
  }

  const [servers, currentPlan, mtprotoSettings] = await Promise.all([
    prisma.vpnServer.findMany({
      where: { status: "online" },
      orderBy: { currentLoad: "asc" },
    }),
    prisma.subscriptionPlan.findFirst({
      where: { slug: user.subscription.planId },
    }),
    prisma.mtprotoSettings.findFirst({}),
  ]);

  if (!servers.length) {
    await editOrReply(ctx, "Сейчас нет доступных серверов.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Назад", "menu_main")],
      ]).reply_markup,
    });
    return;
  }

  const server = servers[0];
  if (!server) return;
  const vlessLink = buildVlessLink(
    server.connectLinkTemplate,
    user.id,
    server.ip,
    server.hostname ?? null,
  );
  const mtprotoLinks = planHasTelegramProxy(currentPlan)
    ? buildMtprotoProxyLinks(
        mtprotoSettings,
        server.ip,
        server.hostname ?? null,
      )
    : null;
  const protocols = Array.from(
    new Set([
      ...(Array.isArray(server.supportedProtocols) ? server.supportedProtocols : []),
      ...(mtprotoLinks ? ["mtproto"] : []),
    ]),
  );
  let text =
    `🛡️ *Ваш VPN*\n\nСервер: \`${(server.hostname || server.ip)}:${server.port}\`\n` +
    `Локация: ${server.location}\n` +
    `Протоколы: ${protocols.join(", ")}\n`;

  if (vlessLink) {
    text += `\nСсылка VLESS:\n\`\`\`text\n${vlessLink}\n\`\`\``;
  }

  if (mtprotoLinks) {
    text += `\n\nMTProto proxy:\n\`\`\`text\n${mtprotoLinks.tgLink}\n\`\`\``;
  }

  const keyboard = [
    ...(mtprotoLinks?.tgLink
      ? [[Markup.button.url("Open MTProto", mtprotoLinks.tgLink)]]
      : []),
    [
      Markup.button.callback(
        "📘 Инструкция по подключению",
        "how_to_connect",
      ),
    ],
    [Markup.button.callback("◀️ Назад", "menu_main")],
  ];

  await editOrReply(ctx, text, {
    parse_mode: "Markdown",
    reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
  });
}

/**
 * Shows available tariff plans.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuTariffs(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) return;

  const plans = await getAvailablePlans();

  const buttons = plans.map((plan) => [
    Markup.button.callback(
      `💎 ${plan.name} от ${Math.round(getPlanMonthlyPrice(plan))} ₽/мес`,
      `plan_view_${plan.id}`,
    ),
  ]);

  buttons.push([
    Markup.button.callback("💳 Пополнить баланс", "menu_topup"),
  ]);
  buttons.push([Markup.button.callback("◀️ Назад", "menu_main")]);

  const text =
    `💎 *Тарифы Lowkey*\n\nВаш баланс: *${user.balance} ₽*\n\n` +
    plans
      .map((plan) => `• *${plan.name}*: ${plan.features.slice(0, 2).join(", ")}`)
      .join("\n");

  await editOrReply(ctx, text, {
    parse_mode: "Markdown",
    reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
  });
}

/**
 * Shows period selection for a chosen tariff.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuTariffPeriods(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) return;

  const planId = (ctx as any).match?.[1];
  const plan = await getPlanById(planId);
  if (!plan) {
    await ctx.answerCbQuery("Тариф не найден.");
    return;
  }

  const buttons = Object.entries(plan.prices).flatMap(([period, monthlyPrice]) => {
    const days = PERIOD_DAYS[period];
    if (!days) return [];

    const discounted = calculateDiscountedPrice(
      monthlyPrice * (days / 30),
      user.pendingDiscountFixed,
      user.pendingDiscountPct,
    );

    return [
      [
        Markup.button.callback(
          `📅 ${PERIOD_LABELS[period]} · ${discounted} ₽`,
          `buy_${plan.id}_${period}`,
        ),
      ],
    ];
  });

  buttons.push([Markup.button.callback("◀️ К тарифам", "menu_tariffs")]);

  const discountText =
    user.pendingDiscountPct > 0
      ? `\nАктивна скидка ${user.pendingDiscountPct}%`
      : user.pendingDiscountFixed > 0
        ? `\nАктивна скидка ${user.pendingDiscountFixed} ₽`
        : "";

  await editOrReply(
    ctx,
    `💎 *${plan.name}*\n\n${plan.features.map((item) => `• ${item}`).join("\n")}\n${discountText}\n\nБаланс: *${user.balance} ₽*`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    },
  );
}

/**
 * Starts the promo activation flow. After this button the user can simply send a code.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuPromo(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await prisma.user.update({
    where: { telegramId: BigInt(telegramId) },
    data: { botState: encodeBotState("promo_enter_code") },
  });

  await editOrReply(
    ctx,
    "🎃 *Активация промокода*\n\nВведите промокод одним сообщением. Команда `/promo` больше не обязательна.",
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Назад", "menu_main")],
      ]).reply_markup,
    },
  );
}

/**
 * Shows referral program info.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuReferral(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) return;

  const botInfo = await bot.telegram.getMe();
  const referralsCount = await prisma.user.count({
    where: { referredById: user.id },
  });

  const link = `https://t.me/${botInfo.username}?start=${user.referralCode}`;
  await editOrReply(
    ctx,
    `🤝 *Партнёрская программа*\n\n` +
      `Ставка: *${(getEffectiveReferralRate(user.referralRate) * 100).toFixed(0)}%*\n` +
      `Рефералов: *${referralsCount}*\n` +
      `Реферальный баланс: *${user.referralBalance} ₽*\n\n` +
      `Ссылка:\n\`${link}\``,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("💸 Вывести средства", "menu_withdraw")],
        [Markup.button.callback("◀️ Назад", "menu_main")],
      ]).reply_markup,
    },
  );
}

/**
 * Opens the support menu with ticket creation and history sections.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuSupport(ctx: Context) {
  await editOrReply(
    ctx,
    "💬 *Поддержка*\n\nСоздайте новую заявку или откройте историю обращений.",
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("➕ Создать заявку", "support_create")],
        [
          Markup.button.callback("📂 Открытые", "support_list:open:0"),
          Markup.button.callback("🗃 Закрытые", "support_list:closed:0"),
        ],
        [Markup.button.callback("◀️ Назад", "menu_main")],
      ]).reply_markup,
    },
  );
}

/**
 * Renders paginated support tickets for the current user.
 *
 * @param ctx Telegram context.
 * @param status Requested status.
 * @param page Zero-based page number.
 */
export async function renderUserTicketList(
  ctx: Context,
  status: string,
  page = 0,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) return;

  const normalizedStatus = status === "closed" ? "closed" : "open";
  const skip = page * PAGINATION.tickets;

  const tickets = await prisma.supportTicket.findMany({
    where: { userId: user.id, status: normalizedStatus },
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGINATION.tickets,
  });

  const total = await prisma.supportTicket.count({
    where: { userId: user.id, status: normalizedStatus },
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGINATION.tickets));
  const buttons = tickets.map((ticket) => {
    const parsed = parseTicketMessage(ticket.message);
    return [
      Markup.button.callback(
        `${normalizeTicketStatus(ticket.status) === "open" ? "🟢" : "⚪"} ${parsed.subject}`,
        `support_view:${ticket.id}:${page}:${normalizedStatus}`,
      ),
    ];
  });

  const pager = [];
  if (page > 0) {
    pager.push(
      Markup.button.callback(
        "⬅️ Назад",
        `support_list:${normalizedStatus}:${page - 1}`,
      ),
    );
  }
  if (page + 1 < totalPages) {
    pager.push(
      Markup.button.callback(
        "Вперёд ➡️",
        `support_list:${normalizedStatus}:${page + 1}`,
      ),
    );
  }
  if (pager.length) buttons.push(pager);

  buttons.push([Markup.button.callback("◀️ В поддержку", "menu_support")]);

  const text =
    `💬 *${normalizedStatus === "open" ? "Открытые" : "Закрытые"} заявки*` +
    `\nСтраница ${page + 1}/${totalPages}\n\n` +
    (tickets.length
      ? tickets
          .map((ticket) => {
            const parsed = parseTicketMessage(ticket.message);
            return `• *${parsed.subject}* · ${ticket.createdAt.toLocaleString("ru-RU")}`;
          })
          .join("\n")
      : "Заявок пока нет.");

  await editOrReply(ctx, text, {
    parse_mode: "Markdown",
    reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
  });
}

/**
 * Shows balance top-up instructions.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuTopup(ctx: Context) {
  await editOrReply(
    ctx,
    "💳 Введите сумму пополнения одним сообщением. Допустимый диапазон: от 100 до 100000 ₽.",
    {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Назад", "menu_main")],
      ]).reply_markup,
    },
  );
}

/**
 * Starts the withdrawal flow for referral balance.
 *
 * @param ctx Telegram context.
 */
export async function handleMenuWithdraw(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) return;

  if (user.referralBalance < 2000) {
    await ctx.answerCbQuery("Минимальная сумма вывода: 2000 ₽", {
      show_alert: true,
    });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { botState: "withdraw_1" },
  });

  await editOrReply(
    ctx,
    `💸 *Вывод средств*\n\nДоступно: *${user.referralBalance} ₽*\n\nШаг 1/3. Введите номер карты или телефона для перевода.`,
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("Отмена", "menu_referral")],
      ]).reply_markup,
    },
  );
}
