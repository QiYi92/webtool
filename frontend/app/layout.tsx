import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "二进制伽利略的工具站",
  description: "二进制伽利略的工具站",
  icons: {
    icon: "/images/logo.png",
    shortcut: "/images/logo.png",
    apple: "/images/logo.png"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
