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

  if (user) {
    // If user exists, we might want to update their tempReferrerId if they don't have a permanent referrer yet
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
    // For new users, we can't update a record that doesn't exist.
    // However, the textHandler will handle the registration.
    // We can't easily pass the referrerId to textHandler via 'ctx' in a way that survives the next message,
    // so we'll rely on the user sending their login, and we'll check the 'start' context then?
    // Actually, a better way is to create a 'shadow' user or use a more persistent state.
    // For now, let's assume we want to store this in a temporary session-like way or
    // simply tell the user they were invited.

    let welcomeText =
      "Привет! Я бот Lowkey VPN. 🛡️\n\n" +
      "Для начала использования VPN, пожалуйста, отправьте мне желаемый **логин** (от 3 до 24 символов).\n\n" +
      "Если аккаунт с таким логином уже существует, вы привяжете его. Иначе мы создадим для вас новый профиль.";

    if (referrerId) {
      welcomeText =
        "👋 Привет! Вы перешли по реферальной ссылке.\n\n" + welcomeText;

      // Create or update a shadow user to persist the referral link
      // We use a dummy login and password because they're required fields
      await prisma.user.upsert({
        where: { telegramId: BigInt(telegramId) },
        update: { tempReferrerId: referrerId },
        create: {
          telegramId: BigInt(telegramId),
          login: `tg_${telegramId}`, // Temporary login
          passwordHash: "shadow", // Placeholder
          referralCode: `ref_${telegramId}`, // Placeholder
          tempReferrerId: referrerId,
        },
      });
    }

    return ctx.reply(welcomeText);
  }
}
