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
    `1. Скачайте приложение **v2rayTun**:\n` +
    `• [Google Play](https://play.google.com/store/apps/details?id=com.v2raytun.android)\n\n` +
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
    `1. Установите приложение **v2rayTun** из App Store:\n` +
    `• [Установить v2rayTun](https://apps.apple.com/us/app/v2raytun/id6476628951)\n\n` +
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
    `1. Скачайте приложение **Throne**:\n` +
    `• [Скачать Throne (.exe)](https://github.com/throneproj/Throne/releases/download/1.0.13/Throne-1.0.13-windows64-installer.exe)\n\n` +
    `2. Установите и запустите приложение.\n\n` +
    `3. Скопируйте вашу ссылку из меню "Мой VPN" и добавьте её в приложение через кнопку **"+"** -> **"Import from clipboard"**.\n\n` +
    `4. Нажмите кнопку подключения (Connect).`;

  const buttons = [
    [{ text: "◀️ Назад", callback_data: "how_to_connect" }],
    [{ text: "🏠 В главное меню", callback_data: "menu_main" }],
  ];

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}
