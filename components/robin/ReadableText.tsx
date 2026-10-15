import type { ReactNode } from "react";

/** Phone lists show their copy directly rather than adding a disclosure to every row. */
export function ReadableText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`robin-readable-text min-w-0 ${className}`}>
    <div className="robin-readable-copy">{children}</div>
  </div>;
}
