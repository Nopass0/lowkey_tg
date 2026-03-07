import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { getMainMenu } from "../utils/bot";

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

      return ctx.reply(welcomeText, { parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("[handleStart] Critical error:", err);
    return ctx.reply(
      "❌ Произошла ошибка. Пожалуйста, попробуйте еще раз отправив /start",
    );
  }
}
