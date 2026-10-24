import { redirect } from "next/navigation";

/** The briefing lives inside Incoming, not a separate navigation destination. */
export default function AiWeeklyPage() { redirect("/dashboard/gmail?feed=ai"); }
