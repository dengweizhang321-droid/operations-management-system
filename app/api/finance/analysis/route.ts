import {
  ensureFinanceSchema,
  getFinanceDatabase,
} from "@/lib/finance/database";
import { getFinanceAnalysis } from "@/lib/finance/analysis";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const monthValues = searchParams.getAll("month").flatMap((value) => value.split(",")).filter(Boolean);
    const allMonths = monthValues.includes("*");
    const requestedMonths = monthValues.filter((month) => month !== "*");
    if (requestedMonths.some((month) => !/^\d{4}-\d{2}$/.test(month))) {
      return Response.json({ error: "月份格式应为 YYYY-MM" }, { status: 400 });
    }
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    return Response.json(await getFinanceAnalysis(db, {
      requestedMonths,
      allMonths,
      platformNames: searchParams.getAll("platform").filter(Boolean),
      shopNames: searchParams.getAll("shop").filter(Boolean),
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "财报分析读取失败" }, { status: 500 });
  }
}
