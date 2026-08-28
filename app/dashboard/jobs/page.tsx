import type { Metadata } from "next";
import { JobsBoard } from "@/components/robin/JobsBoard";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Jobs — Pi Web",
};

export default function DashboardJobsPage() {
  return <JobsBoard />;
}
