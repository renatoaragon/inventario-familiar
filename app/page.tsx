import type { Metadata } from "next";
import { getInvSession, getAdminMember } from "@/lib/inventario/auth";
import { InventarioClient } from "./inventario-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Inventário Familiar",
  description: "Portal privado da família: documentos e vida financeira do inventário.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Inventário Familiar", statusBarStyle: "default" },
};

export default async function InventarioFamiliarPage() {
  const session = await getInvSession();
  // The admin is a member too: member rules (their own payment key, for
  // example) apply to the admin as well; they just see more.
  const adminSelf = session?.kind === "admin" ? await getAdminMember() : null;
  return (
    <InventarioClient
      session={
        session
          ? session.kind === "admin"
            ? {
                kind: "admin" as const,
                viaMember: session.viaMember === true,
                pixKey: adminSelf?.pixKey ?? null,
              }
            : {
                kind: "member" as const,
                name: session.name,
                role: session.role,
                pixKey: session.pixKey,
              }
          : null
      }
    />
  );
}
