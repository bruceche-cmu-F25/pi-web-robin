import type { Metadata } from "next";
import { JarvisDiscovery } from "@/components/robin/JarvisDiscovery";

export const metadata: Metadata = { title: "Cold Reach — Jarvis CRM" };
export default function ResearchPage() { return <JarvisDiscovery />; }
