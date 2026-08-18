import type { ReactNode } from "react";
import { PiMark } from "./PiMark";
import { UiStyleToggle } from "./UiStyleToggle";

export function PiPageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="pi-page-header">
      <div className="pi-page-heading">
        <PiMark className="pi-page-mark" />
        <div>
          <span className="pi-page-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <nav className="pi-page-nav" aria-label={title}>
        {children}
        <UiStyleToggle showLabel />
      </nav>
    </header>
  );
}
