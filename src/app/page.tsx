import { getInitialSourceList } from "@/composition/source-list";
import { getLocale } from "@/i18n/server";
import { SourceScreen } from "@/ui/source-screen";
import { LanguageSwitcher } from "./language-switcher";

export default async function Home() {
  const locale = await getLocale();
  return <SourceScreen locale={locale} languageControl={<LanguageSwitcher locale={locale} />} initialState={getInitialSourceList()} />;
}
