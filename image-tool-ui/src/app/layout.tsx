import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "出图工具",
  description: "提示词出图，勾选多张一键导出为 PPT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-zinc-100 dark:from-zinc-950 dark:via-slate-900 dark:to-zinc-950 bg-fixed">
        {children}
      </body>
    </html>
  );
}
