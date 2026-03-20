import crypto from "node:crypto";
import { prisma } from "./prisma";

const SITE_URL = (process.env.SITE_URL || "https://lowkey.su").replace(/\/+$/, "");

function buildQuery(
  params: Record<string, string | number | undefined | null>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    query.set(key, String(value));
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function buildBillingPath(
  params: Record<string, string | number | undefined | null> = {},
) {
  return `/me/billing${buildQuery(params)}`;
}

export async function createSiteSessionLink(
  userId: string,
  redirectPath = "/me",
) {
  const code = crypto.randomBytes(24).toString("hex");

  await prisma.user.update({
    where: { id: userId },
    data: {
      botLoginCode: code,
      botLoginCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  return `${SITE_URL}/api/auth/bot-autologin/${code}?redirect=${encodeURIComponent(
    redirectPath,
  )}`;
}

export async function createSitePaymentLink(params: {
  userId: string;
  action: "topup" | "link_card" | "promo_subscribe" | "subscribe";
  amount?: number;
  plan?: string;
  period?: string;
  fallbackRedirect?: string;
}) {
  const code = crypto.randomBytes(24).toString("hex");

  await prisma.user.update({
    where: { id: params.userId },
    data: {
      botLoginCode: code,
      botLoginCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  return `${SITE_URL}/api/auth/bot-autologin/${code}?redirect=${encodeURIComponent(
    params.fallbackRedirect ?? "/me/billing",
  )}&action=${encodeURIComponent(params.action)}${
    typeof params.amount === "number" ? `&amount=${encodeURIComponent(String(params.amount))}` : ""
  }${params.plan ? `&plan=${encodeURIComponent(params.plan)}` : ""}${
    params.period ? `&period=${encodeURIComponent(params.period)}` : ""
  }`;
}
