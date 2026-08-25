import type { Metadata } from "next";
import { Suspense } from "react";
import { CodingBoard } from "@/components/robin/CodingBoard";
import { WorkspaceShortcutListener } from "@/components/WorkspaceShortcutListener";
import { I18nProvider } from "@/hooks/useI18n";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Coding — Pi Web",
};

export default function CodingPage() {
  return (
    <Suspense>
      <WorkspaceShortcutListener />
      <I18nProvider>
        <CodingBoard />
      </I18nProvider>
    </Suspense>
  );
}
