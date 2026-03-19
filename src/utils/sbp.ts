import { TochkaSBP } from "tochka-sbp";
import { prisma } from "./prisma";
import { getEffectiveReferralRate } from "./referrals";

let sbpClient: TochkaSBP | null = null;
const listeners: ((data: any) => void | Promise<void>)[] = [];
let paymentTickInProgress = false;

export function getSbpClient(): TochkaSBP {
  if (!sbpClient) {
    sbpClient = new TochkaSBP({
      jwt: process.env.TOCHKA_API_KEY || "",
    });
  }
  return sbpClient;
}

/**
 * Registers a callback to be notified when a payment is successful.
 * Used in index.ts for bot notifications.
 */
export function onPaymentSuccess(
  callback: (data: any) => void | Promise<void>,
) {
  listeners.push(callback);
}

/**
 * Internal logic to handle a successful payment:
 * 1. Updates user balance in DB.
 * 2. Creates a transaction record.
 * 3. Handles referral commissions.
 * 4. Notifies all registered listeners.
 */
export async function processPaymentSuccess(
  userId: string,
  amount: number,
): Promise<void> {
  if (!userId || isNaN(amount)) return;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Add to user balance
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } },
        select: { referredById: true },
      });

      // 2. Create topup transaction
      await tx.transaction.create({
        data: {
          userId,
          type: "topup",
          amount,
          title: "Пополнение через СБП",
        },
      });

      // 3. Award dynamic referral commission
      if (updatedUser.referredById) {
        const referrer = await tx.user.findUnique({
          where: { id: updatedUser.referredById },
          select: { referralRate: true },
        });

        const rate = getEffectiveReferralRate(referrer?.referralRate);
        const commission = amount * rate;

        await tx.user.update({
          where: { id: updatedUser.referredById },
          data: { referralBalance: { increment: commission } },
        });

        await tx.transaction.create({
          data: {
            userId: updatedUser.referredById,
            type: "referral_earning",
            amount: commission,
            title: "Реферальное начисление",
          },
        });
      }
    });

    // Notify listeners (e.g., to send a TG message)
    const referrer = await prisma.user.findFirst({
      where: { referrals: { some: { id: userId } } },
      select: { id: true, telegramId: true, referralRate: true },
    });

    for (const cb of listeners) {
      try {
        await cb({
          userId,
          amount,
          referrerId: referrer?.id,
          commission: referrer
            ? amount * getEffectiveReferralRate(referrer.referralRate)
            : 0,
        });
      } catch (e) {
        console.error("Error in onPaymentSuccess listener:", e);
      }
    }
  } catch (error) {
    console.error("Error in processPaymentSuccess:", error);
  }
}

/**
 * Starts a background worker that polls for pending payments.
 */
export function startPaymentWorker() {
  console.log("💳 Starting Payment Polling Worker...");
  setInterval(async () => {
    if (paymentTickInProgress) {
      return;
    }

    paymentTickInProgress = true;
    try {
      // 1. Process pending payments
      const pendingPayments = await prisma.payment.findMany({
        where: { status: "pending" },
        take: 10,
      });

      const sbp = getSbpClient();
      for (const payment of pendingPayments) {
        try {
          if (!payment.sbpPaymentId) {
            continue;
          }

          // Status check using tochka-sbp
          let statusData: any;
          try {
            statusData = await sbp.getPaymentStatus(payment.sbpPaymentId);
          } catch (apiErr) {
            console.error(
              `Error checking SBP status for ${payment.sbpPaymentId}:`,
              apiErr,
            );
            continue;
          }

          console.log(
            `SBP Status checking for ${payment.sbpPaymentId}:`,
            JSON.stringify(statusData, null, 2),
          );

          let firstStatus = Array.isArray(statusData)
            ? statusData[0]
            : statusData;

          if (firstStatus?.data && Array.isArray(firstStatus.data)) {
            firstStatus = firstStatus.data[0];
          }

          if (!firstStatus) continue;
          const status = firstStatus.operationStatus || firstStatus.status;
          if (!status) continue;

          console.log(`Parsed SBP status:`, status);

          if (status === "ACWP" || status === "ACSC" || status === "Accepted") {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: "success" },
            });
            await processPaymentSuccess(payment.userId, payment.amount);
          } else if (
            status === "RJCT" ||
            status === "CANC" ||
            status === "Rejected"
          ) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: "failed" },
            });
          }
        } catch (err) {
          console.error("Error processing pending payment:", err);
        }
      }

      // 2. Cancel expired payments (older than 30 minutes)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      await prisma.payment.updateMany({
        where: {
          status: "pending",
          createdAt: { lt: thirtyMinutesAgo },
        },
        data: { status: "expired" },
      });
    } catch (err: any) {
      if (err.code === "P1017" || err.message?.includes("connection")) {
        console.log(
          "💳 Payment Polling Worker: Database connection lost, retrying in next cycle...",
        );
      } else if (err.message?.includes("Timed out fetching a new connection")) {
        console.log(
          "💳 Payment Polling Worker: Connection pool exhausted, retrying in next cycle...",
        );
      } else {
        console.error("💳 Payment Polling Worker error:", err);
      }
    } finally {
      paymentTickInProgress = false;
    }
  }, 30000); // Check every 30 seconds
}
