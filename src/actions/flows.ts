import crypto from "node:crypto";
import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { encodeBotState, decodeBotState } from "../utils/state";
import { editOrReply, escapeHtml } from "../utils/telegram";
import { renderUserTicketList } from "./menus";
import { parseTicketMessage, serializeTicketMessage } from "../utils/support";
import { MAILING_STATUS, PAGINATION, SUPPORT_STATUS } from "../utils/constants";
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
        `${plan.name} - ${plan.promoPrice} ₽`,
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
    await ctx.reply("Р’РІРµРґРёС‚Рµ С‚РµРјСѓ РѕР±СЂР°С‰РµРЅРёСЏ.");
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
      await ctx.answerCbQuery("РўРёРєРµС‚ РЅРµ РЅР°Р№РґРµРЅ.");
      return;
    }

    const parsed = parseTicketMessage(ticket.message);
    await editOrReply(
      ctx,
      `рџ’¬ *${parsed.subject}*\n\n` +
        `РЎРѕР·РґР°РЅ: ${ticket.createdAt.toLocaleString("ru-RU")}\n` +
        `РЎС‚Р°С‚СѓСЃ: ${ticket.status}\n\n` +
        `${parsed.description}\n\n` +
        `${ticket.reply ? `РћС‚РІРµС‚ РїРѕРґРґРµСЂР¶РєРё:\n${ticket.reply}` : "РћС‚РІРµС‚Р° РїРѕРєР° РЅРµС‚."}`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("в—ЂпёЏ Рљ СЃРїРёСЃРєСѓ", `support_list:${status}:${pageRaw}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data === "support_confirm") {
    const state = decodeBotState(user.botState);
    if (!state || state.key !== "support_create_confirm") {
      await ctx.answerCbQuery("Р§РµСЂРЅРѕРІРёРє Р·Р°СЏРІРєРё РЅРµ РЅР°Р№РґРµРЅ.");
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

    await editOrReply(ctx, "Р—Р°СЏРІРєР° СЃРѕР·РґР°РЅР°.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("рџ“‚ РћС‚РєСЂС‹С‚С‹Рµ Р·Р°СЏРІРєРё", "support_list:open:0")],
        [Markup.button.callback("в—ЂпёЏ Р’ РїРѕРґРґРµСЂР¶РєСѓ", "menu_support")],
      ]).reply_markup,
    });
    return;
  }

  if (data === "support_cancel") {
    await prisma.user.update({
      where: { id: user.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "РЎРѕР·РґР°РЅРёРµ Р·Р°СЏРІРєРё РѕС‚РјРµРЅРµРЅРѕ.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("в—ЂпёЏ Р’ РїРѕРґРґРµСЂР¶РєСѓ", "menu_support")],
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
    await ctx.answerCbQuery("РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РѕС‚РІРµС‚Р° РЅРµ РЅР°Р№РґРµРЅ.");
    return;
  }

  if (data === "admin_ticket_reply_cancel") {
    await prisma.user.update({
      where: { id: admin.id },
      data: { botState: null },
    });
    await editOrReply(ctx, "РћС‚РїСЂР°РІРєР° РѕС‚РІРµС‚Р° РѕС‚РјРµРЅРµРЅР°.");
    return;
  }

  const ticketId = String(state.payload.ticketId || "");
  const message = String(state.payload.message || "");
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: true },
  });
  if (!ticket) {
    await ctx.answerCbQuery("РўРёРєРµС‚ РЅРµ РЅР°Р№РґРµРЅ.");
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
      `рџ’¬ <b>РћС‚РІРµС‚ РїРѕРґРґРµСЂР¶РєРё</b>\n\n${escapeHtml(message)}`,
      { parse_mode: "HTML" },
    );
  }

  await editOrReply(ctx, "РћС‚РІРµС‚ РѕС‚РїСЂР°РІР»РµРЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ.");
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
      `📨 <b>${escapeHtml(mailing.title)}</b>\n\n` +
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
          [Markup.button.callback("Кликнувшие", `mcl:${mailing.id}:0:${pageRaw}`)],
          [Markup.button.callback("Удалить", `admin_broadcast_delete:${mailing.id}:${pageRaw}`)],
          [Markup.button.callback("◀️ К списку", `admin_broadcasts:${pageRaw}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data.startsWith("mcl:")) {
    const [, mailingId, clickerPageRaw, listPageRaw] = data.split(":");
    const clickerPage = Number(clickerPageRaw || "0");
    const listPage = Number(listPageRaw || "0");

    const mailing = await prisma.telegram_mailings.findUnique({
      where: { id: mailingId },
      select: { id: true, title: true },
    });
    if (!mailing) {
      await ctx.answerCbQuery("Рассылка не найдена.");
      return;
    }

    const mailingActions = (prisma as any).telegram_mailing_actions;
    const [clickers, total] = await Promise.all([
      mailingActions.findMany({
        where: {
          mailingId,
          clickCount: { gt: 0 },
        },
        include: {
          user: {
            select: {
              id: true,
              login: true,
              balance: true,
            },
          },
        },
        orderBy: [{ lastClickedAt: "desc" }],
        skip: clickerPage * PAGINATION.users,
        take: PAGINATION.users,
      }),
      mailingActions.count({
        where: {
          mailingId,
          clickCount: { gt: 0 },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / PAGINATION.users));
    const buttons = clickers.map((item: any) => [
      Markup.button.callback(
        `${item.user.login} · ${item.clickCount} кл. · ${item.completeCount} пер.`,
        `admin_user_view_${item.user.id}`,
      ),
    ]);

    const pager: ReturnType<typeof Markup.button.callback>[] = [];
    if (clickerPage > 0) {
      pager.push(
        Markup.button.callback(
          "⬅️ Назад",
          `mcl:${mailingId}:${clickerPage - 1}:${listPage}`,
        ),
      );
    }
    if (clickerPage + 1 < totalPages) {
      pager.push(
        Markup.button.callback(
          "Вперёд ➡️",
          `mcl:${mailingId}:${clickerPage + 1}:${listPage}`,
        ),
      );
    }
    if (pager.length) {
      buttons.push(pager);
    }

    buttons.push([
      Markup.button.callback("◀️ К рассылке", `admin_broadcast_view:${mailingId}:${listPage}`),
    ]);

    const listText = clickers.length
      ? clickers
          .map((item: any) => {
            const lastClicked = item.lastClickedAt
              ? new Date(item.lastClickedAt).toLocaleString("ru-RU")
              : "неизвестно";
            return (
              `• ${item.user.login}\n` +
              `Кликов: ${item.clickCount}, переходов: ${item.completeCount}\n` +
              `Последний клик: ${lastClicked}`
            );
          })
          .join("\n\n")
      : "Никто пока не нажимал кнопку.";

    await editOrReply(
      ctx,
      `👆 <b>Кликнувшие по рассылке "${escapeHtml(mailing.title)}"</b>\n` +
        `Страница ${clickerPage + 1}/${totalPages}\n\n` +
        `${escapeHtml(listText)}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
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
    await ctx.reply("Р’РІРµРґРёС‚Рµ С‚РµРєСЃС‚ СЂР°СЃСЃС‹Р»РєРё. РћРЅ Р±СѓРґРµС‚ РїРѕРєР°Р·Р°РЅ РєР°Рє С‚РµРєСЃС‚ СЃРѕРѕР±С‰РµРЅРёСЏ РёР»Рё РїРѕРґРїРёСЃСЊ РїРѕРґ РєР°СЂС‚РёРЅРєРѕР№.");
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

    await ctx.reply("Р’С‹Р±РµСЂРёС‚Рµ РІСЂРµРјСЏ РѕС‚РїСЂР°РІРєРё.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "рџљЂ РћС‚РїСЂР°РІРёС‚СЊ СЃСЂР°Р·Сѓ", callback_data: "admin_broadcast_schedule:now" }],
          [{ text: "рџ•’ Р—Р°РїР»Р°РЅРёСЂРѕРІР°С‚СЊ", callback_data: "admin_broadcast_schedule:later" }],
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
      await ctx.reply("Р’РІРµРґРёС‚Рµ РґР°С‚Сѓ Рё РІСЂРµРјСЏ РІ С„РѕСЂРјР°С‚Рµ `Р”Р”.РњРњ.Р“Р“Р“Р“ Р§Р§:РњРњ`.", {
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
      `рџ“ў <b>РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ СЂР°СЃСЃС‹Р»РєРё</b>\n\n` +
        `<b>РўРµРјР°:</b> ${escapeHtml(String(payload.title || ""))}\n` +
        `<b>РџРѕР»СѓС‡Р°С‚РµР»Рё:</b> ${
          payload.targetType === "user"
            ? escapeHtml(String(payload.targetLogin || ""))
            : escapeHtml(describeMailingTarget(String(payload.targetType || "all")))
        }\n` +
        `<b>РљРЅРѕРїРєР°:</b> ${escapeHtml(
          describeMailingButton(
            payload.buttonText == null ? null : String(payload.buttonText),
            payload.buttonUrl == null ? null : String(payload.buttonUrl),
          ),
        )}\n` +
        `<b>Р’СЂРµРјСЏ:</b> СЃРµР№С‡Р°СЃ\n\n` +
        `${escapeHtml(String(payload.message || ""))}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "вњ… РџРѕРґС‚РІРµСЂРґРёС‚СЊ", callback_data: "admin_broadcast_confirm" }],
            [{ text: "вќЊ РћС‚РјРµРЅРёС‚СЊ", callback_data: "admin_broadcast_cancel" }],
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
    await editOrReply(ctx, "РЎРѕР·РґР°РЅРёРµ СЂР°СЃСЃС‹Р»РєРё РѕС‚РјРµРЅРµРЅРѕ.");
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
      await editOrReply(ctx, "Р Р°СЃСЃС‹Р»РєР° РѕС‚РїСЂР°РІР»РµРЅР°.");
      return;
    }

    await editOrReply(
      ctx,
      `Р Р°СЃСЃС‹Р»РєР° СЃРѕС…СЂР°РЅРµРЅР°. РћС‚РїСЂР°РІРєР° Р·Р°РїР»Р°РЅРёСЂРѕРІР°РЅР° РЅР° ${mailing.scheduledAt.toLocaleString("ru-RU")}.`,
    );
    return;
  }

  if (data.startsWith("admin_broadcast_view:")) {
    const [, mailingId, pageRaw] = data.split(":");
    const mailing = await prisma.telegram_mailings.findUnique({
      where: { id: mailingId },
    });
    if (!mailing) {
      await ctx.answerCbQuery("Р Р°СЃСЃС‹Р»РєР° РЅРµ РЅР°Р№РґРµРЅР°.");
      return;
    }
    const actionStats = await getMailingActionStats(mailing.id);

    await editOrReply(
      ctx,
      `рџ“ў <b>${escapeHtml(mailing.title)}</b>\n\n` +
        `<b>РЎС‚Р°С‚СѓСЃ:</b> ${escapeHtml(mailing.status)}\n` +
        `<b>Р’СЂРµРјСЏ:</b> ${escapeHtml(mailing.scheduledAt.toLocaleString("ru-RU"))}\n` +
        `<b>РџРѕР»СѓС‡Р°С‚РµР»Рё:</b> ${escapeHtml(describeMailingTarget(mailing.targetType))}\n` +
        `<b>РљРЅРѕРїРєР°:</b> ${escapeHtml(describeMailingButton(mailing.buttonText, mailing.buttonUrl))}\n` +
        `<b>РљР»РёРєРё:</b> ${actionStats.totalClicks} (${actionStats.uniqueClicks} СѓРЅРёРє.)\n` +
        `<b>РџРµСЂРµС…РѕРґС‹:</b> ${actionStats.totalCompletes} (${actionStats.uniqueCompletes} СѓРЅРёРє.)\n\n` +
        `${escapeHtml(parseMailingDirectives(mailing.message).text || "Р‘РµР· С‚РµРєСЃС‚Р°")}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("РљР»РёРєРЅСѓРІС€РёРµ", `mcl:${mailing.id}:0:${pageRaw}`)],
          [Markup.button.callback("в—ЂпёЏ Рљ СЃРїРёСЃРєСѓ", `admin_broadcasts:${pageRaw}`)],
        ]).reply_markup,
      },
    );
    return;
  }

  if (data.startsWith("mcl:")) {
    const [, mailingId, clickerPageRaw, listPageRaw] = data.split(":");
    const clickerPage = Number(clickerPageRaw || "0");
    const listPage = Number(listPageRaw || "0");

    const mailing = await prisma.telegram_mailings.findUnique({
      where: { id: mailingId },
      select: { id: true, title: true },
    });
    if (!mailing) {
      await ctx.answerCbQuery("Р Р°СЃСЃС‹Р»РєР° РЅРµ РЅР°Р№РґРµРЅР°.");
      return;
    }

    const mailingActions = (prisma as any).telegram_mailing_actions;
    const [clickers, total] = await Promise.all([
      mailingActions.findMany({
        where: {
          mailingId,
          clickCount: { gt: 0 },
        },
        include: {
          user: {
            select: {
              id: true,
              login: true,
              balance: true,
            },
          },
        },
        orderBy: [{ lastClickedAt: "desc" }],
        skip: clickerPage * PAGINATION.users,
        take: PAGINATION.users,
      }),
      mailingActions.count({
        where: {
          mailingId,
          clickCount: { gt: 0 },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / PAGINATION.users));
    const buttons = clickers.map((item: any) => [
      Markup.button.callback(
        `${item.user.login} В· ${item.clickCount} РєР». В· ${item.completeCount} РїРµСЂ.`,
        `admin_user_view_${item.user.id}`,
      ),
    ]);

    const pager: ReturnType<typeof Markup.button.callback>[] = [];
    if (clickerPage > 0) {
      pager.push(
        Markup.button.callback(
          "в¬…пёЏ РќР°Р·Р°Рґ",
          `mcl:${mailingId}:${clickerPage - 1}:${listPage}`,
        ),
      );
    }
    if (clickerPage + 1 < totalPages) {
      pager.push(
        Markup.button.callback(
          "Р’РїРµСЂС‘Рґ вћЎпёЏ",
          `mcl:${mailingId}:${clickerPage + 1}:${listPage}`,
        ),
      );
    }
    if (pager.length) {
      buttons.push(pager);
    }

    buttons.push([
      Markup.button.callback("в—ЂпёЏ Рљ СЂР°СЃСЃС‹Р»РєРµ", `admin_broadcast_view:${mailingId}:${listPage}`),
    ]);

    const listText = clickers.length
      ? clickers
          .map((item: any) => {
            const lastClicked = item.lastClickedAt
              ? new Date(item.lastClickedAt).toLocaleString("ru-RU")
              : "РЅРµРёР·РІРµСЃС‚РЅРѕ";
            return (
              `вЂў ${item.user.login}\n` +
              `РљР»РёРєРѕРІ: ${item.clickCount}, РїРµСЂРµС…РѕРґРѕРІ: ${item.completeCount}\n` +
              `РџРѕСЃР»РµРґРЅРёР№ РєР»РёРє: ${lastClicked}`
            );
          })
          .join("\n\n")
      : "РќРёРєС‚Рѕ РїРѕРєР° РЅРµ РЅР°Р¶РёРјР°Р» РєРЅРѕРїРєСѓ.";

    await editOrReply(
      ctx,
      `рџ‘† <b>РљР»РёРєРЅСѓРІС€РёРµ РїРѕ СЂР°СЃСЃС‹Р»РєРµ "${escapeHtml(mailing.title)}"</b>\n` +
        `РЎС‚СЂР°РЅРёС†Р° ${clickerPage + 1}/${totalPages}\n\n` +
        `${escapeHtml(listText)}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
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
    await editOrReply(ctx, "Р’С‹Р±РµСЂРёС‚Рµ С‚РёРї СѓСЃР»РѕРІРёСЏ.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("Р‘Р°Р»Р°РЅСЃ РѕС‚ ...", "admin_promo_condition:min_balance")],
        [Markup.button.callback("Р‘РµР· РїСЂРёРіР»Р°СЃРёРІС€РµРіРѕ", "admin_promo_condition:must_have_no_referrer")],
        [Markup.button.callback("РўРѕР»СЊРєРѕ РЅРѕРІС‹Р№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ", "admin_promo_condition:new_user_only")],
        [Markup.button.callback("в—ЂпёЏ РќР°Р·Р°Рґ", "admin_promo_conditions_done")],
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
      await editOrReply(ctx, "РЈСЃР»РѕРІРёРµ РґРѕР±Р°РІР»РµРЅРѕ.", {
        reply_markup: Markup.inlineKeyboard([
          [{ text: "вћ• Р”РѕР±Р°РІРёС‚СЊ СѓСЃР»РѕРІРёРµ", callback_data: "admin_promo_conditions_menu" }],
          [{ text: "вњ… РџРѕРґС‚РІРµСЂРґРёС‚СЊ СѓСЃР»РѕРІРёСЏ", callback_data: "admin_promo_conditions_done" }],
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
    await ctx.reply("Р’РІРµРґРёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РґР»СЏ СѓСЃР»РѕРІРёСЏ.");
    return;
  }

  if (data === "admin_promo_conditions_done" && state.key === "admin_promo_create_conditions") {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        botState: encodeBotState("admin_promo_create_effects", state.payload),
      },
    });
    await editOrReply(ctx, "РўРµРїРµСЂСЊ РґРѕР±Р°РІСЊС‚Рµ СЌС„С„РµРєС‚С‹ РїСЂРѕРјРѕРєРѕРґР°.", {
      reply_markup: Markup.inlineKeyboard([
        [{ text: "вћ• Р”РѕР±Р°РІРёС‚СЊ СЌС„С„РµРєС‚", callback_data: "admin_promo_effects_menu" }],
      ]).reply_markup,
    });
    return;
  }

  if (data === "admin_promo_effects_menu" && state.key === "admin_promo_create_effects") {
    await editOrReply(ctx, "Р’С‹Р±РµСЂРёС‚Рµ С‚РёРї СЌС„С„РµРєС‚Р°.", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("РџРѕРїРѕР»РЅРёС‚СЊ Р±Р°Р»Р°РЅСЃ", "admin_promo_effect:add_balance")],
        [Markup.button.callback("РЎС‚Р°РІРєР° СЂРµС„РµСЂР°Р»РєРё", "admin_promo_effect:set_referral_rate")],
        [Markup.button.callback("РЎРєРёРґРєР° %", "admin_promo_effect:discount_pct")],
        [Markup.button.callback("РЎРєРёРґРєР° в‚Ѕ", "admin_promo_effect:discount_fixed")],
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
    await ctx.reply("Р’РІРµРґРёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РґР»СЏ СЌС„С„РµРєС‚Р°.");
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
      `рџЋѓ <b>РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РїСЂРѕРјРѕРєРѕРґР° ${escapeHtml(String(state.payload.code || ""))}</b>\n\n` +
        `<b>РЈСЃР»РѕРІРёСЏ:</b>\n${conditions.length ? conditions.map((line) => `вЂў ${escapeHtml(line)}`).join("\n") : "вЂў РЅРµС‚"}\n\n` +
        `<b>Р­С„С„РµРєС‚С‹:</b>\n${effects.length ? effects.map((line) => `вЂў ${escapeHtml(line)}`).join("\n") : "вЂў РЅРµС‚"}`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("вњ… РЎРѕС…СЂР°РЅРёС‚СЊ", "admin_promo_save")],
          [Markup.button.callback("вќЊ РћС‚РјРµРЅРёС‚СЊ", "admin_promo_cancel")],
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
    await editOrReply(ctx, "РЎРѕР·РґР°РЅРёРµ РїСЂРѕРјРѕРєРѕРґР° РѕС‚РјРµРЅРµРЅРѕ.");
    return;
  }

  if (data === "admin_promo_save") {
    const previewState = decodeBotState(admin.botState);
    if (!previewState || previewState.key !== "admin_promo_create_preview") {
      await ctx.answerCbQuery("Р§РµСЂРЅРѕРІРёРє РЅРµ РЅР°Р№РґРµРЅ.");
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
    await editOrReply(ctx, "РџСЂРѕРјРѕРєРѕРґ СЃРѕС…СЂР°РЅС‘РЅ.");
  }
}
