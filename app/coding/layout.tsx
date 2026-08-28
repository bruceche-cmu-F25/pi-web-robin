import { Suspense, type ReactNode } from "react";
import { RobinShell } from "@/components/robin/RobinShell";
import { WorkspaceShortcutListener } from "@/components/WorkspaceShortcutListener";
import { I18nProvider } from "@/hooks/useI18n";

export default function CodingLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <WorkspaceShortcutListener />
      <I18nProvider>
        <RobinShell>{children}</RobinShell>
      </I18nProvider>
    </Suspense>
  );
}
