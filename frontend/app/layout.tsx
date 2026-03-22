import type { Metadata } from "next";
import "./globals.css";
import MuiThemeProvider from "../components/kaiten/MuiThemeProvider";

export const metadata: Metadata = {
  title: "AGBTasker",
  description: "AGBTasker — постановка и мониторинг задач",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={"bg-[#F5F6F7]"}>
        <MuiThemeProvider>
          <div className="min-h-screen">{children}</div>
        </MuiThemeProvider>
      </body>
    </html>
  );
}

