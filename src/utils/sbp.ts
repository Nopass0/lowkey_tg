import { TochkaSBP } from "tochka-sbp";
import { prisma } from "./prisma";

let sbpClient: TochkaSBP | null = null;

export function getSbpClient(): TochkaSBP {
  if (!sbpClient) {
    sbpClient = new TochkaSBP({
      jwt: process.env.TOCHKA_API_KEY || "",
    });
  }
  return sbpClient;
}

export async function onPaymentSuccess(
  userId: string,
  amount: number,
): Promise<void> {
  await prisma.$transaction(async (tx: any) => {
    // 1. Add to user balance
    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } },
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

    // 3. Award 20% referral commission
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { referredById: true },
    });

    if (user?.referredById) {
      const commission = amount * 0.2;
      await tx.user.update({
        where: { id: user.referredById },
        data: { referralBalance: { increment: commission } },
      });
      await tx.transaction.create({
        data: {
          userId: user.referredById,
          type: "referral_earning",
          amount: commission,
          title: "Реферальное начисление",
        },
      });
    }
  });
}
