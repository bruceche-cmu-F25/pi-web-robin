import type { Metadata } from "next";
import { VideoSummaryWorkspace } from "@/components/robin/VideoSummaryWorkspace";

export const metadata: Metadata = { title: "Video summary — Robin" };
export default function VideoSummaryPage() { return <VideoSummaryWorkspace />; }
