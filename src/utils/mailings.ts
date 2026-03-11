import { MAILING_STATUS } from "./constants";
import { bot } from "./bot";
import { prisma } from "./prisma";

let mailingWorkerStarted = false;

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

  for (const user of users) {
    try {
      await bot.telegram.sendMessage(Number(user.telegramId), mailing.message, {
        parse_mode: "HTML",
      });
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
        console.error("[mailingWorker] failed to process mailing", mailing.id, error);
      }
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 15000);
}
