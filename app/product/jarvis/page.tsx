import { redirect } from "next/navigation";

/** Historical bookmark; outreach now has its own, product-neutral workspace. */
export default function LegacyOutreachPage() { redirect("/outreach"); }
