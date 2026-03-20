import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { bot, getMainMenu } from "../utils/bot";
import { getSbpClient } from "../utils/sbp";
import { LEGAL_URLS } from "../utils/constants";
import { createRecoveryPromo, generatePromoSuffix } from "../actions/admin";
import { showBroadcastBuilder } from "../actions/flows";
import { encodeBotState, decodeBotState } from "../utils/state";
import { escapeHtml } from "../utils/telegram";
import { asPromoRules, validatePromoConditions } from "../utils/promo";
import { formatTicketPreview } from "../utils/support";
import { DEFAULT_REFERRAL_RATE, getEffectiveReferralRate } from "../utils/referrals";
import { getMailingDraft, parseMailingDirectives } from "../utils/mailings";

const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || "";

/**
 * Builds legal acceptance buttons using public website URLs.
 *
 * @param userId User id that should be bound after acceptance.
 * @returns Inline keyboard.
 */
function getLegalKeyboard(userId: string) {
  return {
    inline_keyboard: [
      [{ text: "📜 Публичная оферта", url: LEGAL_URLS.offer }],
      [{ text: "🔒 Политика конфиденциальности", url: LEGAL_URLS.privacy }],
      [{ text: "✅ Принять и продолжить", callback_data: `legal_accept_all:${userId}` }],
    ],
  };
}

/**
 * Parses scheduled datetime in `ДД.ММ.ГГГГ ЧЧ:ММ` format.
 *
 * @param raw Input text.
 * @returns Parsed date or `null`.
 */
function parseScheduleDate(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, day, month, year, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Applies a promo code to the current user.
 *
 * @param user Current user.
 * @param codeText Promo code text from message.
 * @returns Result message.
 */
async function activatePromo(user: any, codeText: string): Promise<string> {
  const code = codeText.trim().toUpperCase();
  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo) {
    return "Промокод не найден.";
  }

  const existingActivation = await prisma.promoActivation.findUnique({
    where: { userId_promoCodeId: { userId: user.id, promoCodeId: promo.id } },
  });
  if (existingActivation) {
    return "Вы уже активировали этот промокод.";
  }

  const activationsCount = await prisma.promoActivation.count({
    where: { promoCodeId: promo.id },
  });
  if (promo.maxActivations && activationsCount >= promo.maxActivations) {
    return "Лимит активаций уже исчерпан.";
  }

  const conditions = asPromoRules(promo.conditions);
  const conditionError = validatePromoConditions(user, conditions);
  if (conditionError) {
    return conditionError;
  }

  let balanceAdded = 0;
  let appliedDiscountPct = 0;
  let appliedDiscountFixed = 0;
  const effects = asPromoRules(promo.effects);

  for (const effect of effects) {
    if (effect.key === "set_referral_rate") {
      await prisma.user.update({
        where: { id: user.id },
        data: { referralRate: Number(effect.value) },
      });
    }

    if (effect.key === "discount_pct" || effect.key === "plan_discount_pct") {
      appliedDiscountPct = Number(effect.value);
      await prisma.user.update({
        where: { id: user.id },
        data: { pendingDiscountPct: appliedDiscountPct },
      });
    }

    if (effect.key === "discount_fixed" || effect.key === "plan_discount_fixed") {
      appliedDiscountFixed = Number(effect.value);
      await prisma.user.update({
        where: { id: user.id },
        data: { pendingDiscountFixed: appliedDiscountFixed },
      });
    }

    if (effect.key === "add_balance") {
      const amount = Number(effect.value);
      if (amount > 0) {
        balanceAdded += amount;
        await prisma.user.update({
          where: { id: user.id },
          data: { balance: { increment: amount } },
        });
        await prisma.transaction.create({
          data: {
            userId: user.id,
            type: "promo_topup",
            amount,
            title: `Активация промокода ${code}`,
          },
        });
      }
    }

    if (effect.key === "referrer_id" && !user.referredById) {
      const referrer = await prisma.user.findUnique({
        where: { id: effect.value },
      });

      if (referrer) {
        const pastPayments = await prisma.payment.findMany({
          where: { userId: user.id, status: "success" },
        });
        const totalAmount = pastPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const totalCommission =
          totalAmount * getEffectiveReferralRate(referrer.referralRate);

        await prisma.user.update({
          where: { id: user.id },
          data: { referredById: referrer.id },
        });

        if (totalCommission > 0) {
          await prisma.user.update({
            where: { id: referrer.id },
            data: { referralBalance: { increment: totalCommission } },
          });
        }
      }
    }
  }

  await prisma.promoActivation.create({
    data: { userId: user.id, promoCodeId: promo.id },
  });

  if (balanceAdded > 0) {
    return `Промокод ${code} активирован. На баланс зачислено ${balanceAdded} ₽.`;
  }

  if (appliedDiscountPct > 0) {
    return `Промокод ${code} активирован. Скидка ${appliedDiscountPct}% применена к следующей покупке.`;
  }

  if (appliedDiscountFixed > 0) {
    return `Промокод ${code} активирован. Скидка ${appliedDiscountFixed} ₽ применена к следующей покупке.`;
  }

  return `Промокод ${code} активирован.`;
}

/**
 * Sends the regular logged-in menu for a confirmed account.
 *
 * @param ctx Telegram context.
 * @param login User login shown in greeting.
 * @param telegramId Current Telegram id.
 */
async function replyWithAuthorizedMenu(
  ctx: Context,
  login: string,
  telegramId: number,
) {
  let keyboard = getMainMenu().reply_markup.inline_keyboard;
  if (telegramId.toString() === ADMIN_ID) {
    keyboard = [
      ...keyboard,
      [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }],
    ];
  }

  await ctx.reply(`Вы уже вошли в аккаунт <b>${escapeHtml(login)}</b>.`, {
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [[{ text: "Меню" }]],
      resize_keyboard: true,
    },
  });

  await ctx.reply("Выберите действие:", {
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Migrates an active shadow Telegram session into an existing real account.
 *
 * The legacy database keeps temporary Telegram sessions as `tg_<id>` users.
 * When the user enters an existing login, we bind the current Telegram id to
 * that account and remove the shadow row so the session becomes canonical.
 *
 * @param shadowUser Temporary Telegram-only user.
 * @param targetUser Existing real account selected by login.
 * @param telegramId Current Telegram id.
 */
async function attachShadowUserToExistingAccount(
  shadowUser: { id: string; tempReferrerId: string | null },
  targetUser: { id: string; referredById: string | null },
  telegramId: number,
) {
  const referredById =
    targetUser.referredById ||
    (shadowUser.tempReferrerId && shadowUser.tempReferrerId !== targetUser.id
      ? shadowUser.tempReferrerId
      : null);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: shadowUser.id },
      data: {
        telegramId: null,
        botState: null,
      },
    });

    await tx.user.update({
      where: { id: targetUser.id },
      data: {
        telegramId: BigInt(telegramId),
        telegramLinkCode: null,
        botState: null,
        referredById,
      },
    });

    await tx.user.delete({
      where: { id: shadowUser.id },
    });
  });
}

/**
 * Handles text messages for both guest and authenticated users.
 *
 * @param ctx Telegram context.
 */
export async function handleTextMessage(ctx: Context) {
  if (!ctx.message || !("text" in ctx.message)) return;

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const text = ctx.message.text.trim();
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  const targetUser = await prisma.user.findFirst({
    where: {
      OR: [{ login: text }, { telegramLinkCode: text }],
    },
  });

  if (targetUser?.telegramId === BigInt(telegramId)) {
    if (user?.login.startsWith("tg_") && user.id !== targetUser.id) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }

    if (user?.botState) {
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { botState: null },
      }).catch(() => {});
    }

    await replyWithAuthorizedMenu(ctx, targetUser.login, telegramId);
    return;
  }

  if (!user || user.login.startsWith("tg_")) {
    if (!targetUser) {
      if (text.length < 3 || text.length > 24) {
        await ctx.reply("Логин должен быть длиной от 3 до 24 символов.");
        return;
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        await ctx.reply("Логин не должен быть email-адресом.");
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(text)) {
        await ctx.reply("Логин может содержать только латиницу, цифры и подчёркивания.");
        return;
      }

      const tempPassword = crypto.randomBytes(4).toString("hex");
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const referralCode = crypto.randomBytes(5).toString("hex");

      try {
        const newUser = await prisma.$transaction(async (tx) => {
          const shadow = await tx.user.findUnique({
            where: { telegramId: BigInt(telegramId) },
          });
          const referredById = shadow?.tempReferrerId || null;

          if (shadow && shadow.login.startsWith("tg_")) {
            return tx.user.update({
              where: { id: shadow.id },
              data: {
                login: text,
                passwordHash,
                referralCode,
                referralRate: getEffectiveReferralRate(shadow.referralRate),
                referredById,
                tempReferrerId: null,
              },
            });
          }

          return tx.user.create({
            data: {
              login: text,
              passwordHash,
              referralCode,
              telegramId: BigInt(telegramId),
              referralRate: DEFAULT_REFERRAL_RATE,
              referredById,
            },
          });
        });

        await ctx.reply(
          `🎉 <b>Аккаунт ${escapeHtml(newUser.login)} создан.</b>\n\n` +
            `Пароль для сайта: <code>${escapeHtml(tempPassword)}</code>\n\n` +
            `Ознакомьтесь с документами и подтвердите согласие.`,
          {
            parse_mode: "HTML",
            reply_markup: getLegalKeyboard(newUser.id),
          },
        );
        return;
      } catch (error: any) {
        if (error?.code === "P2002") {
          await ctx.reply("Этот логин уже занят.");
          return;
        }
        console.error("[registration] failed", error);
        await ctx.reply("Не удалось завершить регистрацию.");
        return;
      }
    }

    if (
      user?.login.startsWith("tg_") &&
      targetUser.telegramId === null
    ) {
      await attachShadowUserToExistingAccount(
        {
          id: user.id,
          tempReferrerId: user.tempReferrerId,
        },
        {
          id: targetUser.id,
          referredById: targetUser.referredById,
        },
        telegramId,
      );

      await replyWithAuthorizedMenu(ctx, targetUser.login, telegramId);
      return;
    }

    if (!targetUser.telegramId || targetUser.telegramId !== BigInt(telegramId)) {
      await prisma.user.upsert({
        where: { telegramId: BigInt(telegramId) },
        update: { botState: `login_password:${targetUser.id}` },
        create: {
          telegramId: BigInt(telegramId),
          login: `tg_${telegramId}`,
          passwordHash: "shadow",
          referralCode: `ref_${telegramId}`,
          botState: `login_password:${targetUser.id}`,
        },
      });
      await ctx.reply(
        `Аккаунт <b>${escapeHtml(targetUser.login)}</b> найден. Введите пароль для подтверждения привязки.`,
        { parse_mode: "HTML" },
      );
      return;
    }
  }

  if (!user) return;

  const decodedState = decodeBotState(user.botState);
  if (decodedState) {
    if (decodedState.key === "promo_enter_code") {
      const message = await activatePromo(user, text);
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: null },
      });
      await ctx.reply(message);
      return;
    }

    if (decodedState.key === "support_create_description") {
      const subject = String(decodedState.payload.subject || "").trim();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("support_create_confirm", {
            subject,
            description: text,
          }),
        },
      });
      await ctx.reply(formatTicketPreview({ subject, description: text }), {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Подтвердить", callback_data: "support_confirm" }],
            [{ text: "❌ Отклонить", callback_data: "support_cancel" }],
          ],
        },
      });
      return;
    }

    if (decodedState.key === "admin_reply_ticket_preview") {
      return;
    }

    if (decodedState.key === "admin_broadcast_message") {
      const mailingContent = parseMailingDirectives(text);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_broadcast_target", {
            title: String(decodedState.payload.title || ""),
            message: mailingContent.text || text,
            buttonText: mailingContent.buttonText,
            buttonUrl: mailingContent.buttonUrl,
          }),
        },
      });
      await ctx.reply(
        "Выберите получателей рассылки.\n\n" +
          "Кнопку действия можно задать первой строкой текста:\n" +
          "[button:Привязать карту|action:link_card]\n" +
          "[button:Открыть биллинг|action:billing]",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Всем", callback_data: "admin_broadcast_target:all" }],
              [{ text: "👤 Одному пользователю", callback_data: "admin_broadcast_target:user" }],
              [{ text: "🚫 Без подписки", callback_data: "admin_broadcast_target:no_subscription" }],
              [{ text: "⏳ Подписка скоро кончится", callback_data: "admin_broadcast_target:expiring" }],
              [{ text: "💳 Без привязанной карты", callback_data: "admin_broadcast_target:no_card" }],
            ],
          },
        },
      );
      return;
    }

    if (decodedState.key === "admin_broadcast_user") {
      const targetUser = await prisma.user.findFirst({
        where: { login: { equals: text, mode: "insensitive" } },
      });
      if (!targetUser?.telegramId) {
        await ctx.reply("Пользователь не найден или Telegram не привязан.");
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_broadcast_schedule", {
            ...decodedState.payload,
            targetType: "user",
            targetUserIds: [targetUser.id],
            targetLogin: targetUser.login,
          }),
        },
      });
      await ctx.reply(
        "Выберите время отправки.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Отправить сразу", callback_data: "admin_broadcast_schedule:now" }],
              [{ text: "🕒 Запланировать", callback_data: "admin_broadcast_schedule:later" }],
            ],
          },
        },
      );
      return;
    }

    if (decodedState.key === "admin_broadcast_expiring_days") {
      const days = Number(text);
      if (!Number.isInteger(days) || days <= 0 || days > 365) {
        await ctx.reply("Введите целое число дней от 1 до 365.");
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_broadcast_schedule", {
            ...decodedState.payload,
            targetType: `expiring:${days}`,
            targetDays: days,
            buttonText: "Открыть биллинг",
            buttonUrl: "action:billing",
            targetUserIds: [],
          }),
        },
      });
      await ctx.reply(
        "Для этого сегмента по умолчанию будет кнопка `Открыть биллинг`. Выберите время отправки.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Отправить сразу", callback_data: "admin_broadcast_schedule:now" }],
              [{ text: "🕒 Запланировать", callback_data: "admin_broadcast_schedule:later" }],
            ],
          },
        },
      );
      return;
    }

    if (decodedState.key === "admin_broadcast_schedule_input") {
      const scheduledAt = parseScheduleDate(text);
      if (!scheduledAt || scheduledAt <= new Date()) {
        await ctx.reply("Введите будущую дату в формате `ДД.ММ.ГГГГ ЧЧ:ММ`.", {
          parse_mode: "Markdown",
        });
        return;
      }

      const payload: Record<string, unknown> = {
        ...decodedState.payload,
        scheduledAt: scheduledAt.toISOString(),
      };
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: encodeBotState("admin_broadcast_confirm", payload) },
      });

      await ctx.reply(
        `📢 <b>Предпросмотр рассылки</b>\n\n` +
          `<b>Тема:</b> ${escapeHtml(String(payload.title || ""))}\n` +
          `<b>Получатели:</b> ${
            payload.targetType === "user"
              ? escapeHtml(String(payload.targetLogin || ""))
              : escapeHtml(
                  String(payload.targetType || "all")
                    .replace("no_subscription", "без подписки")
                    .replace("no_card", "без привязанной карты")
                    .replace(/^expiring:(\d+)$/, "истекает в течение $1 дн.")
                    .replace("all", "все пользователи"),
                )
          }\n` +
          `<b>Кнопка:</b> ${escapeHtml(
            payload.buttonUrl === "action:link_card"
              ? "Привязать карту"
              : payload.buttonUrl === "action:billing"
                ? "Открыть биллинг"
                : "без кнопки",
          )}\n` +
          `<b>Время:</b> ${escapeHtml(new Date(String(payload.scheduledAt)).toLocaleString("ru-RU"))}\n\n` +
          `${escapeHtml(String(payload.message || ""))}`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Сохранить", callback_data: "admin_broadcast_confirm" }],
              [{ text: "❌ Отменить", callback_data: "admin_broadcast_cancel" }],
            ],
          },
        },
      );
      return;
    }

    if (decodedState.key === "admin_promo_condition_value") {
      const draft = decodedState.payload.draft as any;
      const type = String(decodedState.payload.type || "");
      const nextConditions = [...(draft.conditions || []), { key: type, value: text }];
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_promo_create_conditions", {
            ...draft,
            conditions: nextConditions,
          }),
        },
      });
      await ctx.reply("Условие добавлено.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Добавить условие", callback_data: "admin_promo_conditions_menu" }],
            [{ text: "✅ Подтвердить условия", callback_data: "admin_promo_conditions_done" }],
          ],
        },
      });
      return;
    }

    if (decodedState.key === "admin_promo_effect_value") {
      const draft = decodedState.payload.draft as any;
      const type = String(decodedState.payload.type || "");
      const nextEffects = [...(draft.effects || []), { key: type, value: text }];
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_promo_create_effects", {
            ...draft,
            effects: nextEffects,
          }),
        },
      });
      await ctx.reply("Эффект добавлен.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Добавить эффект", callback_data: "admin_promo_effects_menu" }],
            [{ text: "✅ Завершить создание", callback_data: "admin_promo_preview" }],
          ],
        },
      });
      return;
    }
  }

  if (user.botState) {
    if (user.botState.startsWith("login_password:")) {
      const targetUserId = user.botState.split(":")[1];
      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        await prisma.user.update({ where: { id: user.id }, data: { botState: null } });
        await ctx.reply("Пользователь не найден.");
        return;
      }

      const valid = await bcrypt.compare(text, targetUser.passwordHash);
      if (!valid) {
        await ctx.reply("Неверный пароль. Попробуйте ещё раз.");
        return;
      }

      await prisma.user.update({ where: { id: user.id }, data: { botState: null } });
      await ctx.reply(
        `Пароль верный. Осталось подтвердить документы для аккаунта <b>${escapeHtml(targetUser.login)}</b>.`,
        {
          parse_mode: "HTML",
          reply_markup: getLegalKeyboard(targetUser.id),
        },
      );
      return;
    }

    if (user.botState === "admin_search_user" && telegramId.toString() === ADMIN_ID) {
      const targetUser = await prisma.user.findFirst({
        where: { login: { equals: text, mode: "insensitive" } },
      });
      await prisma.user.update({ where: { id: user.id }, data: { botState: null } });
      if (!targetUser) {
        await ctx.reply("Пользователь не найден.");
        return;
      }
      await ctx.reply(`Пользователь найден: ${targetUser.login}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "👁 Открыть", callback_data: `admin_user_view_${targetUser.id}` }],
          ],
        },
      });
      return;
    }

    if (user.botState.startsWith("admin_edit_balance:") && telegramId.toString() === ADMIN_ID) {
      const targetId = user.botState.split(":")[1];
      const amount = Number(text);
      if (Number.isNaN(amount)) {
        await ctx.reply("Введите корректное число.");
        return;
      }
      await prisma.user.update({ where: { id: user.id }, data: { botState: null } });
      await prisma.user.update({ where: { id: targetId }, data: { balance: amount } });
      await ctx.reply("Баланс обновлён.");
      return;
    }

    if (user.botState.startsWith("admin_edit_refbalance:") && telegramId.toString() === ADMIN_ID) {
      const targetId = user.botState.split(":")[1];
      const amount = Number(text);
      if (Number.isNaN(amount)) {
        await ctx.reply("Введите корректное число.");
        return;
      }
      await prisma.user.update({ where: { id: user.id }, data: { botState: null } });
      await prisma.user.update({
        where: { id: targetId },
        data: { referralBalance: amount },
      });
      await ctx.reply("Реферальный баланс обновлён.");
      return;
    }

    if (user.botState === "admin_find_referrer_for_recovery" && telegramId.toString() === ADMIN_ID) {
      const referrer = await prisma.user.findFirst({
        where: { login: { equals: text, mode: "insensitive" } },
      });
      if (!referrer) {
        await ctx.reply("Пользователь не найден.");
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: `admin_gen_recovery_custom:${referrer.id}` },
      });
      await ctx.reply(
        `Пригласивший найден: ${referrer.login}. Введите код промокода, например RECOVERY_${generatePromoSuffix()}.`,
      );
      return;
    }

    if (user.botState.startsWith("admin_gen_recovery_custom:") && telegramId.toString() === ADMIN_ID) {
      const referrerId = user.botState.split(":")[1];
      const code = text.toUpperCase();
      if (!code.startsWith("RECOVERY_")) {
        await ctx.reply("Код должен начинаться с RECOVERY_.");
        return;
      }

      if (!referrerId) {
        await ctx.reply("Не удалось определить пригласившего.");
        return;
      }
      await createRecoveryPromo(referrerId, code);
      await prisma.user.update({ where: { id: user.id }, data: { botState: null } });
      await ctx.reply(`Recovery-промокод ${code} создан.`);
      return;
    }

    if (user.botState.startsWith("admin_reply_ticket:") && telegramId.toString() === ADMIN_ID) {
      const ticketId = user.botState.split(":")[1];
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_reply_ticket_preview", {
            ticketId,
            message: text,
          }),
        },
      });
      await ctx.reply(
        `💬 <b>Предпросмотр ответа</b>\n\n${escapeHtml(text)}`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Отправить", callback_data: "admin_ticket_reply_confirm" }],
              [{ text: "❌ Отменить", callback_data: "admin_ticket_reply_cancel" }],
            ],
          },
        },
      );
      return;
    }

    if (user.botState === "withdraw_1") {
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: `withdraw_2:${text}` },
      });
      await ctx.reply("Шаг 2/3. Введите название банка.");
      return;
    }

    if (user.botState.startsWith("withdraw_2:")) {
      const target = user.botState.split(":")[1];
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: `withdraw_3:${target}:${text}` },
      });
      await ctx.reply("Шаг 3/3. Введите ФИО получателя.");
      return;
    }

    if (user.botState.startsWith("withdraw_3:")) {
      const [, target = "", bank = ""] = user.botState.split(":");
      const amount = user.referralBalance;
      const request = await prisma.withdrawal.create({
        data: {
          userId: user.id,
          amount,
          target: `${target} (${text})`,
          bank,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { referralBalance: 0, botState: null },
      });
      await ctx.reply(`Заявка на вывод ${amount} ₽ создана. ID: ${request.id}`);
      return;
    }

    if (user.botState === "admin_broadcast_title" && telegramId.toString() === ADMIN_ID) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_broadcast_message", { title: text }),
        },
      });
      await ctx.reply("Введите текст рассылки.");
      return;
    }

    if (user.botState === "admin_promo_create_code" && telegramId.toString() === ADMIN_ID) {
      const code = text.trim().toUpperCase();
      const existing = await prisma.promoCode.findUnique({ where: { code } });
      if (existing) {
        await ctx.reply("Такой промокод уже существует.");
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("admin_promo_create_conditions", {
            code,
            conditions: [],
            effects: [],
          }),
        },
      });
      await ctx.reply(
        `Код ${code} принят. Теперь сформируйте список условий.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Добавить условие", callback_data: "admin_promo_conditions_menu" }],
              [{ text: "✅ Без условий", callback_data: "admin_promo_conditions_done" }],
            ],
          },
        },
      );
      return;
    }

    if (user.botState === "support_create_subject") {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          botState: encodeBotState("support_create_description", {
            subject: text,
          }),
        },
      });
      await ctx.reply("Опишите проблему подробно.");
      return;
    }
  }

  if (text.toLowerCase() === "меню") {
    let keyboard = getMainMenu().reply_markup.inline_keyboard;
    if (telegramId.toString() === ADMIN_ID) {
      keyboard = [...keyboard, [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }]];
    }
    await ctx.reply("Выберите действие:", {
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  if (text.startsWith("/promo ")) {
    const message = await activatePromo(user, text.replace("/promo ", ""));
    await ctx.reply(message);
    return;
  }

  const amountToTopup = Number(text);
  if (!Number.isNaN(amountToTopup) && amountToTopup >= 100 && amountToTopup <= 100000) {
    const sbp = getSbpClient();
    try {
      const payment = await sbp.createSBP({
        amount: amountToTopup * 100,
        merchantId: process.env.TOCHKA_MERCHANT_ID || "",
        accountId: process.env.TOCHKA_ACCOUNT_ID || "",
        description: `Пополнение баланса (User: ${user.login})`,
        qrcType: "DYNAMIC",
        ttl: 30 * 60,
      });

      await prisma.payment.create({
        data: {
          sbpPaymentId: payment.qrcId,
          userId: user.id,
          amount: amountToTopup,
          status: "pending",
          qrUrl: payment.imageBase64 || "",
          sbpUrl: payment.payUrl,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      await ctx.reply(`Сумма к оплате: ${amountToTopup} ₽`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔗 Оплатить через СБП", url: payment.payUrl }],
            [{ text: "🔄 Проверить оплату", callback_data: `check_payment_${payment.qrcId}` }],
          ],
        },
      });
      return;
    } catch (error) {
      console.error("[topup] failed", error);
      await ctx.reply("Не удалось создать счёт на оплату.");
      return;
    }
  }

  if (telegramId.toString() === ADMIN_ID && text.startsWith("/broadcast ")) {
    const mailingText = text.slice("/broadcast ".length);
    const users = await prisma.user.findMany({
      where: { telegramId: { not: null } },
    });
    let success = 0;
    for (const item of users) {
      try {
        await bot.telegram.sendMessage(Number(item.telegramId), mailingText, {
          parse_mode: "HTML",
        });
        success += 1;
      } catch {}
    }
    await ctx.reply(`Рассылка выполнена: ${success}/${users.length}`);
    return;
  }

  await ctx.reply(
    "Не понял сообщение. Используйте меню, отправьте сумму пополнения или выполните текущий шаг сценария.",
  );
}
