import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { isStrictMarketDate } from "@/lib/market/import-identity";
import { importMarketFile } from "@/lib/market/import-service";
import { MarketImportRowLimitError } from "@/lib/market/parser";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function formText(form: FormData, key: string, fallback = "") {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
      return Response.json({ error: "请使用上传表单提交市场数据文件" }, { status: 415 });
    }
    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: "无法读取上传表单" }, { status: 400 });
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择 XLS、XLSX 或 CSV 文件" }, { status: 400 });
    if (!/\.(xls|xlsx|csv)$/i.test(file.name)) return Response.json({ error: "仅支持 XLS、XLSX 或 CSV 文件" }, { status: 400 });
    if (!file.size || file.size > MAX_FILE_BYTES) return Response.json({ error: "文件须大于 0 且不超过 25MB" }, { status: 413 });
    const currentDate = today();
    const sourceType = formText(form, "sourceType", "market_ranking");
    if (sourceType !== "market_ranking" && sourceType !== "sku_catalog") {
      return Response.json({ error: "不支持的数据类型" }, { status: 400 });
    }
    const periodStart = formText(form, "periodStart", currentDate);
    const periodEnd = formText(form, "periodEnd", currentDate);
    if (!isStrictMarketDate(periodStart) || !isStrictMarketDate(periodEnd) || periodStart > periodEnd) {
      return Response.json({ error: "导入周期无效" }, { status: 400 });
    }
    const payload = await importMarketFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      fileSizeBytes: file.size,
      sourceType,
      defaultStartDate: periodStart,
      defaultEndDate: periodEnd,
      defaultCategory: formText(form, "category"),
      defaultScope: formText(form, "scope", "全部"),
      defaultPriceBandFilter: formText(form, "priceBandFilter", "全部"),
      actorEmail: principal.email,
    });
    return Response.json(payload, { status: payload.status === "imported" ? 201 : 200 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof MarketImportRowLimitError) return Response.json({ error: error.message }, { status: 413 });
    return Response.json({ error: error instanceof Error ? error.message : "市场数据导入失败" }, { status: 500 });
  }
}
