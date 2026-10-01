import { readStorePanoramaApi } from "@/app/netshop/panorama/api";

export async function GET(request: Request) { return readStorePanoramaApi(request); }
