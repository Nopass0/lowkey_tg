import crypto from "node:crypto";
import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { encodeBotState, decodeBotState } from "../utils/state";
import { editOrReply, escapeHtml } from "../utils/telegram";
import { renderUserTicketList } from "./menus";
import { parseTicketMessage, serializeTicketMessage } from "../utils/support";
import { MAILING_STATUS, SUPPORT_STATUS } from "../utils/constants";
import { describePromoConditions, describePromoEffects } from "../utils/promo";
import {
  buildPromoMailingButtonFromPlan,
  buildMailingMessageContent,
  describeMailingButton,
  describeMailingTarget,
  getMailingActionStats,
  getMailingDraft,
  getMailingEditorText,
  getMailingPreviewText,
  parseMailingDirectives,
  processMailing,
} from "../utils/mailings";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || "";

function getBroadcastBuilderKeyboard(hasImage: boolean) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Текст", "admin_broadcast_edit:text"),
      Markup.button.callback("Картинка", "admin_broadcast_edit:image"),
    ],
    [
      Markup.button.callback("Кнопка", "admin_broadcast_edit:button"),
      Markup.button.callback("Превью", "admin_broadcast_edit:preview"),
    ],
    [Markup.button.callback("Получатели", "admin_broadcast_edit:targets")],
    ...(hasImage
      ? [[Markup.button.callback("Убрать картинку", "admin_broadcast_image:remove")]]
      : []),
    [Markup.button.callback("Отменить", "admin_broadcast_cancel")],
  ]).reply_markup;
}

function getBroadcastTargetKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "👥 Всем", callback_data: "admin_broadcast_target:all" }],
      [{ text: "👤 Одному пользователю", callback_data: "admin_broadcast_target:user" }],
      [{ text: "🚫 Без подписки", callback_data: "admin_broadcast_target:no_subscription" }],
      [{ text: "⏳ Подписка скоро кончится", callback_data: "admin_broadcast_target:expiring" }],
      [{ text: "💳 Без привязанной карты", callback_data: "admin_broadcast_target:no_card" }],
      [{ text: "◀️ Назад", callback_data: "admin_broadcast_edit:back" }],
    ],
  };
}

function getBroadcastButtonKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Привязать карту", "admin_broadcast_button:link_card")],
    [Markup.button.callback("Акционная подписка", "admin_broadcast_button:promo")],
    [Markup.button.callback("Открыть биллинг", "admin_broadcast_button:billing")],
    [Markup.button.callback("Своя ссылка", "admin_broadcast_button:custom")],
    [Markup.button.callback("Без кнопки", "admin_broadcast_button:none")],
    [Markup.button.callback("Назад", "admin_broadcast_edit:back")],
  ]).reply_markup;
}

async function getBroadcastPromoPlanKeyboard() {
  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      isActive: true,
      promoActive: true,
      promoPrice: { not: null },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return Markup.inlineKeyboard([
    ...plans.map((plan) => [
      Markup.button.callback(
        `${plan.name} · ${plan.promoPrice} ₽`,
        `admin_broadcast_button:promo:${plan.slug}`,
      ),
    ]),
    [Markup.button.callback("Назад", "admin_broadcast_edit:button")],
  ]).reply_markup;
}

export async function showBroadcastBuilder(
  ctx: Context,
  payload: Record<string, unknown>,
) {
  const draft = getMailingDraft(payload);
  await editOrReply(ctx, getMailingEditorText(draft), {
    parse_mode: "HTML",
    reply_markup: getBroadcastBuilderKeyboard(Boolean(draft.imageUrl)),
  });
}

async function sendBroadcastContentPreview(
  ctx: Context,
  payload: Record<string, unknown>,
) {
  const draft = getMailingDraft(payload);
  const previewText = draft.message || draft.title || "Предпросмотр";
  const previewMarkup = draft.buttonText
    ? {
        inline_keyboard: [[
          {
            text: draft.buttonText,
            callback_data: "admin_broadcast_preview_noop",
          },
        ]],
      }
    : undefined;

  if (draft.imageUrl) {
    await ctx.replyWithPhoto(draft.imageUrl, {
      caption: previewText,
      parse_mode: "HTML",
      reply_markup: previewMarkup,
    });
    return;
  }

  await ctx.reply(previewText, {
    parse_mode: "HTML",
    reply_markup: previewMarkup,
  });
}

export async function sendBroadcastConfirmPreview(
  ctx: Context,
  payload: Record<string, unknown>,
) {
  const draft = getMailingDraft(payload);
  await sendBroadcastContentPreview(ctx, payload);
  await ctx.reply(getMailingPreviewText(draft), {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [
        Markup.button.callback("Текст", "admin_broadcast_edit:text"),
        Markup.button.callback("Картинка", "admin_broadcast_edit:image"),
      ],
      [
        Markup.button.callback("Кнопка", "admin_broadcast_edit:button"),
        Markup.button.callback("Получатели", "admin_broadcast_edit:targets"),
      ],
      [Markup.button.callback("Время", "admin_broadcast_edit:schedule")],
      [Markup.button.callback("Подтвердить", "admin_broadcast_confirm")],
      [Markup.button.callback("Отменить", "admin_broadcast_cancel")],
    ]).reply_markup,
  });
}

/**
 * Handles support-related inline actions for end users.
 *
 * @param ctx Telegram context.
 */
export async function handleSupportAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!user) return;

  const data = (ctx.callbackQuery as any).data as string;

  if (data === "support_create") {
    await prisma.user.update({
      where: { id: user.id },
      data: { botState: "support_create_subject" },
    });
    await ctx.reply("Введите тему обращения.");
    return;
  }

  if (data.startsWith("support_list:")) {
    const [, status, pageRaw] = data.split(":");
    await renderUserTicketList(ctx, status || "open", Number(pageRaw || "0"));
    return;
  }

  if (data.startsWith("support_view:")) {
    const [, ticketId, pageRaw, status] = data.split(":");
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || ticket.userId !== user.id) {
      await ctx.answerCbQuery("Тикет не найден.");
      return;
    }

    const parsed = parseTicketMessage(ticket.message);
    await editOrReply(
      ctx,
      `💬 *${parsed.subject}*\n\n` +
        `Создан: ${ticket.createdAt.toLocaleString("ru-RU")}\n` +
        `Статус: ${ticket.status}\n\n` +
        `${parsed.description}\n\n` +
        `${ticket.reply ? `Ответ поддержки:\n${ticket.reply}` : "Ответа пока нет."}`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("◀️ К списку", `support_list:${status}:${pageRaw}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data === "support_confirm") {
    const state = decodeBotState(user.botState);
    if (!state || state.key !== "support_create_confirm") {
      await ctx.answerCbQuery("Черновик заявки не найден.");
      return;
    }

    const subject = String(state.payload.subject || "");
    const description = String(state.payload.description || "");
    await prisma.supportTicket.create({
      data: {
        userId: user.id,
        message: serializeTicketMessage({ subject, description }),
        status: SUPPORT_STATUS.open,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { botState: null },
    });

    await editOrReply(ctx, "Заявка создана.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("📂 Открытые заявки", "support_list:open:0")],
        [Markup.button.callback("◀️ В поддержку", "menu_support")],
      ]).reply_markup,
    });
    return;
  }

  if (data === "support_cancel") {
    await prisma.user.update({
      where: { id: user.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "Создание заявки отменено.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("◀️ В поддержку", "menu_support")],
      ]).reply_markup,
    });
  }
}

/**
 * Handles ticket reply preview confirmation for admin.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminTicketReplyFlow(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const admin = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!admin) return;

  const state = decodeBotState(admin.botState);
  const data = (ctx.callbackQuery as any).data as string;
  if (!state || state.key !== "admin_reply_ticket_preview") {
    await ctx.answerCbQuery("Предпросмотр ответа не найден.");
    return;
  }

  if (data === "admin_ticket_reply_cancel") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "Отправка ответа отменена.");
    return;
  }

  const ticketId = String(state.payload.ticketId || "");
  const message = String(state.payload.message || "");
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: true },
  });
  if (!ticket) {
    await ctx.answerCbQuery("Тикет не найден.");
    return;
  }

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { reply: message },
  });
  await prisma.user.update({
    where: { id: admin.id },
    data: { botState: null },
  });

  if (ticket.user.telegramId) {
    await ctx.telegram.sendMessage(
      Number(ticket.user.telegramId),
      `💬 <b>Ответ поддержки</b>\n\n${escapeHtml(message)}`,
      { parse_mode: "HTML" },
    );
  }

  await editOrReply(ctx, "Ответ отправлен пользователю.");
}

/**
 * Handles mailing creation flow.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminBroadcastFlow(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const admin = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!admin) return;

  const data = (ctx.callbackQuery as any).data as string;

  if (data === "admin_broadcast_create") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: "admin_broadcast_title" },
    });
    await ctx.reply("Введите заголовок рассылки.");
    return;
  }

  if (data.startsWith("admin_broadcast_view:")) {
    const [, mailingId, pageRaw] = data.split(":");
    const mailing = await prisma.telegram_mailings.findUnique({
      where: { id: mailingId },
    });
    if (!mailing) {
      await ctx.answerCbQuery("Рассылка не найдена.");
      return;
    }
    const actionStats = await getMailingActionStats(mailing.id);

    await editOrReply(
      ctx,
      `📢 <b>${escapeHtml(mailing.title)}</b>\n\n` +
        `<b>Статус:</b> ${escapeHtml(mailing.status)}\n` +
        `<b>Время:</b> ${escapeHtml(mailing.scheduledAt.toLocaleString("ru-RU"))}\n` +
        `<b>Получатели:</b> ${escapeHtml(describeMailingTarget(mailing.targetType))}\n` +
        `<b>Кнопка:</b> ${escapeHtml(describeMailingButton(mailing.buttonText, mailing.buttonUrl))}\n` +
        `<b>Клики:</b> ${actionStats.totalClicks} (${actionStats.uniqueClicks} уник.)\n` +
        `<b>Переходы:</b> ${actionStats.totalCompletes} (${actionStats.uniqueCompletes} уник.)\n\n` +
        `${escapeHtml(parseMailingDirectives(mailing.message).text || "Без текста")}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("Удалить", `admin_broadcast_delete:${mailing.id}:${pageRaw}`)],
          [Markup.button.callback("◀️ К списку", `admin_broadcasts:${pageRaw}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data.startsWith("admin_broadcast_delete:")) {
    const [, mailingId, pageRaw] = data.split(":");
    await prisma.telegram_mailings.delete({
      where: { id: mailingId },
    }).catch(() => null);
    await editOrReply(ctx, "Рассылка удалена.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("◀️ К списку", `admin_broadcasts:${pageRaw}`)],
      ]).reply_markup,
    });
    return;
  }

  const state = decodeBotState(admin.botState);
  if (!state) return;
  const broadcastEditableState =
    state.key === "admin_broadcast_builder" ||
    state.key === "admin_broadcast_confirm";

  if (broadcastEditableState && data === "admin_broadcast_edit:back") {
    await showBroadcastBuilder(ctx, state.payload);
    return;
  }

  if (broadcastEditableState && data === "admin_broadcast_edit:text") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: encodeBotState("admin_broadcast_text_input", state.payload) },
    });
    await ctx.reply("Введите текст рассылки. Он будет показан как текст сообщения или подпись под картинкой.");
    return;
  }

  if (broadcastEditableState && data === "admin_broadcast_edit:image") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: encodeBotState("admin_broadcast_image_input", state.payload) },
    });
    await ctx.reply("Отправьте фото в этот чат или пришлите прямую ссылку на изображение.");
    return;
  }

  if (broadcastEditableState && data === "admin_broadcast_edit:button") {
    await editOrReply(ctx, "Выберите действие для кнопки.", {
      reply_markup: getBroadcastButtonKeyboard(),
    });
    return;
  }

  if (broadcastEditableState && data === "admin_broadcast_edit:preview") {
    await sendBroadcastContentPreview(ctx, state.payload);
    return;
  }

  if (broadcastEditableState && data === "admin_broadcast_edit:targets") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: encodeBotState("admin_broadcast_target", state.payload) },
    });
    await ctx.reply("Выберите получателей рассылки.", {
      reply_markup: getBroadcastTargetKeyboard(),
    });
    return;
  }

  if (state.key === "admin_broadcast_confirm" && data === "admin_broadcast_edit:schedule") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: encodeBotState("admin_broadcast_schedule", state.payload) },
    });
    await ctx.reply("Выберите время отправки.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Отправить сразу", callback_data: "admin_broadcast_schedule:now" }],
          [{ text: "🕒 Запланировать", callback_data: "admin_broadcast_schedule:later" }],
        ],
      },
    });
    return;
  }

  if (broadcastEditableState && data === "admin_broadcast_image:remove") {
    const draft = getMailingDraft(state.payload);
    draft.imageUrl = null;
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: encodeBotState("admin_broadcast_builder", draft as unknown as Record<string, unknown>) },
    });
    await showBroadcastBuilder(ctx, draft as unknown as Record<string, unknown>);
    return;
  }

  if (broadcastEditableState && data.startsWith("admin_broadcast_button:")) {
    const [, action, actionValue] = data.split(":");
    const draft = getMailingDraft(state.payload);

    if (action === "none") {
      draft.buttonText = null;
      draft.buttonUrl = null;
      await prisma.user.update({
        where: { id: admin.id },
        data: { botState: encodeBotState("admin_broadcast_builder", draft as unknown as Record<string, unknown>) },
      });
      await showBroadcastBuilder(ctx, draft as unknown as Record<string, unknown>);
      return;
    }

    if (action === "promo" && !actionValue) {
      await editOrReply(ctx, "Выберите акционный тариф для кнопки.", {
        reply_markup: await getBroadcastPromoPlanKeyboard(),
      });
      return;
    }

    if (action === "promo" && actionValue) {
      const promoButton = await buildPromoMailingButtonFromPlan(actionValue);
      if (!promoButton) {
        await ctx.answerCbQuery("Акционный тариф не найден.");
        return;
      }

      draft.buttonText = promoButton.buttonText;
      draft.buttonUrl = promoButton.buttonUrl;
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          botState: encodeBotState(
            "admin_broadcast_builder",
            draft as unknown as Record<string, unknown>,
          ),
        },
      });
      await showBroadcastBuilder(ctx, draft as unknown as Record<string, unknown>);
      await ctx.reply(`Кнопка настроена: ${promoButton.summary}`);
      return;
    }

    await prisma.user.update({
      where: { id: admin.id },
      data: {
        botState: encodeBotState("admin_broadcast_button_label", {
          ...draft,
          pendingButtonUrl:
            action === "link_card"
              ? "action:link_card"
              : action === "billing"
                ? "action:billing"
                : "custom",
        }),
      },
    });
    await ctx.reply("Введите текст кнопки.");
    return;
  }

  if (data.startsWith("admin_broadcast_target:") && state.key === "admin_broadcast_target") {
    const target = data.split(":")[1];
    if (target === "expiring") {
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          botState: encodeBotState("admin_broadcast_expiring_days", {
            ...state.payload,
          }),
        },
      });
      await ctx.reply("Введите количество дней, в течение которых подписка должна истекать.");
      return;
    }

    if (target === "all" || target === "no_subscription" || target === "no_card") {
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          botState: encodeBotState("admin_broadcast_schedule", {
            ...state.payload,
            targetType: target,
            buttonText:
              state.payload.buttonText ??
              (target === "no_card"
                ? "Привязать карту"
                : target === "no_subscription"
                  ? "Открыть биллинг"
                  : null),
            buttonUrl:
              state.payload.buttonUrl ??
              (target === "no_card"
                ? "action:link_card"
                : target === "no_subscription"
                  ? "action:billing"
                  : null),
            targetUserIds: [],
          }),
        },
      });
    } else {
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          botState: encodeBotState("admin_broadcast_user", {
            ...state.payload,
          }),
        },
      });
      await ctx.reply("Введите логин пользователя для адресной рассылки.");
      return;
    }

    await ctx.reply("Выберите время отправки.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Отправить сразу", callback_data: "admin_broadcast_schedule:now" }],
          [{ text: "🕒 Запланировать", callback_data: "admin_broadcast_schedule:later" }],
        ],
      },
    });
    return;
  }

  if (data.startsWith("admin_broadcast_schedule:") && state.key === "admin_broadcast_schedule") {
    const action = data.split(":")[1];
    if (action === "later") {
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          botState: encodeBotState("admin_broadcast_schedule_input", state.payload),
        },
      });
      await ctx.reply("Введите дату и время в формате `ДД.ММ.ГГГГ ЧЧ:ММ`.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const payload: Record<string, unknown> = {
      ...state.payload,
      scheduledAt: new Date().toISOString(),
    };
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: encodeBotState("admin_broadcast_confirm", payload) },
    });
    await ctx.reply(
      `📢 <b>Предпросмотр рассылки</b>\n\n` +
        `<b>Тема:</b> ${escapeHtml(String(payload.title || ""))}\n` +
        `<b>Получатели:</b> ${
          payload.targetType === "user"
            ? escapeHtml(String(payload.targetLogin || ""))
            : escapeHtml(describeMailingTarget(String(payload.targetType || "all")))
        }\n` +
        `<b>Кнопка:</b> ${escapeHtml(
          describeMailingButton(
            payload.buttonText == null ? null : String(payload.buttonText),
            payload.buttonUrl == null ? null : String(payload.buttonUrl),
          ),
        )}\n` +
        `<b>Время:</b> сейчас\n\n` +
        `${escapeHtml(String(payload.message || ""))}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Подтвердить", callback_data: "admin_broadcast_confirm" }],
            [{ text: "❌ Отменить", callback_data: "admin_broadcast_cancel" }],
          ],
        },
      },
    );
    return;
  }

  if (data === "admin_broadcast_cancel") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "Создание рассылки отменено.");
    return;
  }

  if (data === "admin_broadcast_confirm" && state.key === "admin_broadcast_confirm") {
    const payload = state.payload as Record<string, unknown>;
    const mailing = await prisma.telegram_mailings.create({
      data: {
        id: crypto.randomUUID(),
        title: String(payload.title || ""),
        message: buildMailingMessageContent(getMailingDraft(payload)),
        buttonText:
          payload.buttonText == null ? null : String(payload.buttonText),
        buttonUrl:
          payload.buttonUrl == null ? null : String(payload.buttonUrl),
        targetType: String(payload.targetType || "all"),
        selectedUserIds: Array.isArray(payload.targetUserIds)
          ? (payload.targetUserIds as string[])
          : [],
        status: MAILING_STATUS.scheduled,
        scheduledAt: new Date(String(payload.scheduledAt)),
        createdById: admin.id,
        updatedAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: null },
    });

    if (mailing.scheduledAt <= new Date()) {
      await processMailing(mailing.id);
      await editOrReply(ctx, "Рассылка отправлена.");
      return;
    }

    await editOrReply(
      ctx,
      `Рассылка сохранена. Отправка запланирована на ${mailing.scheduledAt.toLocaleString("ru-RU")}.`,
    );
    return;
  }

  if (data.startsWith("admin_broadcast_view:")) {
    const [, mailingId, pageRaw] = data.split(":");
    const mailing = await prisma.telegram_mailings.findUnique({
      where: { id: mailingId },
    });
    if (!mailing) {
      await ctx.answerCbQuery("Рассылка не найдена.");
      return;
    }
    const actionStats = await getMailingActionStats(mailing.id);

    await editOrReply(
      ctx,
      `📢 <b>${escapeHtml(mailing.title)}</b>\n\n` +
        `<b>Статус:</b> ${escapeHtml(mailing.status)}\n` +
        `<b>Время:</b> ${escapeHtml(mailing.scheduledAt.toLocaleString("ru-RU"))}\n` +
        `<b>Получатели:</b> ${escapeHtml(describeMailingTarget(mailing.targetType))}\n` +
        `<b>Кнопка:</b> ${escapeHtml(describeMailingButton(mailing.buttonText, mailing.buttonUrl))}\n` +
        `<b>Клики:</b> ${actionStats.totalClicks} (${actionStats.uniqueClicks} уник.)\n` +
        `<b>Переходы:</b> ${actionStats.totalCompletes} (${actionStats.uniqueCompletes} уник.)\n\n` +
        `${escapeHtml(parseMailingDirectives(mailing.message).text || "Без текста")}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("◀️ К списку", `admin_broadcasts:${pageRaw}`)],
        ]).reply_markup,
      },
    );
  }
}

/**
 * Handles step-by-step promo builder actions.
 *
 * @param ctx Telegram context.
 */
export async function handleAdminPromoBuilderAction(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId || telegramId.toString() !== ADMIN_ID) return;

  const admin = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  if (!admin) return;

  const data = (ctx.callbackQuery as any).data as string;
  const state = decodeBotState(admin.botState);
  if (!state) return;

  if (data === "admin_promo_conditions_menu" && state.key === "admin_promo_create_conditions") {
    await editOrReply(ctx, "Выберите тип условия.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("Баланс от ...", "admin_promo_condition:min_balance")],
        [Markup.button.callback("Без пригласившего", "admin_promo_condition:must_have_no_referrer")],
        [Markup.button.callback("Только новый пользователь", "admin_promo_condition:new_user_only")],
        [Markup.button.callback("◀️ Назад", "admin_promo_conditions_done")],
      ]).reply_markup,
    });
    return;
  }

  if (data.startsWith("admin_promo_condition:") && state.key === "admin_promo_create_conditions") {
    const type = data.split(":")[1];
    if (type === "must_have_no_referrer" || type === "new_user_only") {
      const nextConditions = [...((state.payload.conditions as any[]) || []), { key: type, value: "1" }];
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          botState: encodeBotState("admin_promo_create_conditions", {
            ...state.payload,
            conditions: nextConditions,
          }),
        },
      });
      await editOrReply(ctx, "Условие добавлено.", {
        reply_markup: Markup.inlineKeyboard([
          [{ text: "➕ Добавить условие", callback_data: "admin_promo_conditions_menu" }],
          [{ text: "✅ Подтвердить условия", callback_data: "admin_promo_conditions_done" }],
        ]).reply_markup,
      });
      return;
    }

    await prisma.user.update({
      where: { id: admin.id },
      data: {
        botState: encodeBotState("admin_promo_condition_value", {
          draft: state.payload,
          type,
        }),
      },
    });
    await ctx.reply("Введите значение для условия.");
    return;
  }

  if (data === "admin_promo_conditions_done" && state.key === "admin_promo_create_conditions") {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        botState: encodeBotState("admin_promo_create_effects", state.payload),
      },
    });
    await editOrReply(ctx, "Теперь добавьте эффекты промокода.", {
      reply_markup: Markup.inlineKeyboard([
        [{ text: "➕ Добавить эффект", callback_data: "admin_promo_effects_menu" }],
      ]).reply_markup,
    });
    return;
  }

  if (data === "admin_promo_effects_menu" && state.key === "admin_promo_create_effects") {
    await editOrReply(ctx, "Выберите тип эффекта.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("Пополнить баланс", "admin_promo_effect:add_balance")],
        [Markup.button.callback("Ставка рефералки", "admin_promo_effect:set_referral_rate")],
        [Markup.button.callback("Скидка %", "admin_promo_effect:discount_pct")],
        [Markup.button.callback("Скидка ₽", "admin_promo_effect:discount_fixed")],
      ]).reply_markup,
    });
    return;
  }

  if (data.startsWith("admin_promo_effect:") && state.key === "admin_promo_create_effects") {
    const type = data.split(":")[1];
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        botState: encodeBotState("admin_promo_effect_value", {
          draft: state.payload,
          type,
        }),
      },
    });
    await ctx.reply("Введите значение для эффекта.");
    return;
  }

  if (data === "admin_promo_preview" && state.key === "admin_promo_create_effects") {
    const conditions = describePromoConditions({
      conditions: state.payload.conditions || [],
      maxActivations: null,
    });
    const effects = describePromoEffects({
      effects: state.payload.effects || [],
    });

    await prisma.user.update({
      where: { id: admin.id },
      data: {
        botState: encodeBotState("admin_promo_create_preview", state.payload),
      },
    });
    await editOrReply(
      ctx,
      `🎃 <b>Предпросмотр промокода ${escapeHtml(String(state.payload.code || ""))}</b>\n\n` +
        `<b>Условия:</b>\n${conditions.length ? conditions.map((line) => `• ${escapeHtml(line)}`).join("\n") : "• нет"}\n\n` +
        `<b>Эффекты:</b>\n${effects.length ? effects.map((line) => `• ${escapeHtml(line)}`).join("\n") : "• нет"}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("✅ Сохранить", "admin_promo_save")],
          [Markup.button.callback("❌ Отменить", "admin_promo_cancel")],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data === "admin_promo_cancel") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "Создание промокода отменено.");
    return;
  }

  if (data === "admin_promo_save") {
    const previewState = decodeBotState(admin.botState);
    if (!previewState || previewState.key !== "admin_promo_create_preview") {
      await ctx.answerCbQuery("Черновик не найден.");
      return;
    }

    await prisma.promoCode.create({
      data: {
        code: String(previewState.payload.code || ""),
        conditions: Array.isArray(previewState.payload.conditions)
          ? previewState.payload.conditions
          : [],
        effects: Array.isArray(previewState.payload.effects)
          ? previewState.payload.effects
          : [],
      },
    });

    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "Промокод сохранён.");
  }
}
