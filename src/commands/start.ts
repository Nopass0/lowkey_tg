import { Context, Markup } from "telegraf";
import { prisma } from "../utils/prisma";
import { getMainMenu } from "../utils/bot";

export async function handleStart(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (user) {
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
    return ctx.reply(
      "Привет! Я бот Lowkey VPN. 🛡️\n\n" +
        "Для начала использования VPN, пожалуйста, отправьте мне желаемый **логин** (от 3 до 24 символов).\n\n" +
        "Если аккаунт с таким логином уже существует, вы привяжете его. Иначе мы создадим для вас новый профиль.",
    );
  }
}
