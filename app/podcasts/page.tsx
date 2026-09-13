import type { Metadata } from "next";
import { PodcastDirectory } from "@/components/robin/PodcastDirectory";

export const metadata: Metadata = {
  title: "Podcasts — Pi Web",
  description: "Curated entry points for AI, engineering, product, and startup podcasts.",
};

export default function PodcastsPage() {
  return <PodcastDirectory />;
}
