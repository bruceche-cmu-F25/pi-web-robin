import type { Metadata } from "next";
import { WatchList } from "@/components/robin/WatchList";

export const metadata: Metadata = {
  title: "Watch List — Learning Hub",
  description: "Lecture courses to watch beside Full Stack Open, ticked off one lecture at a time.",
};

export default function WatchPage() {
  return <WatchList />;
}
