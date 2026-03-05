import { Context } from "telegraf";

export async function handleHowToConnect(ctx: Context) {
  const text =
    `📖 **Инструкция по подключению**\n\n` +
    `Для использования Lowkey VPN вам понадобится специальное приложение-клиент.\n\n` +
    `Выберите вашу платформу:`;

  const buttons = [
    [{ text: "🤖 Android", callback_data: "how_to_android" }],
    [{ text: "🍎 iOS (iPhone/iPad)", callback_data: "how_to_ios" }],
    [{ text: "💻 Windows / Desktop", callback_data: "how_to_windows" }],
    [{ text: "◀️ Назад", callback_data: "menu_vpn" }],
  ];

  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) throw err;
  }
}

export async function handleHowToAndroid(ctx: Context) {
  const text =
    `🤖 **Инструкция для Android**\n\n` +
    `1. Скачайте приложение **v2rayNG**:\n` +
    `• [Google Play](https://play.google.com/store/apps/details?id=com.v2ray.ang)\n` +
    `• [GitHub (Последний APK)](https://github.com/2dust/v2rayNG/releases/latest)\n\n` +
    `2. Перейдите к следующему шагу, чтобы узнать как добавить вашу ссылку.`;

  const buttons = [
    [{ text: "➡️ Шаг 2: Настройка", callback_data: "how_to_setup" }],
    [{ text: "◀️ Назад", callback_data: "how_to_connect" }],
  ];

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleHowToIos(ctx: Context) {
  const text =
    `🍎 **Инструкция для iOS (iPhone/iPad)**\n\n` +
    `1. Установите приложение **V2Box** из App Store:\n` +
    `• [Установить V2Box](https://apps.apple.com/app/v2box-v2ray-client/id1640135560)\n\n` +
    `2. Перейдите к следующему шагу для настройки.`;

  const buttons = [
    [{ text: "➡️ Шаг 2: Настройка", callback_data: "how_to_setup" }],
    [{ text: "◀️ Назад", callback_data: "how_to_connect" }],
  ];

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleHowToSetup(ctx: Context) {
  const text =
    `⚙️ **Шаг 2: Настройка (Android / iOS)**\n\n` +
    `1. Вернитесь в меню **"🛡️ Мой VPN"** и скопируйте вашу персональную ссылку (\`vless://...\`).\n\n` +
    `2. Откройте приложение (v2rayNG / v2rayV).\n\n` +
    `3. Нажмите на иконку **"+"** (или меню) и выберите **"Import from clipboard"** (Импорт из буфера обмена).\n\n` +
    `4. Нажмите на появившийся профиль, чтобы он стал активным (обычно выделяется цветом).\n\n` +
    `5. Нажмите на кнопку **"Connect"** (внизу справа на Android, или переключатель сверху на iOS).\n\n` +
    `✅ Готово! Теперь вы защищены.`;

  const buttons = [
    [{ text: "◀️ Назад", callback_data: "how_to_connect" }],
    [{ text: "🏠 В главное меню", callback_data: "menu_main" }],
  ];

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleHowToWindows(ctx: Context) {
  const text =
    `💻 **Инструкция для Windows**\n\n` +
    `1. Скачайте оригинальный клиент **Throne**:\n` +
    `[Скачать Throne (GitHub)](https://github.com/SagerNet/sing-box/releases) _(Или используйте нашу прямую ссылку)_\n\n` +
    `2. Ссылка для прямого скачивания (v1.8.11):\n` +
    `https://github.com/SagerNet/sing-box/releases/download/v1.8.11/sing-box-1.8.11-windows-amd64.zip\n\n` +
    `3. Распакуйте архив и запустите приложение.\n\n` +
    `4. Скопируйте вашу ссылку из меню "Мой VPN" и добавьте её в приложение через кнопку **"+"** -> **"Import from clipboard"**.\n\n` +
    `5. Нажмите кнопку подключения.`;

  const buttons = [
    [{ text: "◀️ Назад", callback_data: "how_to_connect" }],
    [{ text: "🏠 В главное меню", callback_data: "menu_main" }],
  ];

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}
