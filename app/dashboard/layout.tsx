import { Suspense, type ReactNode } from "react";
import { RobinShell } from "@/components/robin/RobinShell";
import { JobHuntWorkspace } from "@/components/robin/JobHuntWorkspace";
import { WorkspaceShortcutListener } from "@/components/WorkspaceShortcutListener";
import { I18nProvider } from "@/hooks/useI18n";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <WorkspaceShortcutListener />
      <I18nProvider>
        <RobinShell><JobHuntWorkspace>{children}</JobHuntWorkspace></RobinShell>
      </I18nProvider>
    </Suspense>
  );
}
