import { redirect } from "next/navigation";

/** The earlier full-stack map prototype; Full Stack Open now lives at /learn/fso. */
export default function FullstackRedirect() {
  redirect("/learn/fso");
}
