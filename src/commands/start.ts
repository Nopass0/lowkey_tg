import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { getMainMenu } from "../utils/bot";

export async function handleStart(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  // Extract referral code from /start payload (e.g. /start ref_abc123)
  const startPayload = (ctx as any).startPayload || "";
  let referrerId: string | null = null;

  if (startPayload) {
    // Try both with and without "ref_" prefix
    const refCode = startPayload.replace(/^ref_/, "");
    const referrer = await prisma.user.findUnique({
      where: { referralCode: refCode },
      select: { id: true },
    });

    if (referrer) {
      referrerId = referrer.id;
    }
  }

  if (user && !user.login.startsWith("tg_")) {
    // If user exists and is real, we might want to update their referrer if they don't have one
    if (!user.referredById && referrerId && user.id !== referrerId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { referredById: referrerId },
      });
    }

    let kb = getMainMenu().reply_markup.inline_keyboard;
    if (telegramId.toString() === process.env.TELEGRAM_ADMIN_CHAT_ID?.trim()) {
      kb = [...kb, [{ text: "🛠 Админ-панель", callback_data: "menu_admin" }]];
    }

    await ctx.reply(
      `Добро пожаловать, ${user.login}! 👋\nВаш VPN профиль активен. Вы можете использовать кнопку внизу для вызова меню.`,
      {
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
    let welcomeText =
      "Привет! Я бот Lowkey VPN. 🛡️\n\n" +
      "Для начала использования VPN, пожалуйста, отправьте мне желаемый **логин** (от 3 до 24 символов).\n\n" +
      "Если аккаунт с таким логином уже существует, вы привяжете его. Иначе мы создадим для вас новый профиль.";

    if (referrerId) {
      const referrer = await prisma.user.findUnique({
        where: { id: referrerId },
        select: { login: true },
      });
      welcomeText =
        `👋 Привет! Вы пришли по приглашению от **${referrer?.login || "партнера"}**.\n\n` +
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

    return ctx.reply(welcomeText, { parse_mode: "Markdown" });
  }
}
