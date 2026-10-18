import type { Metadata } from "next";
import { ResearchStack } from "@/components/robin/ResearchStack";

export const metadata: Metadata = { title: "HEAT research stack — Pi Web" };
export default function HeatResearchPage() { return <ResearchStack />; }
