import { readComparisonApi } from "@/app/netshop/comparison/api";
export async function GET(request: Request) { return readComparisonApi(request); }
