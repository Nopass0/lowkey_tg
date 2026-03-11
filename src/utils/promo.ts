import type { PromoCode, PromoActivation, User } from "@prisma/client";

/**
 * Generic promo JSON rule stored in legacy `Json` columns.
 */
export type PromoRule = {
  key: string;
  value: string;
};

/**
 * Casts unknown JSON into a promo rule list.
 *
 * @param input Prisma JSON field.
 * @returns Safe promo rule list.
 */
export function asPromoRules(input: unknown): PromoRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (entry): entry is PromoRule =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as PromoRule).key === "string" &&
        typeof (entry as PromoRule).value === "string",
    )
    .map((entry) => ({ key: entry.key, value: entry.value }));
}

/**
 * Human-readable promo conditions summary.
 *
 * @param promo Promo record.
 * @returns Summary lines.
 */
export function describePromoConditions(promo: Pick<PromoCode, "conditions" | "maxActivations">): string[] {
  const rules = asPromoRules(promo.conditions);
  const lines = rules.map((rule) => {
    switch (rule.key) {
      case "min_balance":
        return `Баланс не ниже ${rule.value} ₽`;
      case "must_have_no_referrer":
        return "Только для пользователей без пригласившего";
      case "new_user_only":
        return "Только для новых пользователей";
      default:
        return `${rule.key}: ${rule.value}`;
    }
  });

  if (promo.maxActivations) {
    lines.push(`Лимит активаций: ${promo.maxActivations}`);
  } else {
    lines.push("Лимит активаций: без ограничений");
  }

  return lines;
}

/**
 * Human-readable promo effects summary.
 *
 * @param promo Promo record.
 * @returns Summary lines.
 */
export function describePromoEffects(promo: Pick<PromoCode, "effects">): string[] {
  return asPromoRules(promo.effects).map((rule) => {
    switch (rule.key) {
      case "add_balance":
        return `Пополнить баланс на ${rule.value} ₽`;
      case "set_referral_rate":
        return `Установить реферальную ставку ${Number(rule.value) * 100}%`;
      case "discount_pct":
        return `Скидка ${rule.value}% на следующую покупку`;
      case "discount_fixed":
        return `Скидка ${rule.value} ₽ на следующую покупку`;
      case "referrer_id":
        return "Привязать пользователя к указанному рефереру";
      default:
        return `${rule.key}: ${rule.value}`;
    }
  });
}

/**
 * Formats promo statistics for list/detail screens.
 *
 * @param promo Promo record.
 * @param activations Activation list.
 * @returns Short summary.
 */
export function describePromoStats(
  promo: Pick<PromoCode, "code" | "maxActivations" | "createdAt">,
  activations: Pick<PromoActivation, "activatedAt">[],
): string {
  const limit =
    promo.maxActivations === null ? "∞" : `${activations.length}/${promo.maxActivations}`;
  return `${promo.code} · активаций ${limit} · создан ${promo.createdAt.toLocaleString("ru-RU")}`;
}

/**
 * Checks promo conditions against the current user without needing schema changes.
 *
 * @param user Current user.
 * @param conditions Promo conditions.
 * @returns Error message or `null` when activation is allowed.
 */
export function validatePromoConditions(
  user: Pick<User, "balance" | "referredById" | "joinedAt">,
  conditions: PromoRule[],
): string | null {
  for (const condition of conditions) {
    if (condition.key === "min_balance" && user.balance < Number(condition.value)) {
      return `Нужен баланс от ${condition.value} ₽.`;
    }

    if (condition.key === "must_have_no_referrer" && user.referredById) {
      return "Этот промокод доступен только пользователям без пригласившего.";
    }

    if (condition.key === "new_user_only") {
      const ageMs = Date.now() - user.joinedAt.getTime();
      if (ageMs > 1000 * 60 * 60 * 24 * 7) {
        return "Этот промокод доступен только новым пользователям.";
      }
    }
  }

  return null;
}
