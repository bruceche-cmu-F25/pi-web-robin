import type { Metadata } from "next";
import { SettingsPanel } from "@/components/robin/SettingsPanel";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Settings — Pi Web",
};

export default function DashboardSettingsPage() {
  return <SettingsPanel />;
}
