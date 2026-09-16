import { AppShell } from "@/components/layout/app-shell";
import { StoreProvider } from "@/lib/store";
import { requireUser } from "@/server/auth/session";
import { getBootstrap } from "@/server/data";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const initial = await getBootstrap(user);

  return (
    <StoreProvider initial={initial}>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
