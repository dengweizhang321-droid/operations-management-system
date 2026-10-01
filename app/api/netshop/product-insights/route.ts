import { readProductApi } from "@/app/netshop/products/api";
export async function GET(request: Request) { return readProductApi(request); }
