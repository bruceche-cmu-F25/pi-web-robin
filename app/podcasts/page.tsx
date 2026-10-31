import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Podcasts — Pi Web",
  description: "Curated entry points for AI, engineering, product, and startup podcasts.",
};

export default async function PodcastsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  params.set("feed", "podcasts");
  redirect(`/dashboard/gmail?${params}`);
}
