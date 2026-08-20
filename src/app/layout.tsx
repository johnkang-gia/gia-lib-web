import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GIA 도서관",
  description: "GIA 학생 도서카드 대출·반납 관리",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
  appleWebApp: {
    capable: true,
    title: "GIA 도서관",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 도서관 전용 단말이라 두 손가락 확대로 화면이 틀어지지 않게 고정합니다.
  maximumScale: 1,
  themeColor: "#0f1b33",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
