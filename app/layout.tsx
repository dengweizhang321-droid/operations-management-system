import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TERUISI 电商运营中台",
  description: "销售、库存、商品与运营事务一体化管理平台前端展示原型。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
