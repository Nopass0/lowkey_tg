/**
 * Public legal document URLs used by the bot.
 */
export const LEGAL_URLS = {
  offer: "https://lowkey.su/legal/offer",
  privacy: "https://lowkey.su/legal/privacy",
} as const;

/**
 * Shared pagination defaults for inline lists.
 */
export const PAGINATION = {
  users: 10,
  transactions: 10,
  promos: 8,
  tickets: 5,
  mailings: 5,
} as const;

/**
 * Support ticket statuses that fit both old and new flows.
 */
export const SUPPORT_STATUS = {
  open: "open",
  closed: "closed",
} as const;

/**
 * Mailing statuses supported by the background worker.
 */
export const MAILING_STATUS = {
  scheduled: "scheduled",
  processing: "processing",
  sent: "sent",
  failed: "failed",
} as const;
