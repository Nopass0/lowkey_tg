import { Markup, type Context } from "telegraf";
import { prisma } from "../utils/prisma";
import { buildBillingPath, createSiteSessionLink } from "../utils/siteLinks";
import { editOrReply } from "../utils/telegram";

export async function handleMenuTopupViaSite(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { id: true },
  });
  if (!user) return;

  const billingUrl = await createSiteSessionLink(
    user.id,
    buildBillingPath({ intent: "topup", tab: "plans", source: "telegram" }),
  );

  await editOrReply(
    ctx,
    "💳 Отправьте сумму пополнения одним сообщением, и я дам одноразовую ссылку на сайт.\n\nДопустимый диапазон: от 100 до 100000 ₽.\n\nНа сайте пополнение идёт через YooKassa с привязкой карты и автосписанием.",
    {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url("🌐 Открыть биллинг на сайте", billingUrl)],
        [Markup.button.callback("◀️ Назад", "menu_main")],
      ]).reply_markup,
    },
  );
}

