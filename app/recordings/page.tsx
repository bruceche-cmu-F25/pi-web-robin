import type { Metadata } from "next";
import { RecordingsWorkspace } from "@/components/robin/RecordingsWorkspace";

export const metadata: Metadata = { title: "Recordings — Pi Web", description: "Record, upload and transcribe long audio." };
export default function RecordingsPage() { return <RecordingsWorkspace />; }
