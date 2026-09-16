import { Suspense, type ReactNode } from "react";
import { RobinShell } from "@/components/robin/RobinShell";
import { WorkspaceShortcutListener } from "@/components/WorkspaceShortcutListener";
import { I18nProvider } from "@/hooks/useI18n";

export default function LearnLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <WorkspaceShortcutListener />
      <I18nProvider>
        <RobinShell>
          <div className="pi-grid-surface flex min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        </RobinShell>
      </I18nProvider>
    </Suspense>
  );
}
