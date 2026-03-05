import { Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { getMainMenu, bot } from "../utils/bot";
import crypto from "crypto";
import { hash } from "bcryptjs";
import { getSbpClient } from "../utils/sbp";
import { handleCreateReferralPromo } from "../actions/adminPromo";

function generateReferralCode(login: string): string {
  const prefix = login.toUpperCase().slice(0, 8);
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}${suffix}`;
}

export async function handleTextMessage(
  ctx: Context,
  next: () => Promise<void>,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !("text" in ctx.message!)) return next();

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  const text = ctx.message.text.trim();

  // If user is not linked, interpret input as login or link code
  if (!user) {
    const input = text;

    // Check if input might be a link code
    const userByCode = await prisma.user.findFirst({
      where: { telegramLinkCode: input } as any,
    });

    if (userByCode && input.length >= 6) {
      if (
        (userByCode as any).telegramLinkCodeExpiresAt &&
        (userByCode as any).telegramLinkCodeExpiresAt < new Date()
      ) {
        return ctx.reply(
          "❌ Код привязки истек. Пожалуйста, сгенерируйте новый на сайте.",
        );
      }

      await prisma.user.update({
        where: { id: userByCode.id },
        data: {
          telegramId: BigInt(telegramId),
          telegramLinkCode: null,
          telegramLinkCodeExpiresAt: null,
        } as any,
      });

      let kb = getMainMenu().reply_markup.inline_keyboard;
      if (telegramId.toString() === process.env.ADMIN_TG_ID) {
        kb = [
          ...kb,
          [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }],
        ];
      }

      return ctx.reply(
        `✅ Успешно! Существующий аккаунт **${userByCode.login}** привязан к вашему Telegram.\n\n` +
          `При авторизации на сайте используйте этот логин, и код подтверждения придет сюда.`,
        { reply_markup: { inline_keyboard: kb } },
      );
    }

    // It's not a link code, try registering as a new login
    const login = input;
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(login)) {
      return ctx.reply(
        "❌ Отправьте желаемый логин для регистрации (от 3 до 24 символов) ИЛИ код привязки для существующего аккаунта из Личного Кабинета на сайте.",
      );
    }

    const userByLogin = await prisma.user.findUnique({
      where: { login },
    });

    if (userByLogin) {
      return ctx.reply(
        "❌ Этот логин уже существует.\n\nЧтобы привязать его, пожалуйста, сгенерируйте код привязки в Личном Кабинете на сайте и отправьте его сюда.",
      );
    } else {
      const passwordHash = await hash(
        crypto.randomBytes(32).toString("hex"),
        10,
      );
      let refCode = generateReferralCode(login);
      while (
        await prisma.user.findUnique({ where: { referralCode: refCode } })
      ) {
        refCode = generateReferralCode(login);
      }

      const newUser = await prisma.user.create({
        data: {
          login,
          passwordHash,
          telegramId: BigInt(telegramId),
          referralCode: refCode,
        },
      });

      let kb = getMainMenu().reply_markup.inline_keyboard;
      if (telegramId.toString() === process.env.ADMIN_TG_ID) {
        kb = [
          ...kb,
          [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }],
        ];
      }

      return ctx.reply(
        `✅ Аккаунт **${newUser.login}** успешно создан!\n\n` +
          `При авторизации на сайте используйте этот логин, и код подтверждения придет сюда.`,
        { reply_markup: { inline_keyboard: kb } },
      );
    }
  }

  // Admin Broadcast
  if (
    text.startsWith("/broadcast ") &&
    telegramId.toString() === process.env.ADMIN_TG_ID
  ) {
    const msg = text.replace("/broadcast ", "");
    const users = await prisma.user.findMany({
      where: { telegramId: { not: null } },
    });
    let count = 0;
    for (const u of users) {
      if (!u.telegramId) continue;
      try {
        await bot.telegram.sendMessage(
          u.telegramId.toString(),
          "📢 **Объявление:**\n\n" + msg,
          { parse_mode: "Markdown" },
        );
        count++;
      } catch (e) {}
    }
    return ctx.reply(
      `✅ Рассылка завершена. Отправлено ${count} пользователям.`,
    );
  }

  // Admin Create Referral Promo
  if (
    text.startsWith("/create_promo ") &&
    telegramId.toString() === process.env.ADMIN_TG_ID
  ) {
    return handleCreateReferralPromo(ctx);
  }

  // Admin Reply Ticket
  if (
    text.startsWith("/reply ") &&
    telegramId.toString() === process.env.ADMIN_TG_ID
  ) {
    const parts = text.split(" ");
    if (parts.length < 3)
      return ctx.reply("Формат: /reply <ticket_id> <сообщение>");
    const tId = parts[1];
    const msg = text.replace(`/reply ${tId} `, "");

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: tId },
      include: { user: true },
    });
    if (!ticket) return ctx.reply("❌ Тикет не найден.");

    await prisma.supportTicket.update({
      where: { id: tId },
      data: { status: "replied", reply: msg },
    });
    if (ticket.user.telegramId) {
      try {
        await bot.telegram.sendMessage(
          ticket.user.telegramId.toString(),
          `💬 **Ответ поддержки на ваш вопрос:**\n\n${msg}`,
          { parse_mode: "Markdown" },
        );
      } catch (e) {}
    }
    return ctx.reply("✅ Ответ отправлен.");
  }

  // Admin Approve Withdrawal
  if (
    text.startsWith("/approve ") &&
    telegramId.toString() === process.env.ADMIN_TG_ID
  ) {
    const wId = text.replace("/approve ", "").trim();
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: wId },
      include: { user: true },
    });
    if (!withdrawal) return ctx.reply("❌ Заявка не найдена.");
    if (withdrawal.status !== "pending")
      return ctx.reply("❌ Заявка уже обработана.");

    await prisma.withdrawal.update({
      where: { id: wId },
      data: { status: "approved", processedAt: new Date() },
    });

    if (withdrawal.user.telegramId) {
      try {
        await bot.telegram.sendMessage(
          withdrawal.user.telegramId.toString(),
          `✅ **Ваша заявка на вывод (${withdrawal.amount} ₽) одобрена!**\nСредства будут отправлены в ближайшее время.`,
          { parse_mode: "Markdown" },
        );
      } catch (e) {}
    }
    return ctx.reply(`✅ Заявка ${wId} одобрена.`);
  }

  // Admin Reject Withdrawal
  if (
    text.startsWith("/reject ") &&
    telegramId.toString() === process.env.ADMIN_TG_ID
  ) {
    const parts = text.split(" ");
    if (parts.length < 3)
      return ctx.reply("Формат: /reject <withdrawal_id> <причина>");
    const wId = parts[1];
    const reason = text.replace(`/reject ${wId} `, "");

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: wId },
      include: { user: true },
    });
    if (!withdrawal) return ctx.reply("❌ Заявка не найдена.");
    if (withdrawal.status !== "pending")
      return ctx.reply("❌ Заявка уже обработана.");

    // Refund user referral balance
    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id: wId },
        data: { status: "rejected", processedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: withdrawal.userId },
        data: { referralBalance: { increment: withdrawal.amount } },
      }),
    ]);

    if (withdrawal.user.telegramId) {
      try {
        await bot.telegram.sendMessage(
          withdrawal.user.telegramId.toString(),
          `❌ **Ваша заявка на вывод (${withdrawal.amount} ₽) отклонена.**\nПричина: ${reason}\n\nСредства возвращены на ваш реферальный баланс.`,
          { parse_mode: "Markdown" },
        );
      } catch (e) {}
    }
    return ctx.reply(`❌ Заявка ${wId} отклонена, средства возвращены.`);
  }

  // Support Ticket creation
  if (text.startsWith("/support ")) {
    const msg = text.replace("/support ", "");
    const ticket = await prisma.supportTicket.create({
      data: { userId: user.id, message: msg },
    });

    // Notify admin
    if (process.env.ADMIN_TG_ID) {
      try {
        await bot.telegram.sendMessage(
          process.env.ADMIN_TG_ID,
          `🚨 **Новый тикет:**\nПользователь: ${user.login}\nСообщение: ${msg}\nДля ответа: \`/reply ${ticket.id} текст\``,
          { parse_mode: "Markdown" },
        );
      } catch (e) {}
    }

    return ctx.reply(
      "✅ Ваше обращение отправлено в поддержку. Мы ответим вам в этом боте.",
    );
  }

  // Promo Code
  if (text.startsWith("/promo ")) {
    const code = text.replace("/promo ", "").toUpperCase();
    const promo = await prisma.promoCode.findUnique({ where: { code } });
    if (!promo) return ctx.reply("❌ Промокод не найден.");

    const exists = await prisma.promoActivation.findUnique({
      where: { userId_promoCodeId: { userId: user.id, promoCodeId: promo.id } },
    });
    if (exists) return ctx.reply("❌ Вы уже активировали этот промокод.");

    if (promo.maxActivations !== null) {
      const activationsCount = await prisma.promoActivation.count({
        where: { promoCodeId: promo.id },
      });
      if (activationsCount >= promo.maxActivations) {
        return ctx.reply(
          "❌ Этот промокод больше не действителен (достигнут лимит активаций).",
        );
      }
    }

    try {
      // Apply effects
      const effects = promo.effects as any[];
      let replyMsg = `✅ Промокод ${code} успешно активирован!\n\n`;

      for (const eff of effects) {
        if (eff.key === "add_balance") {
          const amount = Number(eff.value);
          await prisma.user.update({
            where: { id: user.id },
            data: { balance: { increment: amount } },
          });
          replyMsg += `• Ваш баланс пополнен на ${amount} ₽\n`;
        } else if (eff.key === "plan_discount_pct") {
          const pct = Number(eff.value);
          await prisma.user.update({
            where: { id: user.id },
            data: { pendingDiscountPct: pct },
          });
          replyMsg += `• Ваша скидка на следующую подписку составит ${pct}%\n`;
        } else if (eff.key === "plan_discount_fixed") {
          const fixed = Number(eff.value);
          await prisma.user.update({
            where: { id: user.id },
            data: { pendingDiscountFixed: fixed },
          });
          replyMsg += `• Ваша скидка на следующую подписку составит ${fixed} ₽\n`;
        } else if (eff.key === "set_referral_rate") {
          const rate = Number(eff.value);
          await prisma.user.update({
            where: { id: user.id },
            data: { referralRate: rate },
          });
          replyMsg += `• Ваш реферальный процент теперь составляет **${rate * 100}%**! 🤝\n`;
        }
      }

      await prisma.promoActivation.create({
        data: { userId: user.id, promoCodeId: promo.id },
      });

      return ctx.reply(replyMsg);
    } catch (err) {
      console.error(err);
      return ctx.reply("❌ Ошибка при активации промокода.");
    }
  }

  // Top-up SBP Generation
  if (/^\d{2,6}$/.test(text)) {
    const amount = parseInt(text);
    if (amount < 100 || amount > 100000) {
      return ctx.reply("❌ Сумма должна быть от 100 до 100 000 ₽");
    }

    // Call Tochka SBP API
    try {
      const sbp = getSbpClient();
      const qr = await sbp.createSBP({
        merchantId: process.env.TOCHKA_MERCHANT_ID || "",
        accountId: process.env.TOCHKA_ACCOUNT_ID || "",
        amount: amount * 100, // API expects kopecks
        description: "Пополнение баланса VPN",
      });

      const payment = await prisma.payment.create({
        data: {
          userId: user.id,
          sbpPaymentId: qr.qrcId,
          amount,
          status: "pending",
          qrUrl: qr.payload, // Assuming payload contains the QR URL or we might want to generate QR from payload
          sbpUrl: qr.payload,
          expiresAt: new Date(Date.now() + 30 * 60000), // +30 minutes
        },
      });

      return ctx.reply(
        `💳 Вы запросили пополнение на **${amount} ₽**.\n\n` +
          `Отсканируйте код или перейдите по ссылке для оплаты:\n\`${qr.payload}\`\n\n` +
          `Нажмите оплатить, чтобы перейти в банковское приложение.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Оплатить (СБП)", url: qr.payload }],
              [
                {
                  text: "✅ Я оплатил (Проверить)",
                  callback_data: `check_payment_${payment.id}`,
                },
              ],
            ],
          },
        },
      );
    } catch (err) {
      console.error("[Bot] SBP create error:", err);
      return ctx.reply(
        "❌ Ошибка при создании заявки на оплату. Повторите попытку позже.",
      );
    }
  }

  return next();
}
