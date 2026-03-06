import { TochkaSBP } from "tochka-sbp";
import { prisma } from "./prisma";

let sbpClient: TochkaSBP | null = null;
const listeners: ((data: { userId: string; amount: number }) => void)[] = [];

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
  callback: (data: { userId: string; amount: number }) => void,
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

        const rate = referrer?.referralRate ?? 0.2;
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
    listeners.forEach((cb) => cb({ userId, amount }));
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
    try {
      // 1. Process pending payments
      const pendingPayments = await prisma.payment.findMany({
        where: { status: "pending" },
        take: 10,
      });

      const sbp = getSbpClient();
      for (const payment of pendingPayments) {
        try {
          // Status check using tochka-sbp
          const statusData = await sbp.getPaymentStatus(payment.sbpPaymentId);
          const firstStatus = Array.isArray(statusData)
            ? statusData[0]
            : statusData;
          if (!firstStatus || !firstStatus.operationStatus) continue;
          const status = firstStatus.operationStatus;

          if (status === "ACWP" || status === "ACSC") {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: "success" },
            });
            await processPaymentSuccess(payment.userId, payment.amount);
          } else if (status === "RJCT" || status === "CANC") {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: "failed" },
            });
          }
        } catch (err) {
          // Skip for now, check next time
        }
      }

      // 2. Cancel expired payments (older than 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      await prisma.payment.updateMany({
        where: {
          status: "pending",
          createdAt: { lt: tenMinutesAgo },
        },
        data: { status: "expired" },
      });
    } catch (err: any) {
      if (err.code === "P1017" || err.message?.includes("connection")) {
        console.log(
          "💳 Payment Polling Worker: Database connection lost, retrying in next cycle...",
        );
      } else {
        console.error("💳 Payment Polling Worker error:", err);
      }
    }
  }, 30000); // Check every 30 seconds
}
