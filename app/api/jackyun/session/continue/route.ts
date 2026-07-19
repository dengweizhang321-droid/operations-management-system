export const runtime = "nodejs";

export async function POST() {
  return Response.json({ ok: true, status: "not_used", message: "请使用本地命令运行继续任务：npm run jackyun:continue-helper" });
}
