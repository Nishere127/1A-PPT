import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "1A Agent 调试台",
  description: "文档→提示词 Skill、出图 Skill 联调",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gradient-to-b from-zinc-100/95 via-white to-slate-50 bg-fixed text-zinc-900">
        {children}
      </body>
    </html>
  );
}
