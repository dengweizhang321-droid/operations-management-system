import {
  getSalesDatabase,
  type SalesDatabase,
} from "@/lib/sales/database";

export const workflowTaskStatuses = ["待开始", "工作中", "已完成"] as const;
export type WorkflowTaskStatus = (typeof workflowTaskStatuses)[number];

export const workflowTaskPriorities = ["high", "normal", "low"] as const;
export type WorkflowTaskPriority = (typeof workflowTaskPriorities)[number];

export type WorkflowTask = {
  id: string;
  title: string;
  workContent: string;
  category: string;
  owner: string;
  shopName: string;
  startDate: string;
  due: string;
  status: WorkflowTaskStatus;
  priority: WorkflowTaskPriority;
  // The current UI keeps uploaded files in the active browser session. Keeping
  // this field maintains the client contract while task records are durable.
  attachments: [];
};

export type CreateWorkflowTaskInput = {
  title?: unknown;
  workContent?: unknown;
  category?: unknown;
  owner?: unknown;
  shopName?: unknown;
  startDate?: unknown;
  due?: unknown;
  priority?: unknown;
};

type WorkflowTaskRow = {
  id: string;
  title: string;
  work_content: string;
  category: string;
  owner: string;
  shop_name: string;
  start_date: string;
  due_date: string;
  status: string;
  priority: string;
};

const TASK_BOOTSTRAP_KEY = "work-plan-v1";
const taskColumns = `
  id, title, work_content, category, owner, shop_name,
  start_date, due_date, status, priority
`;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS workflow_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    work_content TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '工作计划',
    owner TEXT NOT NULL DEFAULT '',
    shop_name TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS workflow_tasks_status_created_idx
    ON workflow_tasks (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS workflow_task_bootstrap (
    key TEXT PRIMARY KEY NOT NULL,
    seeded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
] as const;

const initialTasks: Array<Omit<WorkflowTask, "attachments">> = [
  { id: "task-1", title: "完成 7 月大促价格检查", workContent: "核对重点商品活动价、优惠券和到手价，并整理差异项。", category: "活动运营", owner: "京东自营", shopName: "京东-志高商用设备旗舰店", startDate: "2026-07-18", due: "2026-07-18", status: "待开始", priority: "high" },
  { id: "task-2", title: "新品成分资料归档", workContent: "归档新品成分表、质检资料和平台备案所需文件。", category: "新品上架", owner: "商品组", shopName: "天猫-志高亿用专卖店", startDate: "2026-07-17", due: "2026-07-18", status: "待开始", priority: "normal" },
  { id: "task-3", title: "净透精华主图升级", workContent: "完成主图文案、卖点排版和详情页素材替换。", category: "新品上架", owner: "天猫组", shopName: "天猫-志高亿用专卖店", startDate: "2026-07-16", due: "2026-07-18", status: "工作中", priority: "high" },
  { id: "task-4", title: "POP 店铺巡店检查", workContent: "检查商品链接、库存、活动报名及客服响应情况。", category: "巡店查询", owner: "运营组", shopName: "抖店-志高商业设备旗舰店", startDate: "2026-07-16", due: "2026-07-17", status: "工作中", priority: "normal" },
  { id: "task-5", title: "评价晒图素材第 3 批", workContent: "筛选可用评价并整理晒单图片，提交页面运营使用。", category: "评价维护", owner: "客服组", shopName: "拼多多-志高商用厨电旗舰店", startDate: "2026-07-16", due: "2026-07-18", status: "工作中", priority: "normal" },
  { id: "task-6", title: "天猫周报数据核对", workContent: "复核周度销售、退款和投放数据，完成周报归档。", category: "数据分析", owner: "运营组", shopName: "天猫-志高亿用专卖店", startDate: "2026-07-14", due: "2026-07-17", status: "已完成", priority: "low" },
  { id: "task-7", title: "新品 SKU 映射", workContent: "完成 ERP 与平台规格代码映射并交接给上架同事。", category: "新品上架", owner: "商品组", shopName: "京东-志高商用设备旗舰店", startDate: "2026-07-14", due: "2026-07-17", status: "已完成", priority: "low" },
];

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

function isWorkflowTaskStatus(value: unknown): value is WorkflowTaskStatus {
  return typeof value === "string" && workflowTaskStatuses.includes(value as WorkflowTaskStatus);
}

function isWorkflowTaskPriority(value: unknown): value is WorkflowTaskPriority {
  return typeof value === "string" && workflowTaskPriorities.includes(value as WorkflowTaskPriority);
}

function textValue(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function dateValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "待排期") return "待排期";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("日期必须为 YYYY-MM-DD 格式");
  return text;
}

function taskId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 128) throw new Error("缺少有效的工作项标识");
  return id;
}

function mapTask(row: WorkflowTaskRow): WorkflowTask {
  return {
    id: row.id,
    title: row.title,
    workContent: row.work_content,
    category: row.category,
    owner: row.owner,
    shopName: row.shop_name,
    startDate: row.start_date,
    due: row.due_date,
    status: isWorkflowTaskStatus(row.status) ? row.status : "待开始",
    priority: isWorkflowTaskPriority(row.priority) ? row.priority : "normal",
    attachments: [],
  };
}

function normalizedCreateInput(input: CreateWorkflowTaskInput) {
  const startDate = dateValue(input.startDate);
  const due = dateValue(input.due);
  if (startDate !== "待排期" && due !== "待排期" && due < startDate) {
    throw new Error("截止时间不能早于开始时间");
  }
  return {
    title: textValue(input.title, "未命名工作项", 160),
    workContent: textValue(input.workContent, "未填写工作内容", 2_000),
    category: textValue(input.category, "工作计划", 80),
    owner: textValue(input.owner, "未指定跟进人", 120),
    shopName: textValue(input.shopName, "未关联店铺", 160),
    startDate,
    due,
    priority: isWorkflowTaskPriority(input.priority) ? input.priority : "normal" as WorkflowTaskPriority,
  };
}

export async function ensureWorkflowTaskSchema(db: SalesDatabase = getSalesDatabase()) {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) return existing;
  const setup = db.batch(schemaStatements.map((statement) => db.prepare(statement)))
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReadyByDatabase.delete(key);
      throw error;
    });
  schemaReadyByDatabase.set(key, setup);
  return setup;
}

async function ensureInitialTasks(db: SalesDatabase) {
  await ensureWorkflowTaskSchema(db);
  const statements = initialTasks.map((task) => db.prepare(
    `INSERT OR IGNORE INTO workflow_tasks (
      id, title, work_content, category, owner, shop_name,
      start_date, due_date, status, priority, created_by, updated_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'system'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_task_bootstrap WHERE key = ?)`,
  ).bind(
    task.id,
    task.title,
    task.workContent,
    task.category,
    task.owner,
    task.shopName,
    task.startDate,
    task.due,
    task.status,
    task.priority,
    TASK_BOOTSTRAP_KEY,
  ));
  statements.push(
    db.prepare("INSERT OR IGNORE INTO workflow_task_bootstrap (key) VALUES (?)").bind(TASK_BOOTSTRAP_KEY),
  );
  await db.batch(statements);
}

export async function listWorkflowTasks(db: SalesDatabase = getSalesDatabase()) {
  await ensureInitialTasks(db);
  const result = await db.prepare(
    `SELECT ${taskColumns}
     FROM workflow_tasks
     ORDER BY created_at DESC, id DESC`,
  ).all<WorkflowTaskRow>();
  return result.results.map(mapTask);
}

export async function createWorkflowTask(
  input: CreateWorkflowTaskInput,
  updatedBy: string,
  db: SalesDatabase = getSalesDatabase(),
) {
  await ensureInitialTasks(db);
  const task = normalizedCreateInput(input);
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO workflow_tasks (
      id, title, work_content, category, owner, shop_name,
      start_date, due_date, status, priority, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待开始', ?, ?, ?)`,
  ).bind(
    id,
    task.title,
    task.workContent,
    task.category,
    task.owner,
    task.shopName,
    task.startDate,
    task.due,
    task.priority,
    updatedBy,
    updatedBy,
  ).run();
  const row = await db.prepare(`SELECT ${taskColumns} FROM workflow_tasks WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<WorkflowTaskRow>();
  if (!row) throw new Error("工作项保存后无法读取");
  return mapTask(row);
}

export async function updateWorkflowTaskStatus(
  id: unknown,
  status: unknown,
  updatedBy: string,
  db: SalesDatabase = getSalesDatabase(),
) {
  await ensureInitialTasks(db);
  const validId = taskId(id);
  if (!isWorkflowTaskStatus(status)) throw new Error("工作项状态无效");
  const result = await db.prepare(
    `UPDATE workflow_tasks
     SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(status, updatedBy, validId).run();
  if (Number(result.meta?.changes ?? 0) === 0) return null;
  const row = await db.prepare(`SELECT ${taskColumns} FROM workflow_tasks WHERE id = ? LIMIT 1`)
    .bind(validId)
    .first<WorkflowTaskRow>();
  return row ? mapTask(row) : null;
}

export async function deleteWorkflowTask(
  id: unknown,
  db: SalesDatabase = getSalesDatabase(),
) {
  await ensureInitialTasks(db);
  const result = await db.prepare("DELETE FROM workflow_tasks WHERE id = ?").bind(taskId(id)).run();
  return Number(result.meta?.changes ?? 0) > 0;
}
