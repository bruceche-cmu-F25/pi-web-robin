import type { Metadata } from "next";
import { EventDetail } from "@/components/robin/EventDetail";

export const metadata: Metadata = {
  title: "Event — Pi Web",
};

export default async function DashboardEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // A malformed escape is just an id that will not be found.
  }
  return <EventDetail id={decoded} />;
}
