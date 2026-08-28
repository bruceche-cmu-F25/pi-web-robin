import type { Metadata } from "next";
import { GmailBoard } from "@/components/robin/GmailBoard";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Email — Pi Web",
};

export default function DashboardGmailPage() {
  return <GmailBoard />;
}
