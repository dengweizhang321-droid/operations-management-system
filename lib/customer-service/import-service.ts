import * as XLSX from "xlsx";

export type ChatMessage = { sender: string; sentAt: string; content: string };

export type CustomerServiceSession = {
  sourceRowNumber: number;
  consultedAt: string;
  customerId: string;
  customerAlias: string;
  consultationType: string;
  agent: string;
  transferredAgent: string;
  skillGroup: string;
  productSku: string;
  productName: string;
  firstResponseAt: string;
  responseSeconds: number | null;
  durationMinutes: number | null;
  customerMessageCount: number | null;
  agentMessageCount: number | null;
  satisfaction: string;
  resolved: string;
  conversationId: string;
};

export type ParsedChatSession = {
  sourceNumber: number;
  customerAlias: string;
  startedAt: string;
  endedAt: string;
  messages: ChatMessage[];
};

export type CustomerServiceConversationInput = CustomerServiceSession & {
  conversationKey: string;
  matchStatus: "matched" | "session_only" | "chat_only" | "ambiguous";
  matchConfidence: "exact" | "time_only" | "review" | "none";
  chatStartedAt: string;
  chatEndedAt: string;
  chatCustomerAlias: string;
  messages: ChatMessage[];
};

export type CustomerServiceParseResult = {
  conversations: CustomerServiceConversationInput[];
  summary: {
    sessionCount: number;
    chatSessionCount: number;
    matchedCount: number;
    timeOnlyMatchedCount: number;
    sessionOnlyCount: number;
    chatOnlyCount: number;
    ambiguousCount: number;
  };
  warnings: string[];
};

type Row = Record<string, unknown>;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;
const SPEAKER_LINE = /^(.*?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*$/;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function normalizedHeader(value: string) {
  return value.replace(/^\s+/, "").replace(/\s+/g, "").trim();
}

function normalizeDateTime(value: unknown): string {
  const text = asText(value).replace(/[T/]/g, " ").replace(/\s+/g, " ");
  if (DATE_TIME.test(text)) return text;
  const match = text.match(/(\d{4})[-.]?(\d{1,2})[-.]?(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}:${second}`;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(asText(value));
  return Number.isFinite(number) ? number : null;
}

function stableTextHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function customerAlias(value: string) {
  const text = asText(value);
  if (!text) return "";
  if (text.includes("*")) return text.toLowerCase();
  if (text.length <= 3) return text.toLowerCase();
  return `${text.slice(0, 1)}****${text.slice(-2)}`.toLowerCase();
}

function aliasMatches(customerId: string, alias: string) {
  const expected = customerAlias(customerId);
  const actual = customerAlias(alias);
  if (!expected || !actual) return false;
  if (!actual.includes("*")) return expected === actual || customerId.toLowerCase() === actual;
  const [prefix, suffix] = actual.split(/\*+/);
  return expected === actual || (customerId.toLowerCase().startsWith(prefix) && customerId.toLowerCase().endsWith(suffix));
}

function pick(row: Row, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && asText(value)) return value;
  }
  return "";
}

export function parseSessionWorkbook(bytes: Uint8Array): CustomerServiceSession[] {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("会话记录工作簿没有可读取的工作表");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], { header: 1, defval: "", raw: true });
  const headers = (matrix[0] ?? []).map((value) => normalizedHeader(asText(value)));
  const required = ["咨询时间", "顾客"];
  const missing = required.filter((item) => !headers.includes(item));
  if (missing.length) throw new Error(`会话记录缺少必填列：${missing.join("、")}`);
  const rows = matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))) as Row[];
  const parsed: CustomerServiceSession[] = [];
  rows.forEach((row, index) => {
    const consultedAt = normalizeDateTime(pick(row, "咨询时间"));
    const customerId = asText(pick(row, "顾客"));
    if (!consultedAt || !customerId) return;
    parsed.push({
      sourceRowNumber: index + 2,
      consultedAt,
      customerId,
      customerAlias: customerAlias(customerId),
      consultationType: asText(pick(row, "咨询类型")),
      agent: asText(pick(row, "客服")),
      transferredAgent: asText(pick(row, "转接后客服")),
      skillGroup: asText(pick(row, "技能组")),
      productSku: asText(pick(row, "商品编号")),
      productName: asText(pick(row, "商品名称")),
      firstResponseAt: normalizeDateTime(pick(row, "首次响应时间")),
      responseSeconds: numberOrNull(pick(row, "新平均响应时间(S)", "平均响应时间(S)")),
      durationMinutes: numberOrNull(pick(row, "会话时长(M)")),
      customerMessageCount: numberOrNull(pick(row, "客户消息数")),
      agentMessageCount: numberOrNull(pick(row, "客服消息数")),
      satisfaction: asText(pick(row, "满意度")),
      resolved: asText(pick(row, "是否解决")),
      conversationId: asText(pick(row, "cid")),
    });
  });
  if (!parsed.length) throw new Error("会话记录中未找到有效的“咨询时间 + 顾客”记录");
  return parsed;
}

export function parseChatLog(text: string): ParsedChatSession[] {
  const parts = text.replace(/^\uFEFF/, "").split(/\/\*+\s*以下为一通会话\s*\*+\/\s*/g);
  const sessions: ParsedChatSession[] = [];
  for (const part of parts) {
    const lines = part.replace(/\r/g, "").split("\n").map((line) => line.replace(/\t/g, "").trimEnd());
    const messages: ChatMessage[] = [];
    let active: ChatMessage | null = null;
    for (const original of lines) {
      const line = original.trim();
      const speaker = line.match(SPEAKER_LINE);
      if (speaker) {
        if (active) messages.push({ ...active, content: active.content.trim() });
        active = { sender: speaker[1].trim(), sentAt: normalizeDateTime(speaker[2]), content: "" };
      } else if (active) {
        active.content = active.content ? `${active.content}\n${original.trim()}` : original.trim();
      }
    }
    if (active) messages.push({ ...active, content: active.content.trim() });
    if (!messages.length) continue;
    sessions.push({
      sourceNumber: sessions.length + 1,
      customerAlias: customerAlias(messages[0].sender),
      startedAt: messages[0].sentAt,
      endedAt: messages[messages.length - 1].sentAt,
      messages,
    });
  }
  if (!sessions.length) throw new Error("聊天记录中未识别到会话分隔符或带时间的发言行");
  return sessions;
}

function chatOnlyConversation(chat: ParsedChatSession): CustomerServiceConversationInput {
  const first = chat.messages[0];
  const last = chat.messages[chat.messages.length - 1];
  // Do not use the export ordinal here.  A supplementary log can contain the
  // same chat in a different order, and the row number would create a second
  // database identity for identical content.
  const contentIdentity = [
    chat.startedAt,
    chat.customerAlias,
    chat.endedAt,
    chat.messages.length,
    first?.sender ?? "",
    first?.content ?? "",
    last?.sender ?? "",
    last?.content ?? "",
  ].join("\u001f");
  return {
    sourceRowNumber: 0, consultedAt: chat.startedAt, customerId: "", customerAlias: "", consultationType: "", agent: "", transferredAgent: "", skillGroup: "", productSku: "", productName: "", firstResponseAt: "", responseSeconds: null, durationMinutes: null, customerMessageCount: null, agentMessageCount: null, satisfaction: "", resolved: "", conversationId: "",
    conversationKey: `chat:${chat.startedAt}:${chat.customerAlias}:${stableTextHash(contentIdentity)}`,
    matchStatus: "chat_only", matchConfidence: "none", chatStartedAt: chat.startedAt, chatEndedAt: chat.endedAt, chatCustomerAlias: chat.customerAlias, messages: chat.messages,
  };
}

export function matchCustomerServiceRecords(sessions: CustomerServiceSession[], chats: ParsedChatSession[]): CustomerServiceParseResult {
  const usedSessionRows = new Set<number>();
  const conversations: CustomerServiceConversationInput[] = [];
  let matchedCount = 0;
  let timeOnlyMatchedCount = 0;
  let ambiguousCount = 0;
  const warnings: string[] = [];
  const matchedChats = new Set<number>();
  const asMilliseconds = (value: string) => Date.parse(`${value.replace(" ", "T")}+08:00`);
  const sessionsByTime = new Map<string, CustomerServiceSession[]>();
  for (const session of sessions) {
    const bucket = sessionsByTime.get(session.consultedAt);
    if (bucket) bucket.push(session);
    else sessionsByTime.set(session.consultedAt, [session]);
  }
  const sortedSessions = sessions
    .map((session) => ({ session, timestamp: asMilliseconds(session.consultedAt) }))
    .sort((left, right) => left.timestamp - right.timestamp);
  const lowerBound = (timestamp: number) => {
    let low = 0;
    let high = sortedSessions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sortedSessions[middle].timestamp < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const availableAtTime = (timestamp: string) =>
    (sessionsByTime.get(timestamp) ?? []).filter((session) => !usedSessionRows.has(session.sourceRowNumber));
  const availableNearby = (timestamp: string) => {
    const center = asMilliseconds(timestamp);
    if (!Number.isFinite(center)) return [];
    const candidates: CustomerServiceSession[] = [];
    for (let index = lowerBound(center - 120_000); index < sortedSessions.length; index += 1) {
      const item = sortedSessions[index];
      if (item.timestamp > center + 120_000) break;
      if (!usedSessionRows.has(item.session.sourceRowNumber)) candidates.push(item.session);
    }
    return candidates;
  };
  const addMatch = (chat: ParsedChatSession, session: CustomerServiceSession, exact: boolean) => {
    usedSessionRows.add(session.sourceRowNumber); matchedChats.add(chat.sourceNumber);
    if (exact) matchedCount += 1; else timeOnlyMatchedCount += 1;
    conversations.push({ ...session, conversationKey: `session:${session.conversationId || `${session.consultedAt}:${session.customerId}`}`, matchStatus: "matched", matchConfidence: exact ? "exact" : "time_only", chatStartedAt: chat.startedAt, chatEndedAt: chat.endedAt, chatCustomerAlias: chat.customerAlias, messages: chat.messages });
  };
  // Pass one is deliberately strict.  It associates the customer-led log
  // fragments before considering agent-led fragments that can start seconds
  // after a transfer, preventing a later fragment from stealing the session.
  for (const chat of chats) {
    const candidates = availableAtTime(chat.startedAt).filter((session) => aliasMatches(session.customerId, chat.customerAlias));
    if (candidates.length === 1) addMatch(chat, candidates[0], true);
  }
  for (const chat of chats) {
    if (matchedChats.has(chat.sourceNumber)) continue;
    const sameTime = availableAtTime(chat.startedAt);
    if (sameTime.length === 1) addMatch(chat, sameTime[0], false);
  }
  // A transfer/export can make the first visible chat line lag the consultation
  // row.  Accept a single remaining candidate within two minutes; if customer
  // masking is available it remains the preferred discriminator.
  for (const chat of chats) {
    if (matchedChats.has(chat.sourceNumber)) continue;
    const nearby = availableNearby(chat.startedAt);
    const identityMatches = nearby.filter((session) => aliasMatches(session.customerId, chat.customerAlias));
    const candidates = identityMatches.length ? identityMatches : nearby;
    if (candidates.length === 1) { addMatch(chat, candidates[0], false); continue; }
    if (candidates.length > 1) {
      ambiguousCount += 1;
      warnings.push(`聊天会话 ${chat.startedAt}（${chat.customerAlias || "未知顾客"}）在两分钟内对应 ${candidates.length} 条会话记录，未自动拼接。`);
    }
    conversations.push(chatOnlyConversation(chat));
  }

  for (const session of sessions) {
    if (usedSessionRows.has(session.sourceRowNumber)) continue;
    conversations.push({
      ...session,
      conversationKey: `session:${session.conversationId || `${session.consultedAt}:${session.customerId}`}`,
      matchStatus: "session_only",
      matchConfidence: "none",
      chatStartedAt: "", chatEndedAt: "", chatCustomerAlias: "", messages: [],
    });
  }
  return {
    conversations,
    summary: {
      sessionCount: sessions.length, chatSessionCount: chats.length, matchedCount, timeOnlyMatchedCount,
      sessionOnlyCount: sessions.length - usedSessionRows.size,
      chatOnlyCount: conversations.filter((item) => item.matchStatus === "chat_only").length,
      ambiguousCount,
    },
    warnings,
  };
}

export function parseCustomerServiceImport(sessionBytes: Uint8Array, chatLog: string) {
  return matchCustomerServiceRecords(parseSessionWorkbook(sessionBytes), parseChatLog(chatLog));
}
