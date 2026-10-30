import { validatedSourceReturn } from "@/contracts/sources";
import { requireOwnerAccess } from "@/security/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { localeCookie, resolveLocale, sourceMessages, type Locale } from "@/i18n/messages";
import { preferenceCookieOptions } from "@/i18n/server";

async function changeLanguage(formData: FormData) {
  "use server";
  await requireOwnerAccess("POST");
  const locale = resolveLocale(formData.get("locale"));
  (await cookies()).set(localeCookie, locale, preferenceCookieOptions);
  // Cookie actions already refresh enhanced clients in place; native forms need a redirect.
  if (!(await headers()).has("next-action")) redirect(validatedSourceReturn(formData.get("sourceReturn")));
}

export function LanguageSwitcher({ locale, returnPath = "/" }: { locale: Locale; returnPath?: string }) {
  const t = sourceMessages[locale];
  return <form action={changeLanguage} className="language-switcher">
    <input type="hidden" name="sourceReturn" value={returnPath} />
    <label htmlFor="ui-language">{t.language}</label>
    <select key={locale} id="ui-language" name="locale" defaultValue={locale}>
      <option value="en" lang="en">English</option>
      <option value="ko" lang="ko">한국어</option>
    </select>
    <button type="submit">{t.applyLanguage}</button>
  </form>;
}
