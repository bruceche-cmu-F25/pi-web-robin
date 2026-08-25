import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/robin/Dashboard";
import { WorkspaceShortcutListener } from "@/components/WorkspaceShortcutListener";
import { I18nProvider } from "@/hooks/useI18n";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Dashboard — Pi Web",
};

export default function DashboardPage() {
  return (
    <Suspense>
      <WorkspaceShortcutListener />
      <I18nProvider>
        <Dashboard />
      </I18nProvider>
    </Suspense>
  );
}
