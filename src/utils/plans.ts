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

export const PERIOD_DISCOUNTS: Record<string, number> = {
  monthly: 0,
  "3months": 0.05,
  "6months": 0.15,
  yearly: 0.2, // Visual only for UI if we want
};

export const PLANS = [
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
