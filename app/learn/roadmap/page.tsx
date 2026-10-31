import type { Metadata } from "next";
import { LearningRoadmap } from "@/components/robin/LearningRoadmap";
import { LearningCourse } from "@/components/robin/LearningCourse";
import { LearningGraph } from "@/components/robin/LearningGraph";

export const metadata: Metadata = {
  title: "Learning roadmaps — Learning Hub",
  description: "Your Obsidian roadmaps, in their original layout. Click a topic to expand its explanation in place.",
};

export default async function LearningRoadmapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Existing note and lesson deep links retain their readers and independent records.
  if (params.view === "notes" || params.note) return <LearningRoadmap />;
  if (params.view === "course" || params.lesson) return <LearningCourse />;
  return <LearningGraph />;
}
