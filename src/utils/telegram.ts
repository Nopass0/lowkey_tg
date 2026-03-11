import { Markup, type Context } from "telegraf";

/**
 * Escapes HTML entities for Telegram HTML parse mode.
 *
 * @param value Source text.
 * @returns Escaped text safe for Telegram HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Safely edits a message and falls back to replying when the message cannot be edited.
 *
 * @param ctx Telegram context.
 * @param text Message body.
 * @param extra Additional Telegraf reply options.
 * @returns Telegram API promise.
 */
export async function editOrReply(
  ctx: Context,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  const sendPlainReply = () => {
    const plainExtra = { ...extra } as Record<string, unknown>;
    delete plainExtra.parse_mode;
    return ctx.reply(text, plainExtra as any);
  };

  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, extra as any);
    } catch (error: any) {
      const message = String(error?.message || error?.description || "");
      if (!message.includes("message is not modified")) {
        try {
          return await ctx.reply(text, extra as any);
        } catch (replyError: any) {
          const replyMessage = String(
            replyError?.message || replyError?.description || "",
          );
          if (replyMessage.includes("can't parse entities")) {
            return sendPlainReply();
          }
          throw replyError;
        }
      }
      return undefined;
    }
  }

  try {
    return await ctx.reply(text, extra as any);
  } catch (error: any) {
    const message = String(error?.message || error?.description || "");
    if (message.includes("can't parse entities")) {
      return sendPlainReply();
    }
    throw error;
  }
}

/**
 * Builds back/prev/next controls for paginated inline screens.
 *
 * @param options Callback settings.
 * @returns Inline keyboard row.
 */
export function buildPagerRow(options: {
  page: number;
  total: number;
  prefix: string;
  extra?: Array<ReturnType<typeof Markup.button.callback>>;
}): ReturnType<typeof Markup.button.callback>[] {
  const row: ReturnType<typeof Markup.button.callback>[] = [];

  if (options.page > 0) {
    row.push(
      Markup.button.callback("⬅️ Назад", `${options.prefix}:${options.page - 1}`),
    );
  }

  if (options.extra?.length) {
    row.push(...options.extra);
  }

  if (options.page + 1 < options.total) {
    row.push(
      Markup.button.callback("Вперёд ➡️", `${options.prefix}:${options.page + 1}`),
    );
  }

  return row;
}
