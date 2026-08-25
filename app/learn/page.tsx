import type { Metadata } from "next";
import { Suspense } from "react";
import { LearningHub } from "@/components/robin/LearningHub";
import { WorkspaceShortcutListener } from "@/components/WorkspaceShortcutListener";
import { I18nProvider } from "@/hooks/useI18n";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Learning Hub — Pi Web",
};

export default function LearnPage() {
  return (
    <Suspense>
      <WorkspaceShortcutListener />
      <I18nProvider>
        <LearningHub />
      </I18nProvider>
    </Suspense>
  );
}
