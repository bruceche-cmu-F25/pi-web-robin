"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CapabilityTreeCanvas } from "@/components/robin/CapabilityTreeCanvas";
import {
  CAPABILITY_NODES,
  CAPABILITY_ROLES,
  CAPABILITY_SOURCES,
  ROLE_PROFILES,
  demandFor,
  unlockedBy,
  type CapabilityDemand,
  type CapabilityNode,
  type CapabilityRole,
} from "@/extension/robin/capability-map";
import { CAPABILITY_ACQUISITION } from "@/extension/robin/capability-acquisition";
import { CAPABILITY_WORLDVIEW } from "@/extension/robin/capability-worldview";
import { TECHNOLOGY_GLOSSARY } from "@/extension/robin/technology-glossary";
import {
  INDUSTRY_CLUSTERS,
  INDUSTRY_DIAGRAMS,
  INDUSTRY_PILLARS,
  INDUSTRY_REFERENCES,
  ROADMAP_SH_COLLECTIONS,
  ROADMAP_SH_HOMEPAGE,
  UNDERSTANDING_LEVELS,
  targetUnderstanding,
} from "@/extension/robin/industry-world";
import {
  ancestorsOf,
  buildCapabilityTree,
  flattenTree,
  type PlacedNode,
  type TreeNode,
} from "@/extension/robin/capability-tree";

const ROLE_LABELS: Record<CapabilityRole, string> = {
  backend: "Backend",
  fullstack: "Full-stack",
  ai: "AI Engineer",
  pm: "PM",
  tpm: "TPM",
};

const ORIGIN_BEATS = [
  { key: "before", label: "在这之前" },
  { key: "broke", label: "什么撑不住了" },
  { key: "now", label: "于是现在" },
  { key: "cost", label: "换来的代价" },
] as const;

const DEMAND_LABELS: Record<CapabilityDemand, { en: string; zh: string }> = {
  core: { en: "core", zh: "核心" },
  recurring: { en: "recurring", zh: "高频" },
  adjacent: { en: "adjacent", zh: "相邻" },
};

/** Continents only. Opening all 28 clusters at once fits nothing on a screen. */
function defaultExpanded(): Set<string> {
  return new Set(["root"]);
}

export function CapabilityAtlas() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const pick = (en: string, cn: string) => (zh ? cn : en);

  const [role, setRole] = useState<CapabilityRole>("ai");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);
  const [selectedId, setSelectedId] = useState<string | null>("root");
  const [fitToken, setFitToken] = useState(0);

  const tree = useMemo(() => buildCapabilityTree(zh), [zh]);
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const capabilityById = useMemo(() => new Map(CAPABILITY_NODES.map((node) => [node.id, node])), []);
  const normalized = query.trim().toLocaleLowerCase();

  /** Search reaches the whole tree, including branches that are shut. */
  const matches = useMemo(() => {
    if (!normalized) return new Set<string>();
    const hits = new Set<string>();
    for (const node of flat) {
      const capability = node.kind === "capability" ? capabilityById.get(node.refId) : null;
      const haystack = [
        node.label,
        node.labelAlt,
        capability?.ability,
        capability?.mastery,
        capability?.proof,
        ...(capability?.technologies ?? []),
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      if (haystack.includes(normalized)) {
        hits.add(node.id);
        for (const ancestor of ancestorsOf(tree, node.id)) hits.add(ancestor);
      }
    }
    return hits;
  }, [capabilityById, flat, normalized, tree]);

  // A hit inside a closed branch is worthless, so search opens the way to every
  // match — the one time the accordion is allowed to hold several branches at
  // once. Clearing the box puts the reader back where they were.
  const beforeSearchRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!normalized) {
      const restored = beforeSearchRef.current;
      beforeSearchRef.current = null;
      if (restored) setExpanded(restored);
      return;
    }
    setExpanded((current) => {
      if (!beforeSearchRef.current) beforeSearchRef.current = current;
      const next = new Set(current);
      for (const node of flat) {
        if (!matches.has(node.id) || !node.children.length) continue;
        for (const ancestor of ancestorsOf(tree, node.id)) next.add(ancestor);
      }
      return next;
    });
  }, [flat, matches, normalized, tree]);

  const toggle = useCallback((node: PlacedNode) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) {
        // Closing a branch closes what was open inside it, so reopening later
        // does not dump three levels back onto the canvas at once.
        for (const id of current) if (id === node.id || isDescendant(node, id)) next.delete(id);
        return next;
      }
      // Unfolding is an accordion: one continent at a time. Eight open
      // continents is the wall of text this map keeps turning into.
      if (node.kind === "domain") {
        for (const id of current) {
          if (id !== "root") next.delete(id);
        }
      }
      // Technologies belong to whichever capability you are actually reading.
      if (node.kind === "capability") {
        for (const id of current) if (id.startsWith("cap:")) next.delete(id);
      }
      next.add(node.id);
      return next;
    });
  }, []);

  const collapseAll = () => {
    setExpanded(defaultExpanded());
    setFitToken((token) => token + 1);
  };

  const select = (node: PlacedNode) => {
    setSelectedId(node.id);
    if (window.matchMedia("(max-width: 900px)").matches) {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      requestAnimationFrame(() => document.getElementById("capability-detail")?.scrollIntoView({ behavior, block: "start" }));
    }
  };

  // Deep link from the reader: /learn/map?node=<capability id>. Read from the
  // URL directly rather than useSearchParams so the page stays static.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("node");
    if (!wanted) return;
    const target = flat.find((node) => node.kind === "capability" && node.refId === wanted);
    if (!target) return;
    setSelectedId(target.id);
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of ancestorsOf(tree, target.id)) next.add(ancestor);
      return next;
    });
    setFitToken((token) => token + 1);
  }, [flat, tree]);

  const selectById = (id: string) => {
    setSelectedId(id);
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of ancestorsOf(tree, id)) next.add(ancestor);
      return next;
    });
  };

  const selectedNode = flat.find((node) => node.id === selectedId) ?? null;
  const profile = ROLE_PROFILES[role];
  const coreCount = CAPABILITY_NODES.filter((node) => demandFor(node, role) === "core").length;
  const relevantCount = CAPABILITY_NODES.filter((node) => demandFor(node, role)).length;

  return (
    <div className="robin-page robin-dashboard capability-atlas flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 desktop:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-3xl flex-col gap-1">
            <p className="pi-eyebrow">{pick("INDUSTRY WORLD MODEL → ROLE REFERENCE", "行业世界模型 → 岗位要求参考")}</p>
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {pick("Software & AI Engineering World", "软件与 AI 工程世界")}
            </h1>
            <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
              {pick(
                "Six engineering foundations, an AI extension, and the product context around them. Open one branch at a time to understand what it owns, where its boundary sits, how it works, and how deeply a role expects you to know it.",
                "六块工程底座，加上 AI 扩展层和产品交付语境。一次展开一支，逐步理解它负责什么、边界在哪里、内部怎样运作，以及岗位要求理解到什么程度。",
              )}
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <a href="/learn" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 11 }}>
              {pick("LEARNING HUB", "学习中心")}
            </a>
            <a href="/dashboard" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 11 }}>
              {pick("DASHBOARD", "仪表盘")}
            </a>
          </nav>
        </header>

        <details className="pi-card capability-role-reference">
          <summary className="ui-action">
            <span className="pi-label">{pick("ROLE REFERENCE · OPTIONAL OVERLAY", "岗位参考 · 可选叠层")}</span>
            <span className="pi-eyebrow">
              {ROLE_LABELS[role]} · {pick(
                `${relevantCount}/${CAPABILITY_NODES.length} relevant · ${coreCount} core`,
                `${relevantCount}/${CAPABILITY_NODES.length} 相关 · ${coreCount} 核心`,
              )}
            </span>
          </summary>
          <div>
            <div className="capability-role-tabs" role="group" aria-label={pick("Filter by role", "按岗位筛选")}>
              {CAPABILITY_ROLES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="ui-action capability-filter"
                  data-state={role === item ? "accent" : "default"}
                  aria-pressed={role === item}
                  onClick={() => setRole(item)}
                >
                  {ROLE_LABELS[item]}
                </button>
              ))}
            </div>
            <div className="capability-role-summary">
              <div>
                <span className="pi-eyebrow">{pick("MISSION", "岗位使命")}</span>
                <p>{zh ? profile.mission : profile.missionEn}</p>
              </div>
              <div>
                <span className="pi-eyebrow">{pick("HIRING SIGNAL", "招聘信号")}</span>
                <p>{zh ? profile.hiringSignal : profile.hiringSignalEn}</p>
              </div>
            </div>
          </div>
        </details>

        <section className="pi-card capability-toolbar p-4" aria-label={pick("Map controls", "地图控制")}>
          <label>
            <span className="pi-eyebrow">{pick("SEARCH", "搜索")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={pick("evals, Kafka, on-call…", "评估、Kafka、on-call…")}
            />
          </label>
          <button type="button" className="ui-action capability-filter" onClick={collapseAll}>
            {pick("Fold everything back", "全部收回")}
          </button>
          <p className="capability-legend" aria-label={pick("Demand legend", "需求强度图例")}>
            {(["core", "recurring", "adjacent"] as CapabilityDemand[]).map((demand) => (
              <span key={demand} data-demand={demand}>
                <i aria-hidden="true" />{zh ? DEMAND_LABELS[demand].zh : DEMAND_LABELS[demand].en}
              </span>
            ))}
          </p>
        </section>

        <div className="capability-layout">
          <section className="capability-map" aria-label={pick("Capability graph", "能力知识图谱")}>
            <CapabilityTreeCanvas
              root={tree}
              expanded={expanded}
              role={role}
              selectedId={selectedId}
              matches={matches}
              searching={Boolean(normalized)}
              zh={zh}
              fitToken={fitToken}
              onToggle={toggle}
              onSelect={select}
            />
          </section>

          <aside id="capability-detail" className="pi-card capability-detail p-4" aria-live="polite">
            <DetailPanel
              node={selectedNode}
              role={role}
              zh={zh}
              pick={pick}
              onSelectId={selectById}
              onRole={setRole}
            />
          </aside>
        </div>

        <section className="pi-card industry-reference-shelf p-4" aria-labelledby="industry-reference-title">
          <header>
            <div>
              <h2 id="industry-reference-title" className="pi-label">{pick("ROADMAP & ARCHITECTURE LIBRARY", "ROADMAP 与架构资料库")}</h2>
              <p>{pick(
                "Roadmap names are classified by this world model; licensed curricula, diagrams, and official references stay directly usable beside them.",
                "按当前世界模型整理 Roadmap 名称，同时把可复用课程、架构图和官方参考放在旁边直接使用。",
              )}</p>
            </div>
            <span className="pi-eyebrow">{ROADMAP_SH_COLLECTIONS.length} {pick("areas", "类")} · {INDUSTRY_DIAGRAMS.length} {pick("diagram", "张图")} · {INDUSTRY_REFERENCES.length - 1} {pick("sources", "项资料")}</span>
          </header>

          <article className="roadmap-directory">
            <header>
              <div>
                <span className="pi-eyebrow">{pick("CLASSIFIED ROADMAP.SH INDEX", "ROADMAP.SH 分类索引")}</span>
                <p>{pick(
                  "Use these names as searches on roadmap.sh. Its terms permit linking the homepage, but not scraping, copying, framing, or deep-linking its roadmap content.",
                  "用这些名称在 roadmap.sh 原站搜索。其条款允许链接首页，但不允许抓取、复制、嵌入或深链 Roadmap 内容。",
                )}</p>
              </div>
              <a href={ROADMAP_SH_HOMEPAGE} target="_blank" rel="noreferrer" className="ui-action pi-bracket">
                {pick("OPEN ROADMAP.SH", "打开 ROADMAP.SH")} ↗
              </a>
            </header>
            <div>
              {ROADMAP_SH_COLLECTIONS.map((group) => (
                <section key={group.pillarId} data-domain={group.pillarId}>
                  <h3>{zh ? group.titleZh : group.title}</h3>
                  <div>{group.roadmaps.map((roadmap) => <span key={roadmap}>{roadmap}</span>)}</div>
                </section>
              ))}
            </div>
          </article>

          <div className="industry-diagram-gallery">
            {INDUSTRY_DIAGRAMS.map((diagram) => (
              <figure key={diagram.id}>
                <Image src={diagram.image} alt={zh ? diagram.titleZh : diagram.title} width={1600} height={1000} />
                <figcaption>
                  <a href={diagram.sourceUrl} target="_blank" rel="noreferrer">{zh ? diagram.titleZh : diagram.title} ↗</a>
                  <span>{diagram.author} · {diagram.license} · {diagram.modification}</span>
                </figcaption>
              </figure>
            ))}
          </div>

          <h3 className="pi-eyebrow">{pick("DIRECTLY USABLE SOURCES", "可直接使用的资料")}</h3>
          <div className="industry-source-grid">
            {INDUSTRY_REFERENCES.filter((source) => source.label !== "roadmap.sh").map((source) => (
              <a key={source.label} href={source.url} target="_blank" rel="noreferrer" className="ui-action" data-source="reference">
                <span>
                  <strong>{source.label}</strong>
                  <small>{source.reuse}</small>
                </span>
                <p>{zh ? source.noteZh : source.note}</p>
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </div>
        </section>

        <details className="pi-card capability-sources p-4">
          <summary className="ui-action">
            <span className="pi-label">{pick("EVIDENCE BASE", "证据来源")}</span>
            <span className="pi-eyebrow">{CAPABILITY_SOURCES.length} {pick("sources", "项")}</span>
          </summary>
          <div>
            {CAPABILITY_SOURCES.map((source) => (
              <article key={source.label}>
                {"url" in source ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : <strong>{source.label}</strong>}
                <p>{source.note}</p>
              </article>
            ))}
          </div>
        </details>
      </main>
    </div>
  );
}

function isDescendant(parent: TreeNode, id: string): boolean {
  for (const child of parent.children) {
    if (child.id === id || isDescendant(child, id)) return true;
  }
  return false;
}

function DetailPanel({
  node,
  role,
  zh,
  pick,
  onSelectId,
  onRole,
}: {
  node: TreeNode | null;
  role: CapabilityRole;
  zh: boolean;
  pick: (en: string, cn: string) => string;
  onSelectId: (id: string) => void;
  onRole: (role: CapabilityRole) => void;
}) {
  if (!node) {
    return <p className="capability-empty">{pick("Pick a node on the map.", "在地图上选择一个节点。")}</p>;
  }

  if (node.kind === "domain") {
    const pillar = INDUSTRY_PILLARS.find((item) => item.id === node.refId);
    const clusters = INDUSTRY_CLUSTERS.filter((cluster) => cluster.pillar === node.refId);
    if (!pillar) return null;
    const region = pillar.region === "core"
      ? pick("ENGINEERING CORE", "工程底座")
      : pillar.region === "extension"
        ? pick("SPECIALISATION", "专业扩展")
        : pick("OPERATING CONTEXT", "行业语境");
    return (
      <>
        <Heading eyebrow={region} title={node.label} subtitle={node.labelAlt} />
        <p className="capability-lead">{zh ? pillar.questionZh : pillar.question}</p>
        <DetailSection title={pick("WHAT THIS BLOCK OWNS", "这块负责什么")} body={zh ? pillar.ownsZh : pillar.owns} />
        <DetailSection title={pick("WHERE ITS BOUNDARY SITS", "边界在哪里")} body={zh ? pillar.boundaryZh : pillar.boundary} />
        <LinkList
          title={pick("TOPIC GROUPS", "主题分组")}
          items={clusters.map((cluster) => ({ id: `cluster:${cluster.id}`, label: zh ? cluster.titleZh : cluster.title }))}
          onSelectId={onSelectId}
        />
        <ContextReferences pillarId={pillar.id} zh={zh} pick={pick} />
      </>
    );
  }

  if (node.kind === "cluster") {
    const cluster = INDUSTRY_CLUSTERS.find((item) => item.id === node.refId);
    const capabilities = (cluster?.nodeIds ?? []).flatMap((id) => CAPABILITY_NODES.filter((item) => item.id === id));
    return (
      <>
        <Heading eyebrow={pick("CLUSTER", "能力组")} title={node.label} subtitle={node.labelAlt} />
        <LinkList
          title={pick("CAPABILITIES", "包含能力")}
          items={capabilities.map((item) => ({ id: `cap:${item.id}`, label: zh ? item.titleZh : item.title }))}
          onSelectId={onSelectId}
        />
      </>
    );
  }

  if (node.kind === "root") {
    return (
      <>
        <Heading eyebrow={pick("INDUSTRY WORLD", "行业世界模型")} title={pick("Software & AI Engineering World", "软件与 AI 工程世界")} subtitle="" />
        <DetailSection
          title={pick("HOW TO READ IT", "怎么读这张图")}
          body={pick(
            "Read the six numbered engineering foundations first, then the AI extension and product context. Open a block, then a topic, then a capability. Technologies stay inside the reader as examples; the role reference only recolours the same world and gives each capability a target understanding depth.",
            "先读六块编号的工程底座，再看 AI 扩展层和产品交付语境。依次展开大块、主题、能力。技术只作为例子留在阅读器里；岗位参考只给同一张世界地图着色，并标出每项能力应该理解到什么深度。",
          )}
        />
      </>
    );
  }

  const capability = CAPABILITY_NODES.find((item) => item.id === node.refId);
  if (!capability) return null;
  const acquisition = CAPABILITY_ACQUISITION[capability.id];
  const prerequisites = capability.prerequisites.flatMap((id) => CAPABILITY_NODES.filter((item) => item.id === id));
  const unlocks = unlockedBy(capability.id);

  const view = CAPABILITY_WORLDVIEW[capability.id];
  const defined = capability.technologies.filter((item) => TECHNOLOGY_GLOSSARY[item]);
  const rest = capability.technologies.filter((item) => !TECHNOLOGY_GLOSSARY[item]);
  const pillar = INDUSTRY_PILLARS.find((item) => item.id === node.domain);
  const targetDepth = targetUnderstanding(capability, role);

  return (
    <>
      <Heading eyebrow={zh ? pillar?.titleZh ?? node.domain : pillar?.title ?? node.domain} title={node.label} subtitle={node.labelAlt} />

      {view ? (
        <>
          <p className="capability-lead">{view.what}</p>

          <section className="capability-detail-section capability-origin">
            <h3 className="pi-eyebrow">{pick("WHY IT ENDED UP THIS WAY", "为什么会变成这样")}</h3>
            <ol>
              {ORIGIN_BEATS.map((beat) => (
                <li key={beat.key}>
                  <span>{beat.label}</span>
                  <p>{view.origin[beat.key]}</p>
                </li>
              ))}
            </ol>
          </section>

          <DetailSection title={pick("WHAT ACTUALLY HAPPENS", "实际怎么做")} body={view.how} />
        </>
      ) : null}

      <DetailSection title={pick("WHAT IT ENABLES", "它让你能做什么")} body={capability.ability} />
      <DetailSection title={pick("CLAIM IT WHEN", "怎样才算真正具备")} body={capability.mastery} />

      <section className="capability-detail-section capability-terms">
        <h3 className="pi-eyebrow">{pick("THE NAMED THINGS", "这里出现的具体东西")}</h3>
        {defined.length ? (
          <dl>
            {defined.map((technology) => (
              <div key={technology}>
                <dt>{technology}</dt>
                <dd>{TECHNOLOGY_GLOSSARY[technology]}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {rest.length ? (
          <div className="capability-tags">
            {rest.map((technology) => <span key={technology}>{technology}</span>)}
          </div>
        ) : null}
      </section>

      {acquisition ? (
        <details className="capability-practice" open>
          <summary className="ui-action">
            <span className="pi-eyebrow">{pick("IF YOU WANT TO ACQUIRE IT", "如果你想真的具备它")}</span>
          </summary>
          <div>
            <DetailSection title={pick("PRACTICE", "怎么练")} body={acquisition.path} />
            <DetailSection title={pick("WHERE PEOPLE STALL", "常见误区")} body={acquisition.trap} tone="warn" />
            <DetailSection title={pick("PROOF, NOT COURSEWORK", "可以验证的证据")} body={capability.proof} />
          </div>
        </details>
      ) : null}

      <ContextReferences pillarId={node.domain} zh={zh} pick={pick} />

      <section className="capability-detail-section capability-depth">
        <h3 className="pi-eyebrow">{pick("UNDERSTANDING DEPTH", "理解深度")}</h3>
        <p className="capability-depth-target">
          {pick(`${ROLE_LABELS[role]} target: L${targetDepth}`, `${ROLE_LABELS[role]} 参考目标：L${targetDepth}`)}
        </p>
        <ol>
          {UNDERSTANDING_LEVELS.map((item) => (
            <li key={item.level} data-reached={item.level <= targetDepth ? "true" : "false"} data-target={item.level === targetDepth ? "true" : "false"}>
              <span>L{item.level}</span>
              <div>
                <strong>{zh ? item.labelZh : item.label}</strong>
                <p>{zh ? item.criterionZh : item.criterion}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="capability-detail-section">
        <h3 className="pi-eyebrow">{pick("ROLE REFERENCE", "岗位参考")}</h3>
        <div className="capability-demand-list">
          {CAPABILITY_ROLES.map((item) => {
            const demand = demandFor(capability, item);
            return (
              <button key={item} type="button" className="ui-action" data-current={item === role ? "true" : "false"} onClick={() => onRole(item)}>
                <span>{ROLE_LABELS[item]}</span>
                <span data-demand={demand ?? "none"}>
                  {demand ? (zh ? DEMAND_LABELS[demand].zh : DEMAND_LABELS[demand].en) : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <LinkList
        title={pick("PREREQUISITES", "前置能力")}
        empty={pick("This is a root capability.", "这是一个根能力。")}
        items={prerequisites.map((item) => ({ id: `cap:${item.id}`, label: zh ? item.titleZh : item.title }))}
        onSelectId={onSelectId}
      />
      <LinkList
        title={pick("UNLOCKS", "向后解锁")}
        empty={pick("This is currently an edge of the map.", "当前位于地图边缘。")}
        items={unlocks.map((item: CapabilityNode) => ({ id: `cap:${item.id}`, label: zh ? item.titleZh : item.title }))}
        onSelectId={onSelectId}
      />
    </>
  );
}

function ContextReferences({
  pillarId,
  zh,
  pick,
}: {
  pillarId: string;
  zh: boolean;
  pick: (en: string, cn: string) => string;
}) {
  const roadmapGroup = ROADMAP_SH_COLLECTIONS.find((group) => group.pillarId === pillarId);
  const sources = INDUSTRY_REFERENCES.filter((source) => source.label !== "roadmap.sh" && source.pillarIds.includes(pillarId));
  if (!roadmapGroup && !sources.length) return null;

  return (
    <section className="capability-detail-section contextual-references">
      <h3 className="pi-eyebrow">{pick("READ ALONGSIDE", "配套参考")}</h3>
      {roadmapGroup ? (
        <div className="contextual-roadmaps">
          <strong>{zh ? roadmapGroup.titleZh : roadmapGroup.title}</strong>
          <a href={ROADMAP_SH_HOMEPAGE} target="_blank" rel="noreferrer" className="ui-action">
            roadmap.sh ↗
          </a>
          <p>{pick("Search the original site for:", "在原站搜索：")}</p>
          <div>{roadmapGroup.roadmaps.map((roadmap) => <span key={roadmap}>{roadmap}</span>)}</div>
        </div>
      ) : null}
      {sources.length ? (
        <div className="contextual-source-links">
          {sources.map((source) => (
            <a key={source.label} href={source.url} target="_blank" rel="noreferrer" className="ui-action">
              <span>{source.label}</span>
              <small>{source.reuse}</small>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Heading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="capability-detail-heading">
      <span className="pi-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}

function DetailSection({ title, body, tone }: { title: string; body: string; tone?: "warn" }) {
  return (
    <section className="capability-detail-section" data-tone={tone ?? "default"}>
      <h3 className="pi-eyebrow">{title}</h3>
      <p>{body}</p>
    </section>
  );
}

function LinkList({
  title,
  items,
  empty,
  onSelectId,
}: {
  title: string;
  items: { id: string; label: string }[];
  empty?: string;
  onSelectId: (id: string) => void;
}) {
  return (
    <section className="capability-detail-section">
      <h3 className="pi-eyebrow">{title}</h3>
      {items.length ? (
        <div className="capability-graph-links">
          {items.map((item) => (
            <button key={item.id} type="button" className="ui-action" onClick={() => onSelectId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : empty ? <p className="capability-empty">{empty}</p> : null}
    </section>
  );
}
