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

