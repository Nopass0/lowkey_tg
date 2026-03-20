import { MAILING_STATUS } from "./constants";
import { bot } from "./bot";
import { prisma } from "./prisma";
import { createSitePaymentLink } from "./siteLinks";

let mailingWorkerStarted = false;
let mailingTickInProgress = false;

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

  const users =
    mailing.targetType === "user"
      ? await prisma.user.findMany({
          where: {
            id: { in: mailing.selectedUserIds },
            telegramId: { not: null },
          },
        })
      : await prisma.user.findMany({
          where: { telegramId: { not: null } },
        });

  let sentCount = 0;
  let failedCount = 0;
  let lastError: string | null = null;
  const content = parseMailingDirectives(mailing.message);

  for (const user of users) {
    try {
      const promoUrl =
        content.promoPlan != null
          ? await createSitePaymentLink({
              userId: user.id,
              action: "promo_subscribe",
              plan: content.promoPlan,
              fallbackRedirect: "/me/billing?subscribed=1",
            })
          : null;

      const inlineButton =
        content.promoPlan && promoUrl
          ? [[{ text: content.promoButtonText ?? "Оформить по акции", url: promoUrl }]]
          : content.buttonText && content.buttonUrl
            ? [[{ text: content.buttonText, url: content.buttonUrl }]]
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
