import {
  createWorkflowTask,
  deleteWorkflowTask,
  ensureWorkflowTaskSchema,
  listWorkflowTasks,
  updateWorkflowTaskStatus,
  type CreateWorkflowTaskInput,
} from "@/lib/workflow/tasks";
import { getSalesDatabase } from "@/lib/sales/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET() {
  try {
    const db = getSalesDatabase();
    await ensureWorkflowTaskSchema(db);
    return Response.json(
      { items: await listWorkflowTasks(db) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: errorMessage(error, "读取工作计划失败") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const payload = await request.json().catch(() => null) as CreateWorkflowTaskInput | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ error: "工作项内容必须是有效的 JSON 对象" }, { status: 400 });
    }
    const db = getSalesDatabase();
    await ensureWorkflowTaskSchema(db);
    const item = await createWorkflowTask(payload, principal.email, db);
    return Response.json({ item }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: errorMessage(error, "保存工作项失败") }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const id = new URL(request.url).searchParams.get("id");
    const payload = await request.json().catch(() => null) as { status?: unknown } | null;
    if (!payload || typeof payload !== "object") {
      return Response.json({ error: "缺少工作项状态" }, { status: 400 });
    }
    const db = getSalesDatabase();
    await ensureWorkflowTaskSchema(db);
    const item = await updateWorkflowTaskStatus(id, payload.status, principal.email, db);
    if (!item) return Response.json({ error: "工作项不存在或已删除" }, { status: 404 });
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: errorMessage(error, "更新工作项状态失败") }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const id = new URL(request.url).searchParams.get("id");
    const db = getSalesDatabase();
    await ensureWorkflowTaskSchema(db);
    const deleted = await deleteWorkflowTask(id, db);
    if (!deleted) return Response.json({ error: "工作项不存在或已删除" }, { status: 404 });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: errorMessage(error, "删除工作项失败") }, { status: 400 });
  }
}
