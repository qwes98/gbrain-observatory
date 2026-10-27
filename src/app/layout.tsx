import type { Metadata } from "next";
import { getLocale } from "@/i18n/server";
import { sourceMessages } from "@/i18n/messages";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = sourceMessages[await getLocale()];
  return {
    title: `${t.sources} · GBrain Observatory`,
    description: t.description,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang={await getLocale()}><body>{children}</body></html>;
}
