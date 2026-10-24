import type { Metadata } from "next";
import { InformationInbox } from "@/components/robin/InformationInbox";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Incoming — Pi Web",
};

export default function DashboardGmailPage() {
  return <InformationInbox />;
}
