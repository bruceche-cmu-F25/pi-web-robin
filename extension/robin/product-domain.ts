import { localDate } from "./dates.ts";
import { normalizeUrl } from "./links.ts";
import {
  newId,
  readJsonArray,
  updateJsonArray,
  writeJsonArray,
} from "./paths.ts";
import { PLAYBOOK_STEPS, type StepId } from "./product-playbook.ts";
import type { IdeaBet, LibraryCategory, LibraryStatus } from "./product-shape.ts";
export { STALE_AFTER_DAYS, ideaAttention, priceBand } from "./product-shape.ts";
export { PLAYBOOK, PLAYBOOK_STEPS, nextStep, playbookStep } from "./product-playbook.ts";
export type { PlaybookStep, StepId } from "./product-playbook.ts";
export type { IdeaBet, LibraryCategory, LibraryStatus, PriceBand } from "./product-shape.ts";

/**
 * An idea, and what you have found out about it.
 *
 * This replaces a record with eight nested collections — scorecard,
 * hypotheses, evidence, experiments, milestones, stack, metrics, decisions —
 * plus a six-stage pipeline, a weighted opportunity score and a
 * confidence rating. None of it was ever filled in: after the whole apparatus
 * shipped, the store held one real idea with every one of those collections
 * empty. It was built for running a portfolio methodically; what actually
 * happens is that you have an idea and want somewhere to put what you learn
 * about it.
 *
 * So an idea is a name, a note you write in your own words, and the links you
 * gathered. Anything the old schema knew how to hold, prose holds too — and
 * prose does not have to be kept up to date field by field.
 */
export interface IdeaLink {
  id: string;
  title: string;
  url: string;
  /** Why it is here. One line, optional. */
  note?: string;
  createdAt: string;
  /** Set when the agent saved it, so a claim's origin stays visible. */
  addedBy?: "agent";
}

export interface Idea {
  id: string;
  name: string;
  /** Free text. The whole body of the idea. */
  note: string;
  links: IdeaLink[];
  /** Where in the playbook this sits. See product-playbook.ts. */
  step: StepId;
  /** Set aside, at whatever step it had reached. */
  parked?: boolean;
  /** What has to be true for this to be worth the time. See IdeaBet. */
  bet?: IdeaBet;
  /** The raw capture this came from, when it came from one. */
  sourceCaptureId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductLibraryResource {
  id: string;
  name: string;
  category: LibraryCategory;
  /** Which part of the work it serves. Free labels, not the old pipeline. */
  stages: string[];
  productTypes: string[];
  summary: string;
  price: string;
  url?: string;
  status: LibraryStatus;
  source?: string;
  /**
   * The day `price` was last read off the vendor's own page, as YYYY-MM-DD.
   *
   * Prices in this library arrive from screenshots and second-hand notes and
   * go stale silently, which is the worst way for a number to be wrong: it
   * still looks like a fact. Absent means nobody has checked, and the library
   * says so rather than presenting the figure as current. Day resolution is
   * the resolution of the underlying act — you looked at a pricing page once
   * that day.
   */
  lastChecked?: string;
  updatedAt?: string;
}

export interface ProductCapture {
  id: string;
  text: string;
  images: Array<{ data: string; mimeType: string }>;
  status: "pending" | "filed";
  filedAs?: "idea" | "resource" | "link" | "note";
  targetId?: string;
  createdAt: string;
}

const IDEAS_FILE = "products.json";
const LIBRARY_FILE = "product-library.json";
const CAPTURES_FILE = "product-captures.json";

const now = () => new Date().toISOString();
const clean = (value: string) => value.trim();


/**
 * What a record written by the previous schema looks like, as far as reading
 * it needs to care.
 */
interface LegacyRecord {
  summary?: string;
  problem?: string;
  targetUser?: string;
  nextAction?: string;
  stage?: string;
  state?: string;
  evidence?: Array<{ title?: string; note?: string; url?: string; createdAt?: string; collectedBy?: string }>;
  stack?: Array<{ tool?: string; category?: string; reason?: string; url?: string }>;
}

/**
 * Both earlier vocabularies, mapped onto the playbook.
 *
 * The six-column pipeline came first, then a three-state field replaced it,
 * and now the steps carry instructions. Neither old value is thrown away: a
 * column already named a phase of the same work, and "making" is the build
 * step by another name.
 */
const LEGACY_STEP: Record<string, StepId> = {
  inbox: "spot",
  research: "research",
  testing: "validate",
  building: "build",
  live: "launch",
  paused: "spot",
  thinking: "spot",
  making: "build",
};

/**
 * Fold a record written by the old schema into an idea.
 *
 * Nothing readable is dropped on the floor: the brief's prose fields become
 * paragraphs of the note under their own headings, and anything that carried a
 * URL — evidence, stack picks — becomes a link. The parts with no prose in
 * them (weights, scores, statuses) are what this redesign decided not to keep,
 * and they are gone by intent rather than by accident.
 *
 * This is a read-time conversion, so it never writes on its own; the store is
 * only rewritten when you actually edit something. A copy of the old file is
 * kept alongside it as `products.json.bak-preflatten-*`.
 */
function foldLegacy(raw: Idea & LegacyRecord): Idea {
  const paragraphs = [raw.note?.trim(), raw.summary?.trim()];
  if (raw.problem?.trim()) paragraphs.push(`Problem: ${raw.problem.trim()}`);
  if (raw.targetUser?.trim()) paragraphs.push(`For: ${raw.targetUser.trim()}`);
  if (raw.nextAction?.trim()) paragraphs.push(`Next: ${raw.nextAction.trim()}`);

  const carried: IdeaLink[] = [];
  for (const item of raw.evidence ?? []) {
    if (!item.url) continue;
    carried.push({
      id: newId(),
      title: item.title || item.url,
      url: item.url,
      ...(item.note ? { note: item.note } : {}),
      createdAt: item.createdAt || now(),
      ...(item.collectedBy === "agent" ? { addedBy: "agent" as const } : {}),
    });
  }
  for (const item of raw.stack ?? []) {
    if (!item.url) continue;
    carried.push({
      id: newId(),
      title: [item.category, item.tool].filter(Boolean).join(" · ") || item.url,
      url: item.url,
      ...(item.reason ? { note: item.reason } : {}),
      createdAt: now(),
    });
  }

  return {
    id: raw.id,
    name: raw.name,
    note: paragraphs.filter(Boolean).join("\n\n"),
    links: [...(Array.isArray(raw.links) ? raw.links : []), ...carried],
    step: PLAYBOOK_STEPS.includes(raw.step) ? raw.step : LEGACY_STEP[raw.state ?? raw.stage ?? ""] ?? "spot",
    ...(raw.parked || raw.state === "parked" || raw.stage === "paused" ? { parked: true } : {}),
    ...(raw.bet?.claim?.trim() ? { bet: raw.bet } : {}),
    ...(raw.sourceCaptureId ? { sourceCaptureId: raw.sourceCaptureId } : {}),
    createdAt: raw.createdAt || now(),
    updatedAt: raw.updatedAt || raw.createdAt || now(),
  };
}

export function listIdeas(): Idea[] {
  return readJsonArray<Idea & LegacyRecord>(IDEAS_FILE)
    .map(foldLegacy)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getIdea(id: string): Idea | null {
  return listIdeas().find((idea) => idea.id === id) ?? null;
}

export function addIdea(input: { id?: string; name: string; note?: string; step?: StepId; sourceCaptureId?: string }): Idea {
  const name = clean(input.name);
  if (!name) throw new Error("name is required");
  const idea: Idea = {
    id: input.id ?? newId(),
    name,
    note: clean(input.note ?? ""),
    links: [],
    step: input.step ?? "spot",
    ...(input.sourceCaptureId ? { sourceCaptureId: input.sourceCaptureId } : {}),
    createdAt: now(),
    updatedAt: now(),
  };
  updateJsonArray<Idea, void>(IDEAS_FILE, (ideas) => {
    if (ideas.some((item) => item.id === idea.id)) return { value: undefined, changed: false };
    ideas.push(idea);
    return { value: undefined, changed: true };
  });
  return getIdea(idea.id) ?? idea;
}

export type IdeaPatch = Partial<Pick<Idea, "name" | "note" | "step" | "parked" | "links" | "bet">>;

export function updateIdea(id: string, patch: IdeaPatch): Idea | null {
  return updateJsonArray<Idea & LegacyRecord, Idea | null>(IDEAS_FILE, (ideas) => {
    const index = ideas.findIndex((item) => item.id === id);
    if (index < 0) return { value: null, changed: false };
    const current = foldLegacy(ideas[index]!);
    const next: Idea = { ...current, ...patch, updatedAt: now() };
    // A claim you have just admitted did not hold is the one honest reason
    // this tool has to move an idea on its own: leaving it in "thinking" is
    // how a list of ideas becomes a list of things you are avoiding.
    if (patch.bet?.settled === "broke" && current.bet?.settled !== "broke" && patch.parked === undefined) {
      next.parked = true;
    }
    ideas[index] = next;
    return { value: next, changed: true };
  });
}

export function deleteIdea(id: string): Idea | null {
  return updateJsonArray<Idea & LegacyRecord, Idea | null>(IDEAS_FILE, (ideas) => {
    const index = ideas.findIndex((item) => item.id === id);
    if (index < 0) return { value: null, changed: false };
    const [removed] = ideas.splice(index, 1);
    return { value: removed ? foldLegacy(removed) : null, changed: true };
  });
}

/**
 * Save a sourced link to an idea, idempotently.
 *
 * The one write the agent may make without a confirmation step, and the reason
 * it is safe: a link is a pointer with a source attached, not a judgement
 * about the idea. `id` lets a caller replay the same save — a retried request,
 * a re-filed capture — without a second copy appearing.
 */
export function addIdeaLink(ideaId: string, input: { id?: string; title: string; url: string; note?: string; addedBy?: "agent" }): IdeaLink {
  const url = clean(input.url);
  if (!url) throw new Error("url is required");
  const link: IdeaLink = {
    id: input.id ?? newId(),
    title: clean(input.title) || url,
    url: normalizeUrl(url),
    ...(input.note?.trim() ? { note: clean(input.note) } : {}),
    createdAt: now(),
    ...(input.addedBy ? { addedBy: input.addedBy } : {}),
  };

  const found = updateJsonArray<Idea & LegacyRecord, boolean>(IDEAS_FILE, (ideas) => {
    const index = ideas.findIndex((item) => item.id === ideaId);
    if (index < 0) return { value: false, changed: false };
    const idea = foldLegacy(ideas[index]!);
    if (idea.links.some((item) => item.id === link.id || item.url === link.url)) {
      ideas[index] = idea;
      return { value: true, changed: true };
    }
    ideas[index] = { ...idea, links: [...idea.links, link], updatedAt: now() };
    return { value: true, changed: true };
  });
  if (!found) throw new Error(`No idea with id "${ideaId}"`);
  return link;
}

export const STARTER_PRODUCT_LIBRARY: ProductLibraryResource[] = [
  { id: "starter-story-incubation", name: "Starter Story: find → build → distribute → iterate", category: "source", stages: ["inbox", "research", "testing", "building", "live"], productTypes: ["Mobile", "Consumer"], summary: "The source workflow behind this library: find proven demand, build the smallest product, distribute it yourself, then iterate from evidence.", price: "Reference", status: "recommended", source: "Podcast screenshots supplied by the user" },
  { id: "sensor-tower", name: "Sensor Tower", category: "source", stages: ["research"], productTypes: ["Mobile"], summary: "Research app rankings, downloads, categories, and established demand.", price: "Paid", url: "https://sensortower.com", status: "recommended", source: "Starter Story podcast" },
  { id: "youtube", name: "YouTube", category: "source", stages: ["inbox", "research"], productTypes: ["Any"], summary: "Find founder breakdowns, workflows, comments, and repeated user problems.", price: "Free", url: "https://youtube.com", status: "recommended", source: "Starter Story podcast" },
  { id: "x", name: "X", category: "source", stages: ["inbox", "research"], productTypes: ["Any"], summary: "Follow builders and collect concrete pains, launches, and revenue signals.", price: "Free / Paid", url: "https://x.com", status: "recommended", source: "Starter Story podcast" },
  { id: "reddit", name: "Reddit", category: "source", stages: ["research"], productTypes: ["Any"], summary: "Search niche communities for repeated complaints and current workarounds.", price: "Free", url: "https://reddit.com", status: "recommended" },
  { id: "app-store-reviews", name: "App Store reviews", category: "source", stages: ["research"], productTypes: ["Mobile"], summary: "Mine competitor reviews for missing features, churn reasons, and buyer language.", price: "Free", url: "https://apps.apple.com", status: "recommended" },
  { id: "product-hunt", name: "Product Hunt", category: "source", stages: ["research"], productTypes: ["Web", "SaaS", "AI"], summary: "Inspect positioning, launches, alternatives, and early adopter reactions.", price: "Free", url: "https://producthunt.com", status: "recommended" },
  { id: "google-trends", name: "Google Trends", category: "source", stages: ["research"], productTypes: ["Any"], summary: "Check whether interest is growing, seasonal, or disappearing.", price: "Free", url: "https://trends.google.com", status: "recommended" },
  { id: "meta-ad-library", name: "Meta Ad Library", category: "source", stages: ["research", "live"], productTypes: ["Consumer", "Mobile"], summary: "Study active competitor ads and recurring creative angles.", price: "Free", url: "https://www.facebook.com/ads/library", status: "recommended" },
  { id: "tiktok-creative-center", name: "TikTok Creative Center", category: "source", stages: ["research", "live"], productTypes: ["Consumer", "Mobile"], summary: "Find current creative patterns, hooks, and category signals.", price: "Free", url: "https://ads.tiktok.com/business/creativecenter", status: "recommended" },
  { id: "interviews", name: "Problem interviews", category: "test", stages: ["testing"], productTypes: ["Any"], summary: "Ask about real past behaviour, current workarounds, frequency, and cost.", price: "Free", status: "recommended" },
  { id: "waitlist", name: "Landing page + waitlist", category: "test", stages: ["testing"], productTypes: ["Any"], summary: "Test whether a concrete promise converts relevant traffic into signups.", price: "Low", status: "recommended" },
  { id: "fake-door", name: "Fake door", category: "test", stages: ["testing"], productTypes: ["Any"], summary: "Measure intent before building the full feature; disclose clearly after the click.", price: "Low", status: "recommended" },
  { id: "pricing-test", name: "Pricing test", category: "test", stages: ["testing"], productTypes: ["SaaS", "Mobile"], summary: "Test willingness to pay with explicit prices, not general enthusiasm.", price: "Low", status: "recommended" },
  { id: "ad-smoke-test", name: "Paid-ad smoke test", category: "test", stages: ["testing"], productTypes: ["Consumer", "Mobile"], summary: "Run a bounded campaign to compare hooks and qualified conversion intent.", price: "Variable", status: "recommended", source: "Starter Story podcast" },
  { id: "concierge-mvp", name: "Concierge MVP", category: "test", stages: ["testing"], productTypes: ["SaaS", "Service"], summary: "Deliver the outcome manually before automating the workflow.", price: "Time", status: "recommended" },
  { id: "retention-test", name: "Retention test", category: "test", stages: ["live"], productTypes: ["Any"], summary: "Measure whether users return after the initial novelty passes.", price: "Variable", status: "recommended" },
  { id: "starter-story-stack", name: "Starter Story app stack", category: "stack", stages: ["building", "live"], productTypes: ["Mobile"], summary: "Cursor, Claude Code, domain, Loops, Superwall, Mixpanel, Apple Developer, Figma, and Supabase — a reference recipe, not a mandatory shopping list.", price: "Check each tool", status: "recommended", source: "Starter Story podcast" },
  { id: "lean-web-stack", name: "Lean web SaaS stack", category: "stack", stages: ["testing", "building"], productTypes: ["Web", "SaaS"], summary: "Start with the existing web framework, Supabase, and PostHog; add paid services only when the experiment needs them.", price: "$0+", status: "recommended" },
  { id: "cursor", name: "Cursor", category: "tool", stages: ["building"], productTypes: ["Web", "Mobile", "AI"], summary: "AI-assisted code editor.", price: "Check official pricing", url: "https://cursor.com", status: "recommended", source: "Starter Story podcast" },
  { id: "claude-code", name: "Claude Code", category: "tool", stages: ["building"], productTypes: ["Web", "Mobile", "AI"], summary: "Agentic coding assistant for repository work.", price: "Check official pricing", url: "https://claude.ai/code", status: "recommended", source: "Starter Story podcast" },
  { id: "figma", name: "Figma", category: "tool", stages: ["testing", "building"], productTypes: ["Any"], summary: "Product design and interactive prototypes.", price: "Free / Paid", url: "https://figma.com", status: "recommended", source: "Starter Story podcast" },
  { id: "supabase", name: "Supabase", category: "tool", stages: ["building"], productTypes: ["Web", "Mobile", "SaaS"], summary: "Hosted Postgres, authentication, storage, and edge functions.", price: "Free / Paid", url: "https://supabase.com", status: "recommended", source: "Starter Story podcast" },
  { id: "superwall", name: "Superwall", category: "tool", stages: ["building", "live"], productTypes: ["Mobile"], summary: "Subscription paywall creation and experimentation.", price: "Check official pricing", url: "https://superwall.com", status: "recommended", source: "Starter Story podcast" },
  { id: "mixpanel", name: "Mixpanel", category: "tool", stages: ["testing", "live"], productTypes: ["Any"], summary: "Product analytics and funnel analysis.", price: "Free / Paid", url: "https://mixpanel.com", status: "recommended", source: "Starter Story podcast" },
  { id: "posthog", name: "PostHog", category: "tool", stages: ["testing", "live"], productTypes: ["Web", "SaaS"], summary: "Product analytics, replay, feature flags, and experiments.", price: "Free / Paid", url: "https://posthog.com", status: "recommended" },
  { id: "loops", name: "Loops", category: "tool", stages: ["building", "live"], productTypes: ["SaaS"], summary: "Lifecycle and transactional email for software products.", price: "Check official pricing", url: "https://loops.so", status: "recommended", source: "Starter Story podcast" },
  { id: "revenuecat", name: "RevenueCat", category: "tool", stages: ["building", "live"], productTypes: ["Mobile"], summary: "Cross-platform subscription infrastructure and revenue analytics.", price: "Free / Paid", url: "https://revenuecat.com", status: "recommended" },
  { id: "apple-developer", name: "Apple Developer Program", category: "tool", stages: ["building", "live"], productTypes: ["iOS"], summary: "Required to distribute apps through Apple's stores.", price: "Check official pricing", url: "https://developer.apple.com/programs/", status: "recommended", source: "Starter Story podcast" },
  { id: "godaddy", name: "GoDaddy", category: "tool", stages: ["building", "live"], productTypes: ["Any"], summary: "Domain registration; compare renewal cost and simpler registrar alternatives before buying.", price: "Check official pricing", url: "https://godaddy.com", status: "recommended", source: "Starter Story podcast" },
  { id: "creator-retainer", name: "Creator retainer", category: "distribution", stages: ["live"], productTypes: ["Consumer", "Mobile"], summary: "Build a repeatable stream of native creative with category-fit creators.", price: "Variable", status: "recommended", source: "Starter Story podcast" },
  { id: "founder-content", name: "Founder-led content", category: "distribution", stages: ["research", "testing", "live"], productTypes: ["Any"], summary: "Learn the audience by publishing the problem and product yourself.", price: "Time", status: "recommended", source: "Starter Story podcast" },
  { id: "community-launch", name: "Community launch", category: "distribution", stages: ["testing", "live"], productTypes: ["Any"], summary: "Launch where the target user already gathers, with useful context rather than spam.", price: "Free", status: "recommended" },
  { id: "meta-winner-loop", name: "Creator → Meta Ads → double down", category: "distribution", stages: ["testing", "live"], productTypes: ["Consumer", "Mobile"], summary: "Test creator assets, promote winners, and rotate before creative fatigue.", price: "Variable", status: "recommended", source: "Starter Story podcast" },
];

export function listLibraryResources(): ProductLibraryResource[] {
  const overrides = new Map(readJsonArray<ProductLibraryResource>(LIBRARY_FILE).map((item) => [item.id, item]));
  const seeded = STARTER_PRODUCT_LIBRARY.map((item) => ({ ...item, ...overrides.get(item.id) }));
  const seedIds = new Set(STARTER_PRODUCT_LIBRARY.map((item) => item.id));
  return [...seeded, ...[...overrides.values()].filter((item) => !seedIds.has(item.id))];
}

/**
 * Writing a price is what stamps `lastChecked`.
 *
 * The stamp is never passed in. If it were a field of its own somebody would
 * eventually re-check a price, correct nothing because it had not moved, and
 * leave the date reading months old — or worse, refresh the date without
 * opening the page. Deriving it from the write makes the two impossible to
 * separate: the date means "this exact string was read off the vendor that
 * day", which is the only claim the library can honestly make.
 */
export function updateLibraryResource(id: string, patch: Partial<Pick<ProductLibraryResource, "status" | "name" | "summary" | "price" | "url">>): ProductLibraryResource | null {
  const current = listLibraryResources().find((item) => item.id === id);
  if (!current) return null;
  const next: ProductLibraryResource = {
    ...current,
    ...patch,
    ...(patch.url?.trim() ? { url: normalizeUrl(patch.url) } : patch.url === "" ? { url: undefined } : {}),
    ...(patch.price !== undefined ? { lastChecked: localDate() } : {}),
    updatedAt: now(),
  };
  updateJsonArray<ProductLibraryResource, void>(LIBRARY_FILE, (items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items[index] = next;
    else items.push(next);
    return { value: undefined, changed: true };
  });
  return next;
}

export function addLibraryResource(input: {
  id?: string;
  name: string;
  summary?: string;
  category?: LibraryCategory;
  url?: string;
  source?: string;
}): ProductLibraryResource {
  const name = clean(input.name);
  if (!name) throw new Error("name is required");
  const resource: ProductLibraryResource = {
    id: input.id ?? newId(),
    name,
    category: input.category ?? "source",
    stages: ["research"],
    productTypes: ["Any"],
    summary: clean(input.summary ?? ""),
    price: "Unknown",
    ...(input.url?.trim() ? { url: normalizeUrl(input.url) } : {}),
    status: "saved",
    ...(input.source ? { source: clean(input.source) } : {}),
    updatedAt: now(),
  };
  updateJsonArray<ProductLibraryResource, void>(LIBRARY_FILE, (items) => {
    if (!items.some((item) => item.id === resource.id)) items.push(resource);
    return { value: undefined, changed: true };
  });
  return resource;
}

export function listCaptures(): ProductCapture[] {
  return readJsonArray<ProductCapture>(CAPTURES_FILE).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function addCapture(input: { text?: string; images?: ProductCapture["images"] }): ProductCapture {
  const text = clean(input.text ?? "");
  const images = input.images ?? [];
  if (!text && images.length === 0) throw new Error("text or an image is required");
  const capture: ProductCapture = {
    id: newId(),
    text,
    images,
    status: "pending",
    createdAt: now(),
  };
  updateJsonArray<ProductCapture, void>(CAPTURES_FILE, (items) => {
    items.push(capture);
    return { value: undefined, changed: true };
  });
  return capture;
}

export function fileCapture(input: {
  id: string;
  kind: "idea" | "resource" | "link" | "note";
  title: string;
  summary?: string;
  url?: string;
  ideaId?: string;
}): ProductCapture {
  const capture = listCaptures().find((item) => item.id === input.id);
  if (!capture) throw new Error(`No capture with id "${input.id}"`);
  if (capture.status === "filed") return capture;

  const targetId = `capture-${capture.id}`;
  let filedTargetId: string | undefined = targetId;
  if (input.kind === "idea") {
    addIdea({ id: targetId, name: input.title, note: input.summary, sourceCaptureId: capture.id });
  } else if (input.kind === "resource") {
    addLibraryResource({ id: targetId, name: input.title, summary: input.summary, url: input.url, source: `Capture ${capture.id}` });
  } else if (input.kind === "link") {
    if (!input.ideaId) throw new Error("ideaId is required for a link");
    if (!input.url) throw new Error("url is required for a link");
    filedTargetId = addIdeaLink(input.ideaId, { id: targetId, title: input.title, url: input.url, note: input.summary }).id;
  } else {
    filedTargetId = undefined;
  }

  const filed = updateJsonArray<ProductCapture, ProductCapture>(CAPTURES_FILE, (items) => {
    const current = items.find((item) => item.id === input.id);
    if (!current) throw new Error(`No capture with id "${input.id}"`);
    current.status = "filed";
    current.filedAs = input.kind;
    current.targetId = filedTargetId;
    return { value: current, changed: true };
  });
  return filed;
}

/** Test helper and explicit reset only; production code never calls this. */
export function writeIdeas(ideas: Idea[]): void {
  writeJsonArray(IDEAS_FILE, ideas);
}
