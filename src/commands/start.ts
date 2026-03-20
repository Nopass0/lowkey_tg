import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { getMainMenu } from "../utils/bot";
import { resolveMailingActionStart } from "../utils/mailings";

export async function handleStart(ctx: Context) {
  console.log(`[handleStart] User: ${ctx.from?.id}`);
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    const startPayload = (ctx as any).startPayload || "";
    let referrerId: string | null = null;

    if (startPayload) {
      if (startPayload.startsWith("ml_")) {
        const token = startPayload.slice(3);
        const actionResult = await resolveMailingActionStart(token, BigInt(telegramId));
        if (!actionResult) {
          await ctx.reply("Ссылка из рассылки устарела или не найдена.");
          return;
        }

        const buttonText =
          actionResult.action.actionType === "link_card"
            ? "Привязать карту"
            : actionResult.action.actionType === "billing"
              ? "Открыть биллинг"
              : actionResult.action.actionType === "promo_subscribe"
                ? "Оформить акционную подписку"
                : "Открыть ссылку";

        await ctx.reply("Подготовил ссылку по кнопке из рассылки.", {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url(buttonText, actionResult.url)],
          ]).reply_markup,
        });
        return;
      }

      const refCode = startPayload.replace(/^ref_/, "");
      // Search for both the plain code and the one with ref_ prefix
      const referrer = await prisma.user.findFirst({
        where: {
          OR: [{ referralCode: refCode }, { referralCode: `ref_${refCode}` }],
        },
        select: { id: true, login: true },
      });

      if (referrer) {
        referrerId = referrer.id;
        console.log(
          `[handleStart] Found referrer: ${referrer.login} (${referrer.id})`,
        );
      } else {
        console.log(`[handleStart] Referrer not found for code: ${refCode}`);
      }
    }

    if (user && !user.login.startsWith("tg_")) {
      console.log(`[handleStart] Existing real user: ${user.login}`);
      // If user exists and is real, we might want to update their referrer if they don't have one
      if (!user.referredById && referrerId && user.id !== referrerId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { referredById: referrerId },
        });
        console.log(`[handleStart] Updated referredById to ${referrerId}`);
      }

      let kb = getMainMenu().reply_markup.inline_keyboard;
      if (
        telegramId.toString() === process.env.TELEGRAM_ADMIN_CHAT_ID?.trim()
      ) {
        kb = [
          ...kb,
          [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }],
        ];
      }

      await ctx.reply(
        `Добро пожаловать, <b>${user.login}</b>! 👋\nВаш VPN профиль активен. Вы можете использовать кнопку внизу для вызова меню.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "Меню" }]],
            resize_keyboard: true,
          },
        },
      );

      return ctx.reply("Выберите действие в меню:", {
        reply_markup: { inline_keyboard: kb },
      });
    } else {
      console.log(`[handleStart] New or shadow user`);
      let welcomeText =
        "Привет! Я бот Lowkey VPN. 🛡️\n\n" +
        "Для начала использования VPN, пожалуйста, отправьте мне желаемый <b>логин</b> (от 3 до 24 символов).\n\n" +
        "Если аккаунт с таким логином уже существует, вы привяжете его. Иначе мы создадим для вас новый профиль.";

      if (referrerId) {
        const referrer = await prisma.user.findUnique({
          where: { id: referrerId },
          select: { login: true },
        });
        welcomeText =
          `👋 Привет! Вы пришли по приглашению от <b>${referrer?.login || "партнера"}</b>.\n\n` +
          welcomeText;
      }

      // Persist or update the shadow user state
      // We use telegramId as the primary key for the bot session.
      // If we can't create a shadow user due to login collision, we try to find it.
      try {
        await prisma.user.upsert({
          where: { telegramId: BigInt(telegramId) },
          update: { tempReferrerId: referrerId },
          create: {
            telegramId: BigInt(telegramId),
            login: `tg_${telegramId}`,
            passwordHash: "shadow",
            referralCode: `ref_${telegramId}`,
            tempReferrerId: referrerId,
          },
        });
      } catch (err: any) {
        if (err.code === "P2002" && err.meta?.target?.includes("login")) {
          // If login conflicts, it means a record with tg_ID already exists but without this TG ID.
          // This shouldn't happen normally, but we handle it by updating that record instead.
          await prisma.user.update({
            where: { login: `tg_${telegramId}` },
            data: {
              telegramId: BigInt(telegramId),
              tempReferrerId: referrerId,
            },
          });
        } else {
          throw err;
        }
      }

      return ctx.reply(welcomeText, { parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("[handleStart] Critical error:", err);
    return ctx.reply(
      "❌ Произошла ошибка. Пожалуйста, попробуйте еще раз отправив /start",
    );
  }
}
