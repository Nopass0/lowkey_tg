import { SUPPORT_STATUS } from "./constants";
import { escapeHtml } from "./telegram";

/**
 * Support ticket data stored inside the legacy `message` field.
 */
export type TicketBody = {
  subject: string;
  description: string;
};

const TICKET_PREFIX = "[subject]";

/**
 * Packs structured support ticket fields into the legacy single `message` column.
 *
 * @param ticket Ticket data.
 * @returns Serialized message body.
 */
export function serializeTicketMessage(ticket: TicketBody): string {
  return `${TICKET_PREFIX} ${ticket.subject}\n\n${ticket.description}`;
}

/**
 * Parses support ticket data from the legacy `message` column.
 *
 * @param message Raw database message.
 * @returns Parsed subject and description.
 */
export function parseTicketMessage(message: string): TicketBody {
  if (!message.startsWith(TICKET_PREFIX)) {
    return {
      subject: "Без темы",
      description: message.trim(),
    };
  }

  const [header = "", ...rest] = message.split("\n");
  return {
    subject: header.replace(`${TICKET_PREFIX} `, "").trim() || "Без темы",
    description: rest.join("\n").trim(),
  };
}

/**
 * Formats ticket preview for Telegram HTML.
 *
 * @param ticket Ticket data.
 * @returns HTML text.
 */
export function formatTicketPreview(ticket: TicketBody): string {
  return (
    "💬 <b>Предпросмотр заявки</b>\n\n" +
    `<b>Тема:</b> ${escapeHtml(ticket.subject)}\n\n` +
    `<b>Описание:</b>\n${escapeHtml(ticket.description)}`
  );
}

/**
 * Returns normalized support status that works with old rows.
 *
 * @param status Raw database status.
 * @returns `open` or `closed`.
 */
export function normalizeTicketStatus(status: string | null | undefined): string {
  return status === SUPPORT_STATUS.closed ? SUPPORT_STATUS.closed : SUPPORT_STATUS.open;
}
