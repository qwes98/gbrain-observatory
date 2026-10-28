import { requireOwnerAccess } from "@/security/server";
import { checkConfiguredConnection, getInitialConnection } from "@/composition/connection";
import type { ConnectionResult } from "@/contracts/connection";
import type { Locale } from "@/i18n/messages";
import { ConnectionPanel } from "@/ui/connection-panel";

async function check(_previous: ConnectionResult | undefined): Promise<ConnectionResult> {
  "use server";
  void _previous;
  // Both identity and the configured external Origin are rechecked before execution.
  await requireOwnerAccess("POST");
  return checkConfiguredConnection();
}

export function ConnectionCheck({ locale }: { locale: Locale }) {
  return <ConnectionPanel locale={locale} initial={getInitialConnection()} action={check} />;
}
