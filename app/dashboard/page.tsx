import type { Metadata } from "next";
import { Dashboard } from "@/components/robin/Dashboard";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Dashboard — Pi Web",
};

export default function DashboardPage() {
  return <Dashboard />;
}
