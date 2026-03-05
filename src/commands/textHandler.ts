import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { bot, getMainMenu } from "../utils/bot";
import { handleMenuMain } from "../actions/menus";
import { getSbpClient } from "../utils/sbp";

export async function handleTextMessage(ctx: Context) {
  if (!ctx.message || !("text" in ctx.message)) return;

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  const text = ctx.message.text.trim();
  const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

  // 1. Handling users NOT linked to Telegram
  if (!user) {
    const input = text;
    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [{ login: input }, { telegramLinkCode: input }],
      },
    });

    if (!targetUser) {
      return ctx.reply(
        "👋 Добро пожаловать в Lowkey VPN!\n\n" +
          "Для начала использования, пожалуйста, пришлите ваш **логин** или **код привязки** из личного кабинета на сайте.\n\n" +
          "Если у вас еще нет аккаунта, просто введите желаемый логин для регистрации.",
      );
    }

    if (targetUser.telegramId && targetUser.telegramId !== BigInt(telegramId)) {
      return ctx.reply("❌ Этот аккаунт уже привязан к другому Telegram.");
    }

    // Instead of linking immediately, show legal agreement
    return ctx.reply(
      `🔍 Аккаунт **${targetUser.login}** найден!\n\n` +
        "Для продолжения вам необходимо ознакомиться и согласиться с нашей Офертой и Политикой конфиденциальности.\n\n" +
        "Нажимая кнопку «Принять и привязать», вы подтверждаете свое согласие с условиями.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📜 Публичная оферта", callback_data: "legal_offer" }],
            [
              {
                text: "🔒 Политика конфиденциальности",
                callback_data: "legal_privacy",
              },
            ],
            [
              {
                text: "✅ Принять и привязать",
                callback_data: `legal_accept_all:${targetUser.id}`,
              },
            ],
          ],
        },
        parse_mode: "Markdown",
      },
    );
  }

  // 2. Handling users ALREADY linked (State-based)
  if (user && user.botState) {
    const state = user.botState;

    // Admin: Search User
    if (state === "admin_search_user" && telegramId.toString() === ADMIN_ID) {
      const targetUser = await prisma.user.findFirst({
        where: { login: { equals: text, mode: "insensitive" } },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: null },
      });
      if (!targetUser) return ctx.reply(`❌ Пользователь "${text}" не найден.`);

      return ctx.reply(`🔍 Пользователь найден: **${targetUser.login}**`, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "👁 Перейти в профиль",
                callback_data: `admin_user_view_${targetUser.id}`,
              },
            ],
          ],
        },
        parse_mode: "Markdown",
      });
    }

    // Admin: Edit Balance
    if (
      state.startsWith("admin_edit_balance:") &&
      telegramId.toString() === ADMIN_ID
    ) {
      const targetId = state.split(":")[1];
      const amount = parseFloat(text);
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: null },
      });

      if (isNaN(amount)) return ctx.reply("❌ Введите корректное число.");

      const updated = await prisma.user.update({
        where: { id: targetId },
        data: { balance: amount },
      });

      return ctx.reply(
        `✅ Баланс пользователя **${updated.login}** изменен на **${amount} ₽**`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "◀️ Вернуться к профилю",
                  callback_data: `admin_user_view_${targetId}`,
                },
              ],
            ],
          },
          parse_mode: "Markdown",
        },
      );
    }

    // Admin: Reply to Support Ticket
    if (
      state.startsWith("admin_reply_ticket:") &&
      telegramId.toString() === ADMIN_ID
    ) {
      const ticketId = state.split(":")[1];
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { user: true },
      });
      if (!ticket) return ctx.reply("❌ Тикет не найден.");

      await prisma.supportTicket.update({
        where: { id: ticketId },
        data: { reply: text, status: "replied" },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { botState: null },
      });

      try {
        await bot.telegram.sendMessage(
          Number(ticket.user.telegramId),
          `💬 **Ответ от поддержки:**\n\n${text}`,
          { parse_mode: "Markdown" },
        );
      } catch {}

      return ctx.reply("✅ Ответ отправлен пользователю.");
    }

    // Admin: Broadcast
    if (state === "admin_broadcast" && telegramId.toString() === ADMIN_ID) {
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: null },
      });

      const users = await prisma.user.findMany({
        where: { telegramId: { not: null } },
      });

      let success = 0;
      for (const u of users) {
        try {
          await bot.telegram.sendMessage(Number(u.telegramId), text, {
            parse_mode: "Markdown",
          });
          success++;
        } catch {}
      }
      return ctx.reply(
        `📢 Рассылка завершена. Успешно: ${success}/${users.length}`,
      );
    }

    // User: Withdrawal Flow
    if (state === "withdraw_1") {
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: `withdraw_2:${text}` },
      });
      return ctx.reply(
        "🏦 Шаг 2/3: Введите название вашего банка (например, Сбербанк, Тинькофф):",
      );
    }

    if (state.startsWith("withdraw_2:")) {
      const card = state.split(":")[1];
      await prisma.user.update({
        where: { id: user.id },
        data: { botState: `withdraw_3:${card}:${text}` },
      });
      return ctx.reply("👤 Шаг 3/3: Введите ваше ФИО получателя:");
    }

    if (state.startsWith("withdraw_3:")) {
      const parts = state.split(":");
      const card = parts[1];
      const bank = parts[2];
      const fio = text;
      const amount = user.referralBalance;

      const request = await prisma.withdrawal.create({
        data: {
          userId: user.id,
          amount,
          target: `${card} (${fio})`,
          bank,
          status: "pending",
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { referralBalance: 0, botState: null },
      });

      await ctx.reply(
        `✅ **Заявка на вывод создана!**\n\n` +
          `Сумма: **${amount} ₽**\n` +
          `Реквизиты: ${card}\n` +
          `Банк: ${bank}\n` +
          `Получатель: ${fio}\n\n` +
          `Ожидайте обработки администратором.`,
        { parse_mode: "Markdown" },
      );

      if (ADMIN_ID) {
        bot.telegram
          .sendMessage(
            ADMIN_ID,
            `💸 **Новая заявка на вывод:**\n` +
              `Пользователь: ${user.login}\n` +
              `Сумма: ${amount} ₽\n` +
              `Реквизиты: ${card}\n` +
              `Банк: ${bank}\n` +
              `ФИО: ${fio}\n` +
              `ID: \`${request.id}\``,
            { parse_mode: "Markdown" },
          )
          .catch(() => {});
      }
      return;
    }
  }

  // 3. Command & Numeric Parsing
  if (text.startsWith("/broadcast ") && telegramId.toString() === ADMIN_ID) {
    const broadcastText = text.replace("/broadcast ", "");
    const users = await prisma.user.findMany({
      where: { telegramId: { not: null } },
    });
    let success = 0;
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(Number(u.telegramId), broadcastText, {
          parse_mode: "Markdown",
        });
        success++;
      } catch {}
    }
    return ctx.reply(
      `📢 Рассылка завершена. Успешно: ${success}/${users.length}`,
    );
  }

  if (text.startsWith("/create_promo ") && telegramId.toString() === ADMIN_ID) {
    const parts = text.split(" ");
    if (parts.length < 4)
      return ctx.reply("❌ Формат: `/create_promo <rate_0.XX> <CODE> <limit>`");
    let rate = parseFloat(parts[1]);
    const code = parts[2].toUpperCase();
    const limit = parseInt(parts[3]);

    if (isNaN(rate) || isNaN(limit)) return ctx.reply("❌ Некорректные числа.");

    // Smart rate detection: 30 -> 0.3, but 0.3 stays 0.3
    if (rate >= 1) rate = rate / 100;

    await prisma.promoCode.create({
      data: {
        code,
        maxActivations: limit,
        conditions: [],
        effects: [{ key: "set_referral_rate", value: rate.toString() }],
      },
    });
    return ctx.reply(
      `✅ Промокод **${code}** создан. Реф. ставка: **${rate * 100}%**`,
    );
  }

  if (text.startsWith("/promo ")) {
    const code = text.replace("/promo ", "").trim().toUpperCase();
    const promo = await prisma.promoCode.findUnique({ where: { code } });
    if (!promo) return ctx.reply("❌ Промокод не найден.");

    const activation = await prisma.promoActivation.findUnique({
      where: { userId_promoCodeId: { userId: user.id, promoCodeId: promo.id } },
    });
    if (activation) return ctx.reply("❌ Вы уже активировали этот промокод.");

    const count = await prisma.promoActivation.count({
      where: { promoCodeId: promo.id },
    });
    if (promo.maxActivations && count >= promo.maxActivations)
      return ctx.reply("❌ Лимит активаций исчерпан.");

    // Apply effects
    const effects = promo.effects as any[];
    for (const effect of effects) {
      if (effect.key === "set_referral_rate") {
        await prisma.user.update({
          where: { id: user.id },
          data: { referralRate: parseFloat(effect.value) },
        });
      }
    }

    await prisma.promoActivation.create({
      data: { userId: user.id, promoCodeId: promo.id },
    });

    return ctx.reply(`✅ Промокод **${code}** успешно активирован!`);
  }

  // Handle number input (Topup balance)
  const amountToTopup = parseFloat(text);
  if (
    !isNaN(amountToTopup) &&
    amountToTopup >= 100 &&
    amountToTopup <= 100000
  ) {
    const sbp = getSbpClient();
    try {
      const { sbp_link, bill_id } = await sbp.createInvoice({
        amount: amountToTopup,
        merchant_id: process.env.TOCHKA_MERCHANT_ID || "",
        account_id: process.env.TOCHKA_ACCOUNT_ID || "",
        callback_url: `${process.env.BACKEND_URL}/api/payments/callback`,
        metadata: { userId: user.id },
      });

      await prisma.payment.create({
        data: {
          sbpPaymentId: bill_id,
          userId: user.id,
          amount: amountToTopup,
          status: "pending",
          qrUrl: "", // Optional in schema but let's provide empty
          sbpUrl: sbp_link,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
        },
      });

      return ctx.reply(
        `💳 **Сумма к пополнению: ${amountToTopup} ₽**\n\nДля оплаты перейдите по ссылке (СБП):`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔗 Оплатить через СБП", url: sbp_link }],
            ],
          },
          parse_mode: "Markdown",
        },
      );
    } catch (err) {
      console.error("Topup error:", err);
      return ctx.reply("❌ Ошибка при создании счета. Попробуйте позже.");
    }
  }

  return ctx.reply(
    "❓ Я вас не понимаю. Используйте меню или введите корректное число для пополнения.",
  );
}
