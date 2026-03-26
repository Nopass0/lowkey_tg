import { prisma } from "./prisma";

export const PERIOD_DAYS: Record<string, number> = {
  monthly: 30,
  "3months": 90,
  "6months": 180,
  yearly: 365,
};

export const PERIOD_LABELS: Record<string, string> = {
  monthly: "1 мес",
  "3months": "3 мес",
  "6months": "6 мес",
  yearly: "1 год",
};

export type PlanView = {
  id: string;
  name: string;
  prices: Record<string, number>;
  features: string[];
  isPopular: boolean;
};

const FALLBACK_PLANS: Array<{
  id: string;
  name: string;
  prices: Record<string, number>;
  features: string[];
  isPopular: boolean;
}> = [
  {
    id: "starter",
    name: "Начальный",
    prices: {
      monthly: 149,
      "3months": 129,
      "6months": 99,
      yearly: 79,
    },
    features: ["1 устройство", "Базовая скорость", "Доступ к 5 локациям"],
    isPopular: false,
  },
  {
    id: "pro",
    name: "Продвинутый",
    prices: {
      monthly: 299,
      "3months": 249,
      "6months": 199,
      yearly: 149,
    },
    features: [
      "3 устройства",
      "Высокая скорость",
      "Доступ ко всем локациям",
      "Kill Switch",
    ],
    isPopular: true,
  },
  {
    id: "advanced",
    name: "Максимальный",
    prices: {
      monthly: 499,
      "3months": 399,
      "6months": 349,
      yearly: 249,
    },
    features: [
      "5 устройств",
      "Максимальная скорость",
      "Доступ ко всем локациям",
      "Kill Switch",
      "Выделенный IP",
      "Приоритетная поддержка",
    ],
    isPopular: false,
  },
];

function getFallbackPlans(): PlanView[] {
  return FALLBACK_PLANS.map((plan) => ({
    ...plan,
    prices: { ...plan.prices },
  }));
}

export const PLANS = getFallbackPlans();

export async function getAvailablePlans(): Promise<PlanView[]> {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      include: { prices: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    const mapped = plans
      .map((plan) => ({
        id: plan.slug,
        name: plan.name,
        features: plan.features,
        isPopular: plan.isPopular,
        prices: Object.fromEntries(
          plan.prices
            .filter((price: any) => price.period in PERIOD_DAYS)
            .map((price: any) => [price.period, price.price]),
        ),
      }))
      .filter((plan) => Object.keys(plan.prices).length > 0);

    return mapped.length ? mapped : getFallbackPlans();
  } catch (error) {
    console.error("[plans] failed to load plans from db, using fallback", error);
    return getFallbackPlans();
  }
}

export async function getPlanById(planId: string): Promise<PlanView | null> {
  const plans = await getAvailablePlans();
  return plans.find((plan) => plan.id === planId) ?? null;
}

export function getPlanMonthlyPrice(plan: PlanView): number {
  const monthlyPrices = Object.entries(plan.prices)
    .map(([, price]) => price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price));

  return monthlyPrices.length ? Math.min(...monthlyPrices) : 0;
}
