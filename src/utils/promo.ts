type PromoActivation = {
  activatedAt: Date;
};

type PromoCode = {
  code: string;
  conditions: unknown;
  effects: unknown;
  maxActivations: number | null;
  createdAt: Date;
};

type User = {
  balance: number;
  referredById: string | null;
  joinedAt: Date;
};

export type PromoRule = {
  key: string;
  value?: string;
};

export function asPromoRules(input: unknown): PromoRule[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (entry): entry is PromoRule =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as PromoRule).key === "string" &&
        ((entry as PromoRule).value === undefined ||
          typeof (entry as PromoRule).value === "string"),
    )
    .map((entry) => ({ key: entry.key, value: entry.value }));
}

export function describePromoConditions(
  promo: Pick<PromoCode, "conditions" | "maxActivations">,
): string[] {
  const rules = asPromoRules(promo.conditions);
  const lines = rules.map((rule) => {
    switch (rule.key) {
      case "min_balance":
        return `Баланс не ниже ${rule.value} ₽`;
      case "must_have_no_referrer":
        return "Только для пользователей без пригласившего";
      case "new_user_only":
      case "new_users_only":
        return "Только для новых пользователей";
      default:
        return rule.value ? `${rule.key}: ${rule.value}` : rule.key;
    }
  });

  if (promo.maxActivations) {
    lines.push(`Лимит активаций: ${promo.maxActivations}`);
  } else {
    lines.push("Лимит активаций: без ограничений");
  }

  return lines;
}

export function describePromoEffects(promo: Pick<PromoCode, "effects">): string[] {
  return asPromoRules(promo.effects).map((rule) => {
    switch (rule.key) {
      case "add_balance":
        return `Пополнить баланс на ${rule.value} ₽`;
      case "set_referral_rate":
        return `Установить реферальную ставку ${Number(rule.value) * 100}%`;
      case "discount_pct":
      case "plan_discount_pct":
        return `Скидка ${rule.value}% на следующую покупку`;
      case "discount_fixed":
      case "plan_discount_fixed":
        return `Скидка ${rule.value} ₽ на следующую покупку`;
      case "referrer_id":
        return "Привязать пользователя к указанному рефереру";
      default:
        return rule.value ? `${rule.key}: ${rule.value}` : rule.key;
    }
  });
}

export function describePromoStats(
  promo: Pick<PromoCode, "code" | "maxActivations" | "createdAt">,
  activations: Pick<PromoActivation, "activatedAt">[],
): string {
  const limit =
    promo.maxActivations === null ? "∞" : `${activations.length}/${promo.maxActivations}`;
  return `${promo.code} · активаций ${limit} · создан ${promo.createdAt.toLocaleString("ru-RU")}`;
}

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

    if (condition.key === "new_user_only" || condition.key === "new_users_only") {
      const ageMs = Date.now() - user.joinedAt.getTime();
      if (ageMs > 1000 * 60 * 60 * 24 * 7) {
        return "Этот промокод доступен только новым пользователям.";
      }
    }
  }

  return null;
}
