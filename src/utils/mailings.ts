import { MAILING_STATUS } from "./constants";
import { bot } from "./bot";
import { prisma } from "./prisma";
import { buildBillingPath, createSitePaymentLink, createSiteSessionLink } from "./siteLinks";

let mailingWorkerStarted = false;
let mailingTickInProgress = false;

export interface MailingDraft {
  title: string;
  message: string;
  imageUrl?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  targetType?: string;
  targetUserIds?: string[];
  targetLogin?: string | null;
  scheduledAt?: string;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getMailingDraft(
  payload: Record<string, unknown> | null | undefined,
): MailingDraft {
  return {
    title: normalizeString(payload?.title),
    message: normalizeString(payload?.message),
    imageUrl: normalizeString(payload?.imageUrl) || null,
    buttonText: normalizeString(payload?.buttonText) || null,
    buttonUrl: normalizeString(payload?.buttonUrl) || null,
    targetType: normalizeString(payload?.targetType) || "all",
    targetUserIds: Array.isArray(payload?.targetUserIds)
      ? payload.targetUserIds.filter((item): item is string => typeof item === "string")
      : [],
    targetLogin: normalizeString(payload?.targetLogin) || null,
    scheduledAt: normalizeString(payload?.scheduledAt) || undefined,
  };
}

export function buildMailingMessageContent(draft: MailingDraft): string {
  const lines: string[] = [];
  if (draft.imageUrl) {
    lines.push(`[image:${draft.imageUrl}]`);
  }
  if (draft.message) {
    lines.push(draft.message);
  }
  return lines.join("\n").trim();
}

function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getMailingEditorText(draft: MailingDraft): string {
  const textStatus = draft.message
    ? `текст задан (${draft.message.length} симв.)`
    : "текст не задан";
  const imageStatus = draft.imageUrl ? "картинка добавлена" : "без картинки";
  const buttonStatus = describeMailingButton(draft.buttonText, draft.buttonUrl);

  return (
    `📨 <b>Конструктор рассылки</b>\n\n` +
    `<b>Тема:</b> ${escapeHtmlValue(draft.title || "Без темы")}\n` +
    `<b>Текст:</b> ${escapeHtmlValue(textStatus)}\n` +
    `<b>Картинка:</b> ${escapeHtmlValue(imageStatus)}\n` +
    `<b>Кнопка:</b> ${escapeHtmlValue(buttonStatus)}\n\n` +
    `Сначала соберите сообщение, потом выберите аудиторию и время отправки.`
  );
}

export function getMailingPreviewText(draft: MailingDraft): string {
  const targetLabel =
    draft.targetType === "user"
      ? draft.targetLogin || "selected user"
      : describeMailingTarget(draft.targetType || "all");
  const scheduleLabel = draft.scheduledAt
    ? new Date(draft.scheduledAt).toLocaleString("ru-RU")
    : "сейчас";

  return (
    `📢 <b>Предпросмотр рассылки</b>\n\n` +
    `<b>Тема:</b> ${escapeHtmlValue(draft.title || "Без темы")}\n` +
    `<b>Получатели:</b> ${escapeHtmlValue(targetLabel)}\n` +
    `<b>Кнопка:</b> ${escapeHtmlValue(
      describeMailingButton(draft.buttonText, draft.buttonUrl),
    )}\n` +
    `<b>Время:</b> ${escapeHtmlValue(scheduleLabel)}\n\n` +
    `${escapeHtmlValue(draft.message || "Текст не задан")}`
  );
}

function parseMailingDirectives(message: string) {
  let imageUrl: string | null = null;
  let buttonText: string | null = null;
  let buttonUrl: string | null = null;
  let promoPlan: string | null = null;
  let promoButtonText: string | null = null;

  const lines = message.split(/\r?\n/);
  const cleanLines: string[] = [];

  for (const line of lines) {
    const imageMatch = line.match(/^\[image:(.+)\]$/i);
    if (imageMatch) {
      imageUrl = imageMatch[1]?.trim() ?? null;
      continue;
    }

    const buttonMatch = line.match(/^\[button:([^|]+)\|(.+)\]$/i);
    if (buttonMatch) {
      buttonText = buttonMatch[1]?.trim() ?? null;
      buttonUrl = buttonMatch[2]?.trim() ?? null;
      continue;
    }

    const promoMatch = line.match(/^\[promo:([^|]+)\|(.+)\]$/i);
    if (promoMatch) {
      promoPlan = promoMatch[1]?.trim() ?? null;
      promoButtonText = promoMatch[2]?.trim() ?? null;
      continue;
    }

    cleanLines.push(line);
  }

  return {
    text: cleanLines.join("\n").trim(),
    imageUrl,
    buttonText,
    buttonUrl,
    promoPlan,
    promoButtonText,
  };
}

function describeMailingTarget(targetType: string) {
  if (targetType === "user") return "выбранный пользователь";
  if (targetType === "no_subscription") return "пользователи без подписки";
  if (targetType === "no_card") return "пользователи без привязанной карты";
  if (targetType.startsWith("expiring:")) {
    const days = Number(targetType.split(":")[1] || "0");
    return `подписка истекает в течение ${days} дн.`;
  }
  return "все пользователи";
}

function describeMailingButton(buttonText?: string | null, buttonUrl?: string | null) {
  if (!buttonText || !buttonUrl) return "без кнопки";
  if (buttonUrl === "action:link_card") return `${buttonText} -> привязать карту`;
  if (buttonUrl === "action:billing") return `${buttonText} -> открыть биллинг`;
  return `${buttonText} -> ${buttonUrl}`;
}

async function resolveMailingUsers(targetType: string, selectedUserIds: string[]) {
  const baseWhere = { telegramId: { not: null } };
  const now = new Date();

  if (targetType === "user") {
    return prisma.user.findMany({
      where: {
        ...baseWhere,
        id: { in: selectedUserIds },
      },
    });
  }

  if (targetType === "no_subscription") {
    return prisma.user.findMany({
      where: {
        ...baseWhere,
        OR: [
          { subscription: { is: null } },
          { subscription: { is: { activeUntil: { lte: now } } } },
        ],
      },
    });
  }

  if (targetType === "no_card") {
    return prisma.user.findMany({
      where: {
        ...baseWhere,
        paymentMethods: {
          none: {
            allowAutoCharge: true,
          },
        },
      },
    });
  }

  if (targetType.startsWith("expiring:")) {
    const days = Math.max(1, Number(targetType.split(":")[1] || "0"));
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return prisma.user.findMany({
      where: {
        ...baseWhere,
        subscription: {
          is: {
            activeUntil: {
              gt: now,
              lte: threshold,
            },
          },
        },
      },
    });
  }

  return prisma.user.findMany({
    where: baseWhere,
  });
}

async function resolveMailingButton(params: {
  userId: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  promoPlan?: string | null;
  promoButtonText?: string | null;
}) {
  if (params.promoPlan) {
    const promoUrl = await createSitePaymentLink({
      userId: params.userId,
      action: "promo_subscribe",
      plan: params.promoPlan,
      fallbackRedirect: "/me/billing?subscribed=1",
    });
    return {
      text: params.promoButtonText ?? "Оформить по акции",
      url: promoUrl,
    };
  }

  if (!params.buttonText || !params.buttonUrl) {
    return null;
  }

  if (params.buttonUrl === "action:link_card") {
    const url = await createSitePaymentLink({
      userId: params.userId,
      action: "link_card",
      fallbackRedirect: buildBillingPath({ tab: "cards", source: "telegram" }),
    });
    return { text: params.buttonText, url };
  }

  if (params.buttonUrl === "action:billing") {
    const url = await createSiteSessionLink(
      params.userId,
      buildBillingPath({ tab: "plans", source: "telegram" }),
    );
    return { text: params.buttonText, url };
  }

  return { text: params.buttonText, url: params.buttonUrl };
}

/**
 * Sends a mailing to selected recipients and stores result counters.
 *
 * @param mailingId Mailing record id.
 */
export async function processMailing(mailingId: string) {
  const mailing = await prisma.telegram_mailings.findUnique({
    where: { id: mailingId },
  });

  if (!mailing || mailing.status === MAILING_STATUS.sent) {
    return;
  }

  await prisma.telegram_mailings.update({
    where: { id: mailingId },
    data: {
      status: MAILING_STATUS.processing,
      processingAt: new Date(),
    },
  });

  const users = await resolveMailingUsers(mailing.targetType, mailing.selectedUserIds);

  let sentCount = 0;
  let failedCount = 0;
  let lastError: string | null = null;
  const content = parseMailingDirectives(mailing.message);

  for (const user of users) {
    try {
      const resolvedButton = await resolveMailingButton({
        userId: user.id,
        buttonText: mailing.buttonText ?? content.buttonText,
        buttonUrl: mailing.buttonUrl ?? content.buttonUrl,
        promoPlan: content.promoPlan,
        promoButtonText: content.promoButtonText,
      });
      const inlineButton = resolvedButton
        ? [[{ text: resolvedButton.text, url: resolvedButton.url }]]
        : undefined;

      if (content.imageUrl) {
        await bot.telegram.sendPhoto(Number(user.telegramId), content.imageUrl, {
          caption: content.text || mailing.title || undefined,
          parse_mode: "HTML",
          reply_markup: inlineButton
            ? { inline_keyboard: inlineButton }
            : undefined,
        });
      } else {
        await bot.telegram.sendMessage(Number(user.telegramId), content.text || mailing.message, {
          parse_mode: "HTML",
          reply_markup: inlineButton
            ? { inline_keyboard: inlineButton }
            : undefined,
        });
      }
      sentCount += 1;
    } catch (error: any) {
      failedCount += 1;
      lastError = String(error?.message || error);
    }
  }

  await prisma.telegram_mailings.update({
    where: { id: mailingId },
    data: {
      status: failedCount > 0 ? MAILING_STATUS.failed : MAILING_STATUS.sent,
      sentAt: new Date(),
      sentCount,
      failedCount,
      targetCount: users.length,
      lastError,
    },
  });
}

export { describeMailingButton, describeMailingTarget, parseMailingDirectives };

/**
 * Starts a lightweight background polling worker for scheduled mailings.
 */
export function startMailingWorker() {
  if (mailingWorkerStarted) return;
  mailingWorkerStarted = true;

  const tick = async () => {
    if (mailingTickInProgress) {
      return;
    }

    mailingTickInProgress = true;
    try {
      const dueMailings = await prisma.telegram_mailings.findMany({
        where: {
          status: MAILING_STATUS.scheduled,
          scheduledAt: { lte: new Date() },
        },
        orderBy: { scheduledAt: "asc" },
        take: 5,
      });

      for (const mailing of dueMailings) {
        try {
          await processMailing(mailing.id);
        } catch (error) {
          console.error(
            "[mailingWorker] failed to process mailing",
            mailing.id,
            error,
          );
        }
      }
    } catch (error: any) {
      if (
        error?.code === "P1017" ||
        error?.message?.includes("connection") ||
        error?.message?.includes("Timed out fetching a new connection")
      ) {
        console.log(
          "[mailingWorker] Database connection unavailable, retrying in next cycle...",
        );
      } else {
        console.error("[mailingWorker] tick failed", error);
      }
    } finally {
      mailingTickInProgress = false;
    }
  };

  void tick().catch((error) => {
    console.error("[mailingWorker] initial tick failed", error);
  });
  setInterval(() => {
    void tick().catch((error) => {
      console.error("[mailingWorker] scheduled tick failed", error);
    });
  }, 15000);
}
