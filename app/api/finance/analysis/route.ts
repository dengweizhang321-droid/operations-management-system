import {
  ensureFinanceSchema,
  getFinanceDatabase,
} from "@/lib/finance/database";
import { getFinanceAnalysis } from "@/lib/finance/analysis";

export async function GET(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get("month");
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: "月份格式应为 YYYY-MM" }, { status: 400 });
    }
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    return Response.json(await getFinanceAnalysis(db, month));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "财报分析读取失败" }, { status: 500 });
  }
}
