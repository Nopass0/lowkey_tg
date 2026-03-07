import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { bot, getMainMenu } from "../utils/bot";
import { handleMenuMain } from "../actions/menus";
import { getSbpClient } from "../utils/sbp";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

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
      if (input.length < 3 || input.length > 24) {
        return ctx.reply(
          "❌ Логин должен содержать от 3 до 24 символов.\n\n" +
            "Если вы пытались войти, проверьте правильность введенного кода привязки.",
        );
      }

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
        return ctx.reply(
          "❌ Логин не может быть email адресом. Придумайте уникальное имя пользователя.",
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(input)) {
        return ctx.reply(
          "❌ Логин может содержать только латинские буквы, цифры и подчеркивания без пробелов.",
        );
      }

      const tempPassword = crypto.randomBytes(4).toString("hex");
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const referralCode = crypto.randomBytes(5).toString("hex");

      try {
        const newUser = await prisma.$transaction(async (tx) => {
          // Check for shadow user
          const shadowUser = await tx.user.findUnique({
            where: { telegramId: BigInt(telegramId) },
          });

          const finalReferredById = shadowUser?.tempReferrerId || null;

          // If shadow user exists, we need to handle the unique login constraint
          // If the shadow user's login is the temporary one, we can update it.
          // Otherwise, we create a new one.
          if (shadowUser && shadowUser.login.startsWith("tg_")) {
            return await tx.user.update({
              where: { id: shadowUser.id },
              data: {
                login: input,
                passwordHash: passwordHash,
                referralCode: referralCode,
                referredById: finalReferredById,
                tempReferrerId: null, // Clear temp
              },
            });
          }

          return await tx.user.create({
            data: {
              login: input,
              passwordHash: passwordHash,
              referralCode: referralCode,
              telegramId: BigInt(telegramId),
              referredById: finalReferredById,
            },
          });
        });

        return ctx.reply(
          `🎉 **Аккаунт ${newUser.login} успешно создан!**\n\n` +
            `Мы сгенерировали для вас пароль для доступа в личный кабинет на сайте:\n` +
            `🔑 **Пароль:** \`${tempPassword}\`\n\n` +
            `*(Вы сможете изменить его позже)*\n\n` +
            `Для завершения регистрации и привязки Telegram, пожалуйста, ознакомьтесь с нашей Офертой и Политикой конфиденциальности.`,
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
                    text: "✅ Принять и войти",
                    callback_data: `legal_accept_all:${newUser.id}`,
                  },
                ],
              ],
            },
            parse_mode: "Markdown",
          },
        );
      } catch (err: any) {
        if (err.code === "P2002") {
          return ctx.reply(
            "❌ Этот логин уже занят или код привязки недействителен. Пожалуйста, попробуйте другой логин.",
          );
        }
        console.error("Registration error:", err);
        return ctx.reply(
          "❌ Произошла ошибка при регистрации. Попробуйте позже.",
        );
      }
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

    // Admin: Find Referrer for Recovery Promo (from main menu)
    if (
      state === "admin_find_referrer_for_recovery" &&
      telegramId.toString() === ADMIN_ID
    ) {
      const targetUser = await prisma.user.findFirst({
        where: { login: { equals: text.trim(), mode: "insensitive" } },
      });

      if (!targetUser) {
        return ctx.reply(`❌ Пользователь с логином "${text}" не найден.`);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { botState: `admin_gen_recovery_custom:${targetUser.id}` },
      });

      return ctx.reply(
        `👤 **Пригласитель найден: ${targetUser.login}**\n\n` +
          `Теперь введите желаемое название для промокода (обязательно должно начинаться с \`RECOVERY_\`):`,
        { parse_mode: "Markdown" },
      );
    }

    // Admin: Generate Custom Recovery Promo
    if (
      state.startsWith("admin_gen_recovery_custom:") &&
      telegramId.toString() === ADMIN_ID
    ) {
      const referrerId = state.split(":")[1];
      const promoName = text.trim();

      await prisma.user.update({
        where: { id: user.id },
        data: { botState: null },
      });

      if (!promoName.toUpperCase().startsWith("RECOVERY_")) {
        return ctx.reply(
          "❌ Название промокода должно начинаться с `RECOVERY_` (например, `RECOVERY_IVAN`).",
          { parse_mode: "Markdown" },
        );
      }

      // Check if code exists
      const existing = await prisma.promoCode.findUnique({
        where: { code: promoName },
      });
      if (existing) return ctx.reply("❌ Такой промокод уже существует.");

      const referrer = await prisma.user.findUnique({
        where: { id: referrerId },
      });
      if (!referrer) return ctx.reply("❌ Пригласитель не найден.");

      await prisma.promoCode.create({
        data: {
          code: promoName,
          maxActivations: 1, // Single-use for one "lost" referral
          conditions: [],
          effects: [
            { key: "referrer_id", value: referrerId },
            { key: "add_balance", value: "100" },
          ],
        },
      });

      return ctx.reply(
        `✅ **Recovery-промо создан!**\n\n` +
          `Code: \`${promoName}\`\n` +
          `При приглашении привяжет к: **${referrer.login}**\n` +
          `Бонус: **100 ₽**\n\n` +
          `Отправьте этот код рефералу.`,
        { parse_mode: "Markdown" },
      );
    }

    // Admin: Edit Referral Balance
    if (
      state.startsWith("admin_edit_refbalance:") &&
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
        data: { referralBalance: amount },
      });

      return ctx.reply(
        `✅ РЕФЕРАЛЬНЫЙ баланс пользователя **${updated.login}** изменен на **${amount} ₽**`,
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
  const safeAdminId = ADMIN_ID || "";
  if (text.toLowerCase() === "меню") {
    let kb = getMainMenu().reply_markup.inline_keyboard;
    if (user && telegramId.toString() === safeAdminId) {
      kb = [...kb, [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }]];
    }
    return ctx.reply("Выберите действие в меню:", {
      reply_markup: { inline_keyboard: kb },
    });
  }

  if (text.startsWith("/broadcast ") && telegramId.toString() === safeAdminId) {
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

  if (
    text.startsWith("/create_promo ") &&
    telegramId.toString() === safeAdminId
  ) {
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
    let balanceAdded = 0;
    const effects = promo.effects as any[];
    for (const effect of effects) {
      if (effect.key === "set_referral_rate") {
        await prisma.user.update({
          where: { id: user.id },
          data: { referralRate: parseFloat(effect.value) },
        });
      }
      if (effect.key === "add_balance") {
        const amount = parseFloat(effect.value);
        if (!isNaN(amount) && amount > 0) {
          balanceAdded += amount;
          await prisma.user.update({
            where: { id: user.id },
            data: { balance: { increment: amount } },
          });
          await prisma.transaction.create({
            data: {
              userId: user.id,
              type: "promo_topup",
              amount: amount,
              title: `Активация промокода ${code}`,
            },
          });
        }
      }
      if (effect.key === "referrer_id") {
        if (!user.referredById) {
          const referrerId = effect.value;
          const referrer = await prisma.user.findUnique({
            where: { id: referrerId },
          });

          if (referrer) {
            // Find all past successful payments of this user
            const pastPayments = await prisma.payment.findMany({
              where: { userId: user.id, status: "success" },
            });

            const totalAmount = pastPayments.reduce((s, p) => s + p.amount, 0);
            const totalCommission = totalAmount * referrer.referralRate;

            await prisma.user.update({
              where: { id: user.id },
              data: { referredById: referrerId },
            });

            if (totalCommission > 0) {
              await prisma.user.update({
                where: { id: referrerId },
                data: { referralBalance: { increment: totalCommission } },
              });

              await prisma.transaction.create({
                data: {
                  userId: referrerId,
                  type: "referral_commission",
                  amount: totalCommission,
                  title: `Ретроактивный бонус за реферала ${user.login} (${totalAmount} ₽)`,
                },
              });

              // Notify referrer if possible
              if (referrer.telegramId) {
                try {
                  await bot.telegram.sendMessage(
                    Number(referrer.telegramId),
                    `🤝 **Реферальное восстановление!**\n\n` +
                      `Ваш партнер **${user.login}** успешно привязан к вам.\n` +
                      `Вам начислено **${totalCommission.toFixed(2)} ₽** комиссии за его прошлые пополнения!`,
                    { parse_mode: "Markdown" },
                  );
                } catch {}
              }
            }
          }
        }
      }
    }

    await prisma.promoActivation.create({
      data: { userId: user.id, promoCodeId: promo.id },
    });

    if (balanceAdded > 0) {
      return ctx.reply(
        `✅ Промокод **${code}** успешно активирован!\n\nНа ваш баланс начислено **${balanceAdded} ₽**.`,
      );
    } else {
      return ctx.reply(`✅ Промокод **${code}** успешно активирован!`);
    }
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
      const payment = await sbp.createSBP({
        amount: amountToTopup * 100, // В копейках
        merchantId: process.env.TOCHKA_MERCHANT_ID || "",
        accountId: process.env.TOCHKA_ACCOUNT_ID || "",
        description: `Пополнение баланса (User: ${user!.login})`,
        qrcType: "DYNAMIC",
        ttl: 30 * 60, // 30 минут
      });

      await prisma.payment.create({
        data: {
          sbpPaymentId: payment.qrcId,
          userId: user!.id,
          amount: amountToTopup,
          status: "pending",
          qrUrl: payment.imageBase64 || "", // Сохраняем QR картинку если есть
          sbpUrl: payment.payUrl,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
        },
      });

      return ctx.reply(
        `💳 **Сумма к пополнению: ${amountToTopup} ₽**\n\nДля оплаты перейдите по ссылке (СБП):`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔗 Оплатить через СБП", url: payment.payUrl }],
              [
                {
                  text: "🔄 Проверить оплату",
                  callback_data: `check_payment_${payment.qrcId}`,
                },
              ],
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
