import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "文本对比工具",
  description: "在浏览器中并排比较两份文本，高亮显示新增、删除和修改的内容。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
