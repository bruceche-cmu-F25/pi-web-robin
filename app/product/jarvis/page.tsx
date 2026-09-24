import type { Metadata } from "next";
import { JarvisDiscovery } from "@/components/robin/JarvisDiscovery";

export const metadata: Metadata = { title: "Jarvis · Market discovery — Pi Web" };
export default function JarvisPage() { return <JarvisDiscovery />; }
