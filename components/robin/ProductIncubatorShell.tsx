"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { AgentPanel } from "./AgentPanel";
import { PaneDivider } from "./PaneDivider";
import { productCopy } from "./product-copy";
import { ProductGlyph } from "./ProductGlyph";
import styles from "./ProductWorkspace.module.css";

const WIDTH_KEY = "pi-product-agent-width";
const MIN_WIDTH = 300;
const MAX_WIDTH = 620;
const PREFERRED_WIDTH = 390;

/**
 * How the page asks the agent to go and do something.
 *
 * The agent is the one part of this section with any leverage — it can
 * actually go and look, which is the expensive half of deciding whether an
 * idea is worth a month — and for a long time it sat behind a button that did
 * nothing until you typed. The page can now hand it a brief and an idea to
 * attach what it finds to.
 */
interface AgentHandle {
  /** Open the panel, scope it to an idea, and optionally send a brief. */
  ask: (options?: { ideaId?: string; brief?: string }) => void;
}

const AgentContext = createContext<AgentHandle>({ ask: () => {} });

export function useProductAgent(): AgentHandle {
  return useContext(AgentContext);
}

const PRODUCT_TOOL_KEYS: Record<string, string> = {
  product_list: "product.tool.list",
  product_get: "product.tool.get",
  product_add_link: "product.tool.link",
};

export function ProductIncubatorShell({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const copy = productCopy(locale);
  const split = useIsSplitLayout();
  const [agentOpen, setAgentOpen] = useState(false);
  const [ideaId, setIdeaId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<{ id: string; text: string } | undefined>(undefined);
  const [agentWidth, setAgentWidth] = useState(PREFERRED_WIDTH);
  const latestWidth = useRef(PREFERRED_WIDTH);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) {
      latestWidth.current = stored;
      setAgentWidth(stored);
    }
  }, []);

  const resizeAgent = (requested: number) => {
    const available = Math.max(MIN_WIDTH, window.innerWidth - 420);
    const next = Math.min(Math.max(requested, MIN_WIDTH), Math.min(MAX_WIDTH, available));
    latestWidth.current = next;
    setAgentWidth(next);
  };

  const handle = useMemo<AgentHandle>(() => ({
    ask: ({ ideaId: id, brief } = {}) => {
      setIdeaId(id);
      setAgentOpen(true);
      // A fresh key each time, so asking for the same brief twice actually
      // asks twice rather than being mistaken for a re-render.
      if (brief) setPending({ id: `${id ?? "all"}:${Date.now()}`, text: brief });
    },
  }), []);

  const agent = (
    <AgentPanel
      mode="product"
      endpoint="/api/robin/product-assistant"
      // Scoping the session to one idea is what lets the agent read it with
      // product_get and save links back to it.
      requestBody={ideaId ? { productId: ideaId } : {}}
      titleKey={ideaId ? "product.agent.product" : "product.agent.incubator"}
      placeholderKey={ideaId ? "product.agent.placeholder" : "product.agent.incubatorPlaceholder"}
      restartHintKey="product.agent.restartHint"
      toolKeys={PRODUCT_TOOL_KEYS}
      pending={pending}
      onClose={() => setAgentOpen(false)}
    />
  );

  return (
    <AgentContext.Provider value={handle}>
    <div className="robin-page robin-dashboard flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
      <header
        className={`border-b py-3 ${styles.shellHeader}`}
        // No wash: this page is a document on the ruled ground, and the nav
        // panel colour is the chat shell's chrome. One hairline separates it.
        style={{ borderColor: "var(--border)" }}
      >
        {/* The hairline runs full width; the title lines up with the centred
            column below it, which only spans the page while the agent is shut. */}
        <div className={styles.shellFrame}>
        <div className={styles.brandMark} aria-hidden="true"><ProductGlyph name="map" /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className={styles.shellTitle}>{copy.title}</h1>
        </div>
        <button
          type="button"
          onClick={() => handle.ask()}
          className="ui-action pi-chrome-label pi-bracket ml-auto min-h-[44px] px-2 split:min-h-0 split:px-0"
          data-state={agentOpen ? "accent" : undefined}
          aria-expanded={agentOpen}
        >
          <ProductGlyph name="market" className="mr-2 inline-block size-4" />{copy.agent}
        </button>
        </div>
      </header>

      <div className="flex flex-1" style={{ minWidth: 0, minHeight: 0 }}>
        <div className="flex flex-1" style={{ minWidth: 0, minHeight: 0 }}>{children}</div>

        {agentOpen && split ? (
          <>
            <PaneDivider
              edge="right"
              label="Resize product agent"
              title="Double-click or press Enter to reset"
              width={agentWidth}
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              onResize={resizeAgent}
              onCommit={() => window.localStorage.setItem(WIDTH_KEY, String(latestWidth.current))}
              onReset={() => {
                resizeAgent(PREFERRED_WIDTH);
                window.localStorage.setItem(WIDTH_KEY, String(PREFERRED_WIDTH));
              }}
            />
            <aside className="flex shrink-0 flex-col" style={{ width: agentWidth, minHeight: 0, background: "var(--bg-panel)" }}>
              {agent}
            </aside>
          </>
        ) : null}
      </div>

      {agentOpen && !split ? (
        <div className="fixed inset-0 flex" style={{ zIndex: "var(--z-modal)", background: "var(--bg-panel)" }}>
          {agent}
        </div>
      ) : null}
    </div>
    </AgentContext.Provider>
  );
}
