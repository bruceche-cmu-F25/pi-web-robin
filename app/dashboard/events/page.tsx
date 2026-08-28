import type { Metadata } from "next";
import { EventsBoard } from "@/components/robin/EventsBoard";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Events — Pi Web",
};

export default function DashboardEventsPage() {
  return <EventsBoard />;
}
