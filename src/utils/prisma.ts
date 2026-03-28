import { VoidClient, type QuerySpec, type SortClause } from "@voiddb/orm";

type AnyRecord = Record<string, any>;
type OrderByInput = Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
type QueryArgs = {
  where?: AnyRecord;
  select?: AnyRecord;
  include?: AnyRecord;
  orderBy?: OrderByInput;
  skip?: number;
  take?: number;
};

export interface PrismaDelegate {
  findUnique(args?: QueryArgs): Promise<any | null>;
  findFirst(args?: QueryArgs): Promise<any | null>;
  findMany(args?: QueryArgs): Promise<any[]>;
  count(args?: Pick<QueryArgs, "where">): Promise<number>;
  create(args: { data: AnyRecord; select?: AnyRecord; include?: AnyRecord }): Promise<any>;
  update(args: { where: AnyRecord; data: AnyRecord; select?: AnyRecord; include?: AnyRecord }): Promise<any>;
  updateMany(args: { where?: AnyRecord; data: AnyRecord }): Promise<{ count: number }>;
  deleteMany(args: { where?: AnyRecord }): Promise<{ count: number }>;
  delete(args: { where: AnyRecord; select?: AnyRecord; include?: AnyRecord }): Promise<any>;
  upsert(args: {
    where: AnyRecord;
    create: AnyRecord;
    update: AnyRecord;
    select?: AnyRecord;
    include?: AnyRecord;
  }): Promise<any>;
}

export interface PrismaLikeClient {
  user: PrismaDelegate;
  subscriptionPlan: PrismaDelegate;
  subscriptionPrice: PrismaDelegate;
  subscription: PrismaDelegate;
  transaction: PrismaDelegate;
  payment: PrismaDelegate;
  paymentMethod: PrismaDelegate;
  yokassaSettings: PrismaDelegate;
  promoCode: PrismaDelegate;
  promoActivation: PrismaDelegate;
  withdrawal: PrismaDelegate;
  supportTicket: PrismaDelegate;
  vpnServer: PrismaDelegate;
  mtprotoSettings: PrismaDelegate;
  telegram_mailings: PrismaDelegate;
  telegram_mailing_actions: PrismaDelegate;
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: PrismaLikeClient) => Promise<T>): Promise<T>;
  $transaction<T>(operations: Promise<T>[]): Promise<T[]>;
  [key: string]: PrismaDelegate | any;
}

type ModelName =
  | "user"
  | "subscriptionPlan"
  | "subscriptionPrice"
  | "subscription"
  | "transaction"
  | "payment"
  | "paymentMethod"
  | "yokassaSettings"
  | "promoCode"
  | "promoActivation"
  | "withdrawal"
  | "supportTicket"
  | "vpnServer"
  | "mtprotoSettings"
  | "telegram_mailings"
  | "telegram_mailing_actions";

type RelationConfig = {
  model: ModelName;
  type: "one" | "many";
  localField: string;
  foreignField: string;
};

type ModelConfig = {
  collection: string;
  fields: string[];
  dateFields: string[];
  bigintFields?: string[];
  relations?: Record<string, RelationConfig>;
};

type CachedRow = AnyRecord & {
  [RELATION_CACHE]?: Record<string, any>;
};

type QueryNode =
  | {
      field: string;
      op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts_with" | "in";
      value: any;
    }
  | { AND: QueryNode[] }
  | { OR: QueryNode[] };

const DATABASE_NAME = "lowkey";
const RELATION_CACHE = Symbol("voiddb_relation_cache");
const voidClient = VoidClient.fromEnv();
let authPromise: Promise<VoidClient> | null = null;

const MODEL_CONFIG: Record<ModelName, ModelConfig> = {
  user: {
    collection: "users",
    fields: [
      "id",
      "login",
      "passwordHash",
      "balance",
      "referralBalance",
      "isBanned",
      "isAdmin",
      "referralCode",
      "referredById",
      "joinedAt",
      "pendingDiscountFixed",
      "pendingDiscountPct",
      "botLoginCode",
      "botLoginCodeExpiresAt",
      "telegramId",
      "telegramLinkCode",
      "telegramLinkCodeExpiresAt",
      "referralRate",
      "botState",
      "tempReferrerId",
      "aiFreeTokensUsed",
      "aiPurchasedTokens",
      "hideAiMenu",
    ],
    dateFields: ["joinedAt", "botLoginCodeExpiresAt", "telegramLinkCodeExpiresAt"],
    bigintFields: ["telegramId"],
    relations: {
      subscription: { model: "subscription", type: "one", localField: "id", foreignField: "userId" },
      paymentMethods: { model: "paymentMethod", type: "many", localField: "id", foreignField: "userId" },
      referrals: { model: "user", type: "many", localField: "id", foreignField: "referredById" },
    },
  },
  subscriptionPlan: {
    collection: "subscription_plans",
    fields: [
      "id",
      "slug",
      "name",
      "features",
      "telegramProxyEnabled",
      "isPopular",
      "isActive",
      "isTelegramPlan",
      "sortOrder",
      "createdAt",
      "updatedAt",
      "promoActive",
      "promoLabel",
      "promoMaxUses",
      "promoPrice",
      "promoUsed",
      "promoDurationCount",
      "promoDurationUnit",
    ],
    dateFields: ["createdAt", "updatedAt"],
    relations: {
      prices: { model: "subscriptionPrice", type: "many", localField: "id", foreignField: "planId" },
    },
  },
  subscriptionPrice: {
    collection: "subscription_prices",
    fields: ["id", "planId", "period", "price"],
    dateFields: [],
  },
  subscription: {
    collection: "subscriptions",
    fields: [
      "id",
      "userId",
      "planId",
      "planName",
      "activeUntil",
      "isLifetime",
      "createdAt",
      "updatedAt",
      "autoRenewal",
      "autoRenewPaymentMethodId",
      "billingPeriod",
    ],
    dateFields: ["activeUntil", "createdAt", "updatedAt"],
    relations: {
      user: { model: "user", type: "one", localField: "userId", foreignField: "id" },
    },
  },
  transaction: {
    collection: "transactions",
    fields: ["id", "userId", "type", "amount", "title", "createdAt", "isTest", "paymentId"],
    dateFields: ["createdAt"],
  },
  payment: {
    collection: "payments",
    fields: [
      "id",
      "userId",
      "sbpPaymentId",
      "amount",
      "status",
      "qrUrl",
      "sbpUrl",
      "createdAt",
      "expiresAt",
      "confirmationUrl",
      "description",
      "metadata",
      "paymentType",
      "provider",
      "yokassaPaymentId",
      "creditedAt",
      "isTest",
      "refundAmount",
      "refundReason",
      "refundedAt",
    ],
    dateFields: ["createdAt", "expiresAt", "creditedAt", "refundedAt"],
  },
  paymentMethod: {
    collection: "payment_methods",
    fields: [
      "id",
      "userId",
      "yokassaMethodId",
      "type",
      "title",
      "cardLast4",
      "cardBrand",
      "cardExpMonth",
      "cardExpYear",
      "isDefault",
      "createdAt",
      "allowAutoCharge",
    ],
    dateFields: ["createdAt"],
    relations: {
      user: { model: "user", type: "one", localField: "userId", foreignField: "id" },
    },
  },
  yokassaSettings: {
    collection: "yokassa_settings",
    fields: ["id", "mode", "createdAt", "updatedAt", "testSubscriptionEnabled", "sbpProvider"],
    dateFields: ["createdAt", "updatedAt"],
  },
  promoCode: {
    collection: "promo_codes",
    fields: ["id", "code", "conditions", "effects", "maxActivations", "createdAt"],
    dateFields: ["createdAt"],
    relations: {
      activations: { model: "promoActivation", type: "many", localField: "id", foreignField: "promoCodeId" },
    },
  },
  promoActivation: {
    collection: "promo_activations",
    fields: ["id", "userId", "promoCodeId", "activatedAt"],
    dateFields: ["activatedAt"],
    relations: {
      user: { model: "user", type: "one", localField: "userId", foreignField: "id" },
      promoCode: { model: "promoCode", type: "one", localField: "promoCodeId", foreignField: "id" },
    },
  },
  withdrawal: {
    collection: "withdrawals",
    fields: ["id", "userId", "amount", "target", "bank", "status", "createdAt", "processedAt"],
    dateFields: ["createdAt", "processedAt"],
    relations: {
      user: { model: "user", type: "one", localField: "userId", foreignField: "id" },
    },
  },
  supportTicket: {
    collection: "support_tickets",
    fields: ["id", "userId", "message", "reply", "status", "createdAt", "updatedAt"],
    dateFields: ["createdAt", "updatedAt"],
    relations: {
      user: { model: "user", type: "one", localField: "userId", foreignField: "id" },
    },
  },
  vpnServer: {
    collection: "vpn_servers",
    fields: [
      "id",
      "ip",
      "hostname",
      "port",
      "status",
      "currentLoad",
      "lastSeenAt",
      "createdAt",
      "serverType",
      "supportedProtocols",
      "location",
      "connectLinkTemplate",
    ],
    dateFields: ["lastSeenAt", "createdAt"],
  },
    mtprotoSettings: {
      collection: "mtproto_settings",
      fields: [
        "id",
        "enabled",
        "port",
        "secret",
        "adTag",
        "channelUsername",
        "botUsername",
        "addChannelOnConnect",
        "createdAt",
        "updatedAt",
    ],
    dateFields: ["createdAt", "updatedAt"],
  },
  telegram_mailings: {
    collection: "telegram_mailings",
    fields: [
      "id",
      "title",
      "message",
      "buttonText",
      "buttonUrl",
      "targetType",
      "selectedUserIds",
      "status",
      "scheduledAt",
      "processingAt",
      "sentAt",
      "targetCount",
      "sentCount",
      "failedCount",
      "lastError",
      "createdAt",
      "updatedAt",
      "createdById",
    ],
    dateFields: ["scheduledAt", "processingAt", "sentAt", "createdAt", "updatedAt"],
  },
  telegram_mailing_actions: {
    collection: "telegram_mailing_actions",
    fields: [
      "id",
      "mailingId",
      "userId",
      "token",
      "actionType",
      "actionValue",
      "clickCount",
      "completeCount",
      "firstClickedAt",
      "lastClickedAt",
      "firstCompletedAt",
      "lastCompletedAt",
      "createdAt",
      "updatedAt",
    ],
    dateFields: [
      "firstClickedAt",
      "lastClickedAt",
      "firstCompletedAt",
      "lastCompletedAt",
      "createdAt",
      "updatedAt",
    ],
    relations: {
      user: { model: "user", type: "one", localField: "userId", foreignField: "id" },
      mailing: { model: "telegram_mailings", type: "one", localField: "mailingId", foreignField: "id" },
    },
  },
};

const UPDATE_TIMESTAMP_MODELS = new Set<ModelName>([
  "subscription",
  "supportTicket",
  "yokassaSettings",
  "telegram_mailings",
  "telegram_mailing_actions",
  "subscriptionPlan",
]);

function isPlainObject(value: unknown): value is AnyRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function getConfig(model: ModelName): ModelConfig {
  return MODEL_CONFIG[model];
}

async function getClient(): Promise<VoidClient> {
  if (!authPromise) {
    authPromise = (async () => {
      if (process.env.VOIDDB_USERNAME && process.env.VOIDDB_PASSWORD) {
        await voidClient.login(process.env.VOIDDB_USERNAME, process.env.VOIDDB_PASSWORD);
      }
      return voidClient;
    })().catch((error) => {
      authPromise = null;
      throw error;
    });
  }

  return authPromise;
}

async function getCollection(model: ModelName) {
  const client = await getClient();
  return client.db(DATABASE_NAME).collection<any>(getConfig(model).collection);
}

function valueKey(value: any): string {
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  return `scalar:${JSON.stringify(value)}`;
}

function uniqueValues(values: any[]): any[] {
  return Array.from(new Map(values.filter((value) => value != null).map((value) => [valueKey(value), value])).values());
}

function cloneRow(row: CachedRow): CachedRow {
  const copy = { ...row };
  const cache = row[RELATION_CACHE];
  if (cache) {
    Object.defineProperty(copy, RELATION_CACHE, {
      value: { ...cache },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

function relationCache(row: CachedRow): Record<string, any> {
  if (!row[RELATION_CACHE]) {
    Object.defineProperty(row, RELATION_CACHE, {
      value: {},
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return row[RELATION_CACHE]!;
}

function getCachedRelation(row: CachedRow, name: string) {
  return row[RELATION_CACHE]?.[name];
}

function setCachedRelation(row: CachedRow, name: string, value: any) {
  relationCache(row)[name] = value;
}

function toAppScalar(model: ModelName, field: string, value: any) {
  if (value == null) return value;

  const config = getConfig(model);
  if (config.dateFields.includes(field)) {
    return value instanceof Date ? value : new Date(String(value));
  }
  if (config.bigintFields?.includes(field)) {
    return typeof value === "bigint" ? value : BigInt(value);
  }
  return value;
}

function toAppRow(model: ModelName, raw: AnyRecord): CachedRow {
  const row: CachedRow = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const field = key === "_id" ? "id" : key;
    row[field] = toAppScalar(model, field, value);
  }
  return row;
}

function toDbValue(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((item) => toDbValue(item));
  if (isPlainObject(value)) {
    const out: AnyRecord = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = toDbValue(nestedValue);
    }
    return out;
  }
  return value;
}

function toDbData(data: AnyRecord): AnyRecord {
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    out[key === "id" ? "_id" : key] = toDbValue(value);
  }
  return out;
}

function withCreateDefaults(model: ModelName, data: AnyRecord): AnyRecord {
  const now = new Date();
  const defaults: AnyRecord = {};

  switch (model) {
    case "user":
      Object.assign(defaults, {
        balance: 0,
        referralBalance: 0,
        isBanned: false,
        isAdmin: false,
        hideAiMenu: false,
        joinedAt: now,
        pendingDiscountFixed: 0,
        pendingDiscountPct: 0,
        referralRate: 0.05,
        aiFreeTokensUsed: 0,
        aiPurchasedTokens: 0,
      });
      break;
    case "subscription":
      Object.assign(defaults, {
        activeUntil: now,
        isLifetime: false,
        createdAt: now,
        updatedAt: now,
        autoRenewal: true,
        billingPeriod: "monthly",
      });
      break;
    case "transaction":
      Object.assign(defaults, { createdAt: now, isTest: false });
      break;
    case "payment":
      Object.assign(defaults, {
        status: "pending",
        provider: "tochka",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        isTest: false,
      });
      break;
    case "paymentMethod":
      Object.assign(defaults, {
        type: "bank_card",
        isDefault: false,
        createdAt: now,
        allowAutoCharge: true,
      });
      break;
    case "yokassaSettings":
      Object.assign(defaults, {
        id: "global",
        mode: "test",
        testSubscriptionEnabled: false,
        sbpProvider: "tochka",
        createdAt: now,
        updatedAt: now,
      });
      break;
    case "promoCode":
      Object.assign(defaults, { createdAt: now });
      break;
    case "promoActivation":
      Object.assign(defaults, { activatedAt: now });
      break;
    case "withdrawal":
      Object.assign(defaults, { status: "pending", createdAt: now });
      break;
    case "supportTicket":
      Object.assign(defaults, { status: "open", createdAt: now, updatedAt: now });
      break;
    case "telegram_mailings":
      Object.assign(defaults, {
        selectedUserIds: [],
        status: "scheduled",
        targetCount: 0,
        sentCount: 0,
        failedCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      break;
    case "telegram_mailing_actions":
      Object.assign(defaults, {
        clickCount: 0,
        completeCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      break;
    default:
      break;
  }

  return { ...defaults, ...data };
}

function withUpdateDefaults(model: ModelName, data: AnyRecord): AnyRecord {
  if (UPDATE_TIMESTAMP_MODELS.has(model) && data.updatedAt === undefined) {
    return { ...data, updatedAt: new Date() };
  }
  return { ...data };
}

function isOperatorObject(value: unknown): value is AnyRecord {
  if (!isPlainObject(value)) return false;

  return [
    "equals",
    "in",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "endsWith",
    "mode",
    "not",
  ].some((key) => key in value);
}

function isCompoundUniqueAlias(model: ModelName, key: string, value: unknown): boolean {
  if (!isPlainObject(value)) return false;

  const config = getConfig(model);
  return key !== "AND" && key !== "OR" && !config.fields.includes(key) && !config.relations?.[key];
}

function normalizeWhere(model: ModelName, where: AnyRecord | undefined): AnyRecord | undefined {
  if (!where || !isPlainObject(where)) {
    return where;
  }

  const normalized: AnyRecord = {};

  for (const [key, value] of Object.entries(where)) {
    if ((key === "AND" || key === "OR") && Array.isArray(value)) {
      normalized[key] = value.map((item) => normalizeWhere(model, item));
      continue;
    }

    if (isCompoundUniqueAlias(model, key, value)) {
      Object.assign(normalized, normalizeWhere(model, value));
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function mergeWhere(left?: AnyRecord, right?: AnyRecord): AnyRecord | undefined {
  if (!left) return right;
  if (!right) return left;
  return { AND: [left, right] };
}

function supportsServerFilter(model: ModelName, where: AnyRecord | undefined): boolean {
  if (!where || !isPlainObject(where)) {
    return true;
  }

  const config = getConfig(model);

  for (const [key, value] of Object.entries(where)) {
    if ((key === "AND" || key === "OR") && Array.isArray(value)) {
      if (!value.every((item) => supportsServerFilter(model, item))) {
        return false;
      }
      continue;
    }

    if (config.relations?.[key]) {
      return false;
    }

    if (isCompoundUniqueAlias(model, key, value)) {
      return supportsServerFilter(model, value);
    }

    if (isOperatorObject(value)) {
      if (value.mode) return false;
      if (value.endsWith !== undefined) return false;
      if (value.not && isPlainObject(value.not)) return false;
    }
  }

  return true;
}

function compileScalarFilter(field: string, value: unknown): QueryNode | undefined {
  if (!isOperatorObject(value)) {
    return { field, op: "eq", value: toDbValue(value) };
  }

  if (value.mode) {
    return undefined;
  }

  const nodes: QueryNode[] = [];

  if (value.equals !== undefined) nodes.push({ field, op: "eq", value: toDbValue(value.equals) });
  if (value.in !== undefined) nodes.push({ field, op: "in", value: toDbValue(value.in) });
  if (value.lt !== undefined) nodes.push({ field, op: "lt", value: toDbValue(value.lt) });
  if (value.lte !== undefined) nodes.push({ field, op: "lte", value: toDbValue(value.lte) });
  if (value.gt !== undefined) nodes.push({ field, op: "gt", value: toDbValue(value.gt) });
  if (value.gte !== undefined) nodes.push({ field, op: "gte", value: toDbValue(value.gte) });
  if (value.contains !== undefined) nodes.push({ field, op: "contains", value: toDbValue(value.contains) });
  if (value.startsWith !== undefined) {
    nodes.push({ field, op: "starts_with", value: toDbValue(value.startsWith) });
  }
  if (value.not !== undefined) {
    if (isPlainObject(value.not)) {
      return undefined;
    }
    nodes.push({ field, op: "ne", value: toDbValue(value.not) });
  }

  if (!nodes.length) return undefined;
  if (nodes.length === 1) return nodes[0];
  return { AND: nodes };
}

function compileServerWherePartial(model: ModelName, where: AnyRecord | undefined): QueryNode | undefined {
  if (!where || !isPlainObject(where)) {
    return undefined;
  }

  const config = getConfig(model);
  const nodes: QueryNode[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (key === "AND" && Array.isArray(value)) {
      const nested = value
        .map((item) => compileServerWherePartial(model, item))
        .filter((item): item is QueryNode => Boolean(item));
      if (nested.length === 1) nodes.push(nested[0]!);
      if (nested.length > 1) nodes.push({ AND: nested });
      continue;
    }

    if (key === "OR" && Array.isArray(value)) {
      const nested = value
        .map((item) => compileServerWherePartial(model, item))
        .filter((item): item is QueryNode => Boolean(item));
      if (nested.length === value.length && nested.length > 1) {
        nodes.push({ OR: nested });
      } else if (nested.length === 1 && value.length === 1) {
        nodes.push(nested[0]!);
      }
      continue;
    }

    if (config.relations?.[key]) {
      continue;
    }

    if (isCompoundUniqueAlias(model, key, value)) {
      const nested = compileServerWherePartial(model, value);
      if (nested) nodes.push(nested);
      continue;
    }

    const scalar = compileScalarFilter(key === "id" ? "_id" : key, value);
    if (scalar) nodes.push(scalar);
  }

  if (!nodes.length) return undefined;
  if (nodes.length === 1) return nodes[0];
  return { AND: nodes };
}

function compileOrderBy(orderBy: OrderByInput | undefined): SortClause[] | undefined {
  if (!orderBy) return undefined;

  const normalized = Array.isArray(orderBy) ? orderBy : [orderBy];
  const clauses = normalized.flatMap((item) =>
    Object.entries(item).map(([field, dir]) => ({
      field: field === "id" ? "_id" : field,
      dir,
    })),
  );

  return clauses.length ? clauses : undefined;
}

function toTimestamp(value: any): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function valuesEqual(actual: any, expected: any, mode?: string): boolean {
  if (actual == null || expected == null) {
    return actual === expected;
  }

  if (actual instanceof Date || expected instanceof Date) {
    return toTimestamp(actual) === toTimestamp(expected);
  }

  if (typeof actual === "bigint" || typeof expected === "bigint") {
    try {
      return BigInt(actual) === BigInt(expected);
    } catch {
      return String(actual) === String(expected);
    }
  }

  if (typeof actual === "string" && typeof expected === "string" && mode === "insensitive") {
    return actual.toLowerCase() === expected.toLowerCase();
  }

  return actual === expected;
}

function compareValues(actual: any, expected: any): number {
  if (actual == null && expected == null) return 0;
  if (actual == null) return -1;
  if (expected == null) return 1;

  if (actual instanceof Date || expected instanceof Date) {
    return (toTimestamp(actual) ?? 0) - (toTimestamp(expected) ?? 0);
  }

  if (typeof actual === "bigint" || typeof expected === "bigint") {
    try {
      const left = BigInt(actual);
      const right = BigInt(expected);
      return left === right ? 0 : left > right ? 1 : -1;
    } catch {
      return String(actual).localeCompare(String(expected));
    }
  }

  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }

  return String(actual).localeCompare(String(expected));
}

function matchesScalar(actual: any, filter: any): boolean {
  if (!isOperatorObject(filter)) {
    return valuesEqual(actual, filter);
  }

  const mode = typeof filter.mode === "string" ? filter.mode : undefined;

  if (filter.equals !== undefined && !valuesEqual(actual, filter.equals, mode)) return false;
  if (filter.in !== undefined && (!Array.isArray(filter.in) || !filter.in.some((entry: any) => valuesEqual(actual, entry, mode)))) {
    return false;
  }
  if (filter.lt !== undefined && !(compareValues(actual, filter.lt) < 0)) return false;
  if (filter.lte !== undefined && !(compareValues(actual, filter.lte) <= 0)) return false;
  if (filter.gt !== undefined && !(compareValues(actual, filter.gt) > 0)) return false;
  if (filter.gte !== undefined && !(compareValues(actual, filter.gte) >= 0)) return false;

  if (filter.contains !== undefined) {
    if (typeof actual === "string" && typeof filter.contains === "string") {
      const haystack = mode === "insensitive" ? actual.toLowerCase() : actual;
      const needle = mode === "insensitive" ? filter.contains.toLowerCase() : filter.contains;
      if (!haystack.includes(needle)) return false;
    } else if (Array.isArray(actual)) {
      if (!actual.some((item) => valuesEqual(item, filter.contains, mode))) return false;
    } else {
      return false;
    }
  }

  if (filter.startsWith !== undefined) {
    if (typeof actual !== "string" || typeof filter.startsWith !== "string") return false;
    const haystack = mode === "insensitive" ? actual.toLowerCase() : actual;
    const needle = mode === "insensitive" ? filter.startsWith.toLowerCase() : filter.startsWith;
    if (!haystack.startsWith(needle)) return false;
  }

  if (filter.endsWith !== undefined) {
    if (typeof actual !== "string" || typeof filter.endsWith !== "string") return false;
    const haystack = mode === "insensitive" ? actual.toLowerCase() : actual;
    const needle = mode === "insensitive" ? filter.endsWith.toLowerCase() : filter.endsWith;
    if (!haystack.endsWith(needle)) return false;
  }

  if (filter.not !== undefined && matchesScalar(actual, filter.not)) return false;
  return true;
}

async function ensureWhereRelationsLoaded(model: ModelName, rows: CachedRow[], where: AnyRecord | undefined): Promise<void> {
  if (!where || !rows.length || !isPlainObject(where)) {
    return;
  }

  const config = getConfig(model);

  for (const [key, value] of Object.entries(where)) {
    if ((key === "AND" || key === "OR") && Array.isArray(value)) {
      for (const item of value) {
        await ensureWhereRelationsLoaded(model, rows, item);
      }
      continue;
    }

    const relation = config.relations?.[key];
    if (!relation || !isPlainObject(value)) {
      continue;
    }

    if (!("some" in value || "none" in value || "is" in value || "isNot" in value)) {
      continue;
    }

    await ensureRelationLoaded(model, rows, key, undefined);

    const nestedFilters = [value.some, value.none, value.is, value.isNot].filter(Boolean);
    const relatedRows = rows.flatMap((row) => {
      const cached = getCachedRelation(row, key);
      if (Array.isArray(cached)) return cached;
      return cached ? [cached] : [];
    });

    for (const filter of nestedFilters) {
      if (filter && filter !== null) {
        await ensureWhereRelationsLoaded(relation.model, relatedRows, filter);
      }
    }
  }
}

async function matchesWhere(model: ModelName, row: CachedRow, where: AnyRecord | undefined): Promise<boolean> {
  if (!where || !isPlainObject(where)) {
    return true;
  }

  const config = getConfig(model);

  for (const [key, value] of Object.entries(where)) {
    if (key === "AND" && Array.isArray(value)) {
      const results = await Promise.all(value.map((item) => matchesWhere(model, row, item)));
      if (!results.every(Boolean)) return false;
      continue;
    }

    if (key === "OR" && Array.isArray(value)) {
      const results = await Promise.all(value.map((item) => matchesWhere(model, row, item)));
      if (!results.some(Boolean)) return false;
      continue;
    }

    if (isCompoundUniqueAlias(model, key, value)) {
      if (!(await matchesWhere(model, row, value))) return false;
      continue;
    }

    const relation = config.relations?.[key];
    if (relation && isPlainObject(value) && ("some" in value || "none" in value || "is" in value || "isNot" in value)) {
      const related = getCachedRelation(row, key);

      if ("some" in value) {
        const items = Array.isArray(related) ? related : related ? [related] : [];
        const results = await Promise.all(items.map((item) => matchesWhere(relation.model, item, value.some)));
        if (!results.some(Boolean)) return false;
      }

      if ("none" in value) {
        const items = Array.isArray(related) ? related : related ? [related] : [];
        const results = await Promise.all(items.map((item) => matchesWhere(relation.model, item, value.none)));
        if (results.some(Boolean)) return false;
      }

      if ("is" in value) {
        if (value.is == null) {
          if (related != null) return false;
        } else if (!related || !(await matchesWhere(relation.model, related, value.is))) {
          return false;
        }
      }

      if ("isNot" in value) {
        if (value.isNot == null) {
          if (related == null) return false;
        } else if (related && (await matchesWhere(relation.model, related, value.isNot))) {
          return false;
        }
      }

      continue;
    }

    if (!matchesScalar(row[key], value)) {
      return false;
    }
  }

  return true;
}

function sortRows(rows: CachedRow[], orderBy: OrderByInput | undefined): CachedRow[] {
  if (!orderBy) {
    return rows;
  }

  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  const copy = [...rows];
  copy.sort((left, right) => {
    for (const clause of clauses) {
      for (const [field, dir] of Object.entries(clause)) {
        const comparison = compareValues(left[field], right[field]);
        if (comparison !== 0) {
          return dir === "desc" ? -comparison : comparison;
        }
      }
    }
    return 0;
  });
  return copy;
}

function paginateRows(rows: CachedRow[], skip = 0, take?: number): CachedRow[] {
  const start = Math.max(0, skip);
  return take == null ? rows.slice(start) : rows.slice(start, start + Math.max(0, take));
}

async function fetchRows(model: ModelName, args: QueryArgs = {}, options?: { ignorePagination?: boolean }): Promise<CachedRow[]> {
  const where = normalizeWhere(model, args.where);
  const collection = await getCollection(model);
  const fullyServerFilterable = supportsServerFilter(model, where);
  const partialWhere = compileServerWherePartial(model, where);
  const orderBy = compileOrderBy(args.orderBy);

  const spec: QuerySpec = {};
  if (partialWhere) {
    spec.where = partialWhere;
  }
  if (fullyServerFilterable && orderBy?.length) {
    spec.order_by = orderBy;
  }
  if (fullyServerFilterable && !options?.ignorePagination) {
    if (args.skip != null) spec.skip = args.skip;
    if (args.take != null) spec.limit = args.take;
  }

  const rawRows = await collection.find(Object.keys(spec).length ? spec : undefined);
  let rows = Array.from(rawRows || []).map((item) => toAppRow(model, item));

  if (!fullyServerFilterable) {
    await ensureWhereRelationsLoaded(model, rows, where);
    const filtered: CachedRow[] = [];
    for (const row of rows) {
      if (await matchesWhere(model, row, where)) {
        filtered.push(row);
      }
    }
    rows = filtered;
  }

  if (!fullyServerFilterable || !orderBy?.length) {
    rows = sortRows(rows, args.orderBy);
  }

  if (!options?.ignorePagination) {
    rows = paginateRows(rows, args.skip, args.take);
  }

  return rows;
}

async function ensureRelationLoaded(
  model: ModelName,
  rows: CachedRow[],
  relationName: string,
  relationArgs: AnyRecord | true | undefined,
): Promise<void> {
  if (!rows.length) {
    return;
  }

  const relation = getConfig(model).relations?.[relationName];
  if (!relation) {
    return;
  }

  const unresolved = rows.filter((row) => getCachedRelation(row, relationName) === undefined);
  if (!unresolved.length) {
    return;
  }

  const keys = uniqueValues(unresolved.map((row) => row[relation.localField]));
  if (!keys.length) {
    for (const row of unresolved) {
      setCachedRelation(row, relationName, relation.type === "many" ? [] : null);
    }
    return;
  }

  const normalizedArgs = relationArgs && relationArgs !== true ? relationArgs : {};
  const relatedRows = await fetchRows(
    relation.model,
    {
      where: mergeWhere({ [relation.foreignField]: { in: keys } }, normalizedArgs.where),
    },
    { ignorePagination: true },
  );

  const grouped = new Map<string, CachedRow[]>();
  for (const relatedRow of relatedRows) {
    const bucketKey = valueKey(relatedRow[relation.foreignField]);
    const bucket = grouped.get(bucketKey);
    if (bucket) {
      bucket.push(relatedRow);
    } else {
      grouped.set(bucketKey, [relatedRow]);
    }
  }

  for (const row of unresolved) {
    const bucket = [...(grouped.get(valueKey(row[relation.localField])) || [])];
    let projected = sortRows(bucket, normalizedArgs.orderBy);
    projected = paginateRows(projected, normalizedArgs.skip, normalizedArgs.take);
    projected = await applyProjection(relation.model, projected, normalizedArgs);

    if (relation.type === "many") {
      setCachedRelation(row, relationName, projected);
    } else {
      setCachedRelation(row, relationName, projected[0] ?? null);
    }
  }
}

async function applyCountSelection(model: ModelName, rows: CachedRow[], countArgs: AnyRecord): Promise<void> {
  const countSelect = countArgs?.select || {};
  const relationNames = Object.entries(countSelect)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  for (const relationName of relationNames) {
    await ensureRelationLoaded(model, rows, relationName, undefined);
  }

  for (const row of rows) {
    const counts: AnyRecord = {};
    for (const relationName of relationNames) {
      const value = getCachedRelation(row, relationName);
      counts[relationName] = Array.isArray(value) ? value.length : value ? 1 : 0;
    }
    row._count = counts;
  }
}

async function applyProjection(model: ModelName, rows: CachedRow[], args: Pick<QueryArgs, "select" | "include"> = {}): Promise<any[]> {
  if (!rows.length) {
    return [];
  }

  const include = args.include;
  const select = args.select;
  const working = rows.map((row) => cloneRow(row));

  const relationRequests: Array<{ key: string; value: AnyRecord | true }> = [];

  if (include && isPlainObject(include)) {
    for (const [key, value] of Object.entries(include)) {
      if (key !== "_count" && value) {
        relationRequests.push({ key, value: value === true ? true : (value as AnyRecord) });
      }
    }
  }

  if (select && isPlainObject(select)) {
    for (const [key, value] of Object.entries(select)) {
      if (key !== "_count" && value && getConfig(model).relations?.[key]) {
        relationRequests.push({ key, value: value === true ? true : (value as AnyRecord) });
      }
    }
  }

  const dedupedRelations = new Map<string, AnyRecord | true>();
  for (const relationRequest of relationRequests) {
    dedupedRelations.set(relationRequest.key, relationRequest.value);
  }

  for (const [relationName, relationArgs] of dedupedRelations) {
    await ensureRelationLoaded(model, working, relationName, relationArgs);
  }

  if (include?._count) {
    await applyCountSelection(model, working, include._count);
  }
  if (select?._count) {
    await applyCountSelection(model, working, select._count);
  }

  if (!select) {
    if (include && isPlainObject(include)) {
      for (const [key, value] of Object.entries(include)) {
        if (key === "_count" || !value || !getConfig(model).relations?.[key]) {
          continue;
        }

        for (const row of working) {
          row[key] = getCachedRelation(row, key);
        }
      }
    }

    return working;
  }

  return working.map((row) => {
    const projected: AnyRecord = {};
    for (const [key, value] of Object.entries(select)) {
      if (!value) continue;

      if (value === true || key === "_count") {
        projected[key] = row[key];
        continue;
      }

      if (getConfig(model).relations?.[key]) {
        projected[key] = getCachedRelation(row, key);
      }
    }
    return projected;
  });
}

async function executeFindMany(model: ModelName, args: QueryArgs = {}): Promise<any[]> {
  const rows = await fetchRows(model, args);
  return applyProjection(model, rows, args);
}

async function executeFindFirst(model: ModelName, args: QueryArgs = {}): Promise<any | null> {
  const rows = await executeFindMany(model, { ...args, take: 1 });
  return rows[0] ?? null;
}

function applyDataPatch(row: CachedRow, data: AnyRecord): AnyRecord {
  const patch: AnyRecord = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) {
      continue;
    }

    if (
      isPlainObject(value) &&
      Object.keys(value).length > 0 &&
      Object.keys(value).every((entry) => entry === "increment" || entry === "decrement")
    ) {
      const current = Number(row[key] ?? 0);
      const increment = Number(value.increment ?? 0);
      const decrement = Number(value.decrement ?? 0);
      patch[key] = current + increment - decrement;
      continue;
    }

    patch[key] = value;
  }

  return patch;
}

function notFoundError(model: ModelName, where: AnyRecord): Error {
  return new Error(`VoidDB ${model} record not found for ${JSON.stringify(where)}`);
}

class VoidPrismaDelegate implements PrismaDelegate {
  constructor(private readonly model: ModelName) {}

  async findUnique(args: QueryArgs = {}) {
    return executeFindFirst(this.model, args);
  }

  async findFirst(args: QueryArgs = {}) {
    return executeFindFirst(this.model, args);
  }

  async findMany(args: QueryArgs = {}) {
    return executeFindMany(this.model, args);
  }

  async count(args: Pick<QueryArgs, "where"> = {}) {
    const where = normalizeWhere(this.model, args.where);
    if (supportsServerFilter(this.model, where)) {
      const collection = await getCollection(this.model);
      const query = compileServerWherePartial(this.model, where);
      return collection.count(query ? { where: query } : undefined);
    }

    const rows = await fetchRows(this.model, { where }, { ignorePagination: true });
    return rows.length;
  }

  async create(args: { data: AnyRecord; select?: AnyRecord; include?: AnyRecord }) {
    const collection = await getCollection(this.model);
    const data = withCreateDefaults(this.model, args.data);
    const dbData = toDbData(data);
    const insertedId = await collection.insert(dbData);
    return executeFindFirst(this.model, {
      where: { id: data.id ?? insertedId },
      select: args.select,
      include: args.include,
    });
  }

  async update(args: { where: AnyRecord; data: AnyRecord; select?: AnyRecord; include?: AnyRecord }) {
    const collection = await getCollection(this.model);
    const existing = await fetchRows(this.model, { where: args.where, take: 1 }, { ignorePagination: true });
    const row = existing[0];
    if (!row) {
      throw notFoundError(this.model, args.where);
    }

    const patch = withUpdateDefaults(this.model, applyDataPatch(row, args.data));
    await collection.patch(String(row.id), toDbData(patch));

    return executeFindFirst(this.model, {
      where: { id: row.id },
      select: args.select,
      include: args.include,
    });
  }

  async updateMany(args: { where?: AnyRecord; data: AnyRecord }) {
    const collection = await getCollection(this.model);
    const rows = await fetchRows(this.model, { where: args.where }, { ignorePagination: true });

    for (const row of rows) {
      const patch = withUpdateDefaults(this.model, applyDataPatch(row, args.data));
      await collection.patch(String(row.id), toDbData(patch));
    }

    return { count: rows.length };
  }

  async deleteMany(args: { where?: AnyRecord }) {
    const collection = await getCollection(this.model);
    const rows = await fetchRows(this.model, { where: args.where }, { ignorePagination: true });

    for (const row of rows) {
      await collection.delete(String(row.id));
    }

    return { count: rows.length };
  }

  async delete(args: { where: AnyRecord; select?: AnyRecord; include?: AnyRecord }) {
    const collection = await getCollection(this.model);
    const existing = await executeFindFirst(this.model, {
      where: args.where,
      select: args.select,
      include: args.include,
    });
    if (!existing) {
      throw notFoundError(this.model, args.where);
    }

    await collection.delete(String(existing.id));
    return existing;
  }

  async upsert(args: {
    where: AnyRecord;
    create: AnyRecord;
    update: AnyRecord;
    select?: AnyRecord;
    include?: AnyRecord;
  }) {
    const existing = await executeFindFirst(this.model, { where: args.where });
    if (existing) {
      return this.update({
        where: { id: existing.id },
        data: args.update,
        select: args.select,
        include: args.include,
      });
    }

    return this.create({
      data: args.create,
      select: args.select,
      include: args.include,
    });
  }
}

class VoidPrismaClient implements PrismaLikeClient {
  user = new VoidPrismaDelegate("user");
  subscriptionPlan = new VoidPrismaDelegate("subscriptionPlan");
  subscriptionPrice = new VoidPrismaDelegate("subscriptionPrice");
  subscription = new VoidPrismaDelegate("subscription");
  transaction = new VoidPrismaDelegate("transaction");
  payment = new VoidPrismaDelegate("payment");
  paymentMethod = new VoidPrismaDelegate("paymentMethod");
  yokassaSettings = new VoidPrismaDelegate("yokassaSettings");
  promoCode = new VoidPrismaDelegate("promoCode");
  promoActivation = new VoidPrismaDelegate("promoActivation");
  withdrawal = new VoidPrismaDelegate("withdrawal");
  supportTicket = new VoidPrismaDelegate("supportTicket");
  vpnServer = new VoidPrismaDelegate("vpnServer");
  mtprotoSettings = new VoidPrismaDelegate("mtprotoSettings");
  telegram_mailings = new VoidPrismaDelegate("telegram_mailings");
  telegram_mailing_actions = new VoidPrismaDelegate("telegram_mailing_actions");

  async $disconnect() {
    return;
  }

  async $transaction<T>(input: Promise<T>[] | ((tx: PrismaLikeClient) => Promise<T>)) {
    if (Array.isArray(input)) {
      return Promise.all(input);
    }

    return input(this);
  }
}

export const prisma: PrismaLikeClient = new VoidPrismaClient();
