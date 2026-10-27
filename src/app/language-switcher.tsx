import { requireOwnerAccess } from "@/security/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { localeCookie, resolveLocale, sourceMessages, type Locale } from "@/i18n/messages";

async function changeLanguage(formData: FormData) {
  "use server";
  await requireOwnerAccess("POST");
  const locale = resolveLocale(formData.get("locale"));
  (await cookies()).set(localeCookie, locale, {
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const t = sourceMessages[locale];
  return <form action={changeLanguage} className="language-switcher">
    <label htmlFor="ui-language">{t.language}</label>
    <select id="ui-language" name="locale" defaultValue={locale}>
      <option value="en" lang="en">English</option>
      <option value="ko" lang="ko">한국어</option>
    </select>
    <button type="submit">{t.applyLanguage}</button>
  </form>;
}
