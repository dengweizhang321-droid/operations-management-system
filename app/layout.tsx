import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./shell/top-navigation.css";
import "./styles/shared-theme.css";

const title = "电商运营中台";
const description = "销售、库存、商品与运营事务一体化管理平台。";

type PreviewImportMeta = ImportMeta & {
  env: {
    DEV: boolean;
    VITE_TERUISI_PREVIEW?: string;
    VITE_TERUISI_PREVIEW_PORT?: string;
    VITE_TERUISI_PREVIEW_BRANCH?: string;
  };
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProtocol ?? (host?.includes("localhost") ? "http" : "https");
  const origin = host
    ? `${protocol}://${host}`
    : "https://teruisi-ops-console.dengweizhang321.chatgpt.site";
  const socialImage = new URL("/og.png", origin).toString();

  return {
    title,
    description,
    metadataBase: new URL(origin),
    icons: {
      icon: "/favicon.svg?v=xiaote-20260922",
      shortcut: "/favicon.svg?v=xiaote-20260922",
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      title,
      description,
      images: [{ url: socialImage, width: 1728, height: 896, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const previewEnvironment = (import.meta as PreviewImportMeta).env;
  return (
    <html lang="zh-CN">
      <body>
        {(import.meta as PreviewImportMeta).env.DEV && previewEnvironment.VITE_TERUISI_PREVIEW === "true" && (
          <div title="隔离开发环境：前端保存后热更新，禁止业务提交" style={{ position: "fixed", bottom: 8, right: 16, zIndex: 99999, background: "#92400e", color: "white", padding: "8px 16px", borderRadius: 8, fontSize: 14 }}>
            开发环境 · 合成数据 · 禁止业务提交 · 端口 {previewEnvironment.VITE_TERUISI_PREVIEW_PORT} · {previewEnvironment.VITE_TERUISI_PREVIEW_BRANCH}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
