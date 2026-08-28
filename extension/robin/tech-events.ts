/**
 * The Bay Area tech-events feed: what it keeps, and why.
 *
 * A city-wide event feed is not a tech feed. Roughly half of what Luma
 * publishes for San Francisco on any given week is book clubs, run clubs,
 * supper clubs and gallery openings, so the whole value of this module is the
 * part that decides which rows survive — a page that lists "Pokémon Drone Show
 * Watch Party" next to an inference meetup is a page nobody opens twice.
 *
 * Pure and dependency-free on purpose: no `node:fs`, no network. The scanner
 * (./tech-event-scan.ts) and the sources (./tech-event-sources.ts) are the
 * server-only halves, and the browser imports the types and `TOPIC_ORDER` from
 * here. Keeping the classifier out of both means it can be tested against a
 * saved feed without a network or a data directory.
 */

/** Rough Bay Area box: Santa Cruz up to Santa Rosa, coast to the Delta. */
const BAY_AREA_BOUNDS = { minLat: 36.9, maxLat: 38.5, minLon: -123.2, maxLon: -121.4 };

/**
 * Fallback for events whose host published a city but no coordinate.
 *
 * Only the nine-county core plus the peninsula towns that actually host
 * things. Deliberately not a substring match on "San" or a state check: "San
 * Diego, CA" is in California and is not somewhere you can get to after work.
 */
const BAY_AREA_CITIES = new Set([
  "san francisco", "oakland", "berkeley", "emeryville", "alameda", "richmond", "albany",
  "san mateo", "burlingame", "millbrae", "south san francisco", "brisbane", "daly city",
  "redwood city", "menlo park", "palo alto", "east palo alto", "stanford", "atherton",
  "mountain view", "sunnyvale", "santa clara", "san jose", "cupertino", "campbell",
  "los altos", "los gatos", "milpitas", "fremont", "newark", "union city", "hayward",
  "san leandro", "san carlos", "belmont", "foster city", "san bruno", "pacifica",
  "walnut creek", "pleasanton", "dublin", "livermore", "concord", "san rafael",
  "sausalito", "mill valley", "novato", "petaluma", "santa rosa", "vallejo",
]);

export const TECH_EVENT_TOPICS = ["ai", "swe", "data", "hardware", "startup"] as const;
export type TechEventTopic = (typeof TECH_EVENT_TOPICS)[number];

/**
 * One event, as the page renders it.
 *
 * `startAt` is a UTC instant, unlike the calendar's `CalendarEvent.date` — see
 * ./dates.ts for why those are different kinds of value. An event three time
 * zones away that starts at 18:00 local is a real instant, and the page turns
 * it back into wall-clock time with `timezone`.
 */
export interface TechEvent {
  /** Stable across scans: `${source}:${native id}`. */
  id: string;
  title: string;
  /** The public page you RSVP on. */
  url: string;
  /** Which feed found it — "luma" today. */
  source: string;
  /** The calendar or community that published it. */
  host?: string;
  /** UTC instant, ISO 8601. */
  startAt: string;
  /** UTC instant, ISO 8601. */
  endAt?: string;
  /** IANA zone the host set, so the page can show local wall-clock time. */
  timezone?: string;
  /** "San Francisco, CA", when the host published an address. */
  city?: string;
  /** Street-level line, when there is one. Hosts often hide it until you RSVP. */
  venue?: string;
  online: boolean;
  free?: boolean;
  soldOut?: boolean;
  /** The host screens registrations — worth knowing before you plan an evening. */
  requiresApproval?: boolean;
  /** How many have registered. A crowd is the one honest signal of a real event. */
  guests?: number;
  coverUrl?: string;
  topics: TechEventTopic[];
  /** 0–5, from how much of the vocabulary the title and host matched. */
  score: number;
  /** The terms that admitted it, so "why is this here" is answerable. */
  matched: string[];
  /** UTC instant, ISO 8601. */
  discoveredAt: string;
  saved?: boolean;
  hidden?: boolean;
}

export interface TechEventSourceResult {
  id: string;
  name: string;
  /** Rows the source returned, before any filtering. */
  seen: number;
  /** Rows that survived the region and topic filters. */
  kept: number;
  error?: string;
}

export interface TechEventScanState {
  /** UTC instant, ISO 8601. */
  startedAt: string;
  /** UTC instant, ISO 8601. Absent while a scan is still running. */
  finishedAt?: string;
  seen: number;
  kept: number;
  added: number;
  /** Events dropped because they had already happened. */
  expired: number;
  sources: TechEventSourceResult[];
}

/* ─────────────────────────── the vocabulary ─────────────────────────── */

/**
 * Three lists, and only the first two can admit an event on their own.
 *
 * The split is what stops the feed drifting into a general startup feed. "Deep
 * tech founder dinner" is a networking event that happens to be attended by
 * engineers; "Agent Build Night" is the thing that was asked for. So SUPPORT
 * only ever raises the score of a row something else already admitted.
 */
const AI_TERMS = [
  "ai", "llm", "llms", "genai", "agentic", "agent", "agents", "ml", "mlops", "nlp", "rag",
  "gpu", "cuda", "asr", "tts", "ocr", "machine learning", "deep learning", "neural",
  "natural language", "computer vision", "reinforcement learning", "foundation model",
  "large language", "language model", "frontier model", "open model", "model", "models",
  "inference", "fine tuning", "fine tune", "finetuning", "pretraining", "post training",
  "embedding", "embeddings", "vector search", "transformer", "transformers", "diffusion",
  "generative", "genmedia", "multimodal", "robotics", "robotic", "humanoid", "autonomous",
  "self driving", "intelligence", "superintelligence", "alignment", "interpretability",
  "evals", "benchmark", "prompt", "prompting", "copilot", "chatbot", "bot", "bots",
  "voice ai", "physical ai", "sim to real", "ground truth", "context window", "tokens",
  "gpt", "claude", "gemini", "llama", "grok", "mistral", "deepseek", "qwen",
  "stable diffusion", "midjourney", "sora", "whisper",
];

const SWE_TERMS = [
  "software", "engineer", "engineers", "engineering", "developer", "developers", "dev",
  "devs", "devtools", "dev tools", "devops", "devrel", "sre", "platform engineering",
  "backend", "frontend", "full stack", "fullstack", "web dev", "webdev", "mobile dev",
  "programming", "coding", "code", "codebase", "open source", "open-source", "api", "apis",
  "sdk", "cli", "database", "databases", "sql", "distributed systems", "microservices",
  "kubernetes", "k8s", "docker", "container", "containers", "serverless", "cloud", "infra",
  "infrastructure", "observability", "security", "cybersecurity", "appsec", "cryptography",
  "compiler", "compilers", "runtime", "operating system", "systems", "wasm", "webassembly",
  "rust", "golang", "python", "typescript", "javascript", "java", "kotlin", "swift",
  "scala", "haskell", "elixir", "react", "nextjs", "node", "postgres", "postgresql",
  "hackathon", "hack", "hacknight", "hack night", "demo", "demos", "demo night",
  "build night", "buildathon", "tech talk", "tech talks", "technical talk",
  "technical talks", "tech meetup", "git", "github", "testing", "refactoring",
  "architecture", "scaling", "latency", "throughput",
];

/**
 * Company names, matched in the title *or* the host calendar.
 *
 * This is the list that catches the events whose titles say nothing — "Supabase
 * Select 2026", "The Acquired Meetup" hosted by Sentry, "Cafe Cowork:
 * Temporal". A developer-tool company's community calendar is a developer
 * event calendar, whatever it called this particular evening.
 *
 * Split in two so a brand-only match still lands in a topic. Without the
 * split, "Coffeehouse by Ode with Anthropic" is admitted and then carries no
 * chip at all, which means it is missing from every filter but "All" — present
 * in the data and invisible on the page.
 */
const AI_BRAND_TERMS = [
  "openai", "anthropic", "deepmind", "nvidia", "huggingface", "hugging face", "langchain",
  "llamaindex", "pinecone", "weaviate", "chroma", "wandb", "arize", "braintrust",
  "openrouter", "groq", "together ai", "fireworks", "perplexity", "cursor", "codeium",
  "windsurf", "cognition", "gumloop", "modal", "replicate", "runway", "elevenlabs",
  "scale ai", "surge ai", "cohere", "stability ai", "mistral",
];

const DEV_BRAND_TERMS = [
  "google", "microsoft", "meta", "amd", "intel", "aws", "azure", "cloudflare", "vercel",
  "netlify", "supabase", "firebase", "mongodb", "redis", "neon", "planetscale",
  "clickhouse", "duckdb", "databricks", "snowflake", "datadog", "sentry", "posthog",
  "linear", "notion", "figma", "stripe", "twilio", "segment", "temporal", "kafka",
  "confluent", "elastic", "grafana", "hashicorp", "gitlab", "jetbrains", "postman",
  "workos", "auth0", "okta", "clerk", "railway", "render", "fly.io", "replit", "zapier",
  "retool", "fal", "y combinator", "a16z", "sequoia",
];

const SUPPORT_TERMS = [
  "startup", "startups", "founder", "founders", "tech", "technical", "technology",
  "builder", "builders", "product", "data", "saas", "deep tech", "yc", "venture",
  "research", "science", "hardware", "chip", "chips", "semiconductor", "quantum",
  "crypto", "web3", "blockchain",
];

/**
 * Phrases that settle it before the vocabulary gets a vote.
 *
 * Every one of these is here because a real row matched on something else: a
 * "Founder Comedy Night", a book club whose blurb mentions technology, a run
 * club hosted from a startup's calendar. They are all two-word phrases, which
 * is what keeps "Book Club" from vetoing "Bay Area Rust Book Club" — that one
 * would be vetoed too, and losing one reading group is the cheaper mistake.
 */
const VETO_TERMS = [
  "real estate", "yoga", "book club", "run club", "wine tasting", "comedy", "improv",
  "speed dating", "matchmaking", "meditation", "sound bath", "pilates", "tarot",
  "astrology", "day party", "bakery run", "supper club", "dinner party", "brunch",
];

/** Topic assignment, so the page's filter chips mean something. */
const TOPIC_TERMS: Record<Exclude<TechEventTopic, "ai" | "swe">, string[]> = {
  data: ["data", "database", "databases", "sql", "postgres", "postgresql", "clickhouse",
    "duckdb", "snowflake", "databricks", "analytics", "warehouse", "etl", "streaming"],
  hardware: ["hardware", "chip", "chips", "semiconductor", "robotics", "robotic",
    "humanoid", "gpu", "cuda", "drone", "drones", "quantum", "physical ai"],
  startup: ["startup", "startups", "founder", "founders", "yc", "y combinator", "venture",
    "a16z", "sequoia", "pitch", "demo day", "fundraising", "seed"],
};

/**
 * Words of the text, plus the text itself for phrase lookups.
 *
 * `+ # .` survive the strip so "c++", "c#" and "fly.io" stay single tokens;
 * the per-token trim then takes the sentence punctuation back off, so "SF."
 * is the token "sf" and not "sf.".
 */
function tokenize(text: string): { words: Set<string>; phrase: string } {
  const flat = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
  const words = new Set(
    flat.split(/\s+/).map((word) => word.replace(/^\.+|\.+$/g, "")).filter(Boolean),
  );
  return { words, phrase: ` ${flat} ` };
}

/**
 * Which terms appear, matched whole.
 *
 * Whole-word matching is not a nicety here. On a substring match "Eragon"
 * contains "rag", "Escaping" contains "api", and "Flatland" contains "ml" —
 * three real rows from one week's feed, every one of them a party.
 */
function matchTerms(tokens: ReturnType<typeof tokenize>, terms: readonly string[]): string[] {
  const found: string[] = [];
  for (const term of terms) {
    if (term.includes(" ") || term.includes("-")) {
      if (tokens.phrase.includes(` ${term.replace(/-/g, " ")} `)) found.push(term);
    } else if (tokens.words.has(term)) {
      found.push(term);
    }
  }
  return found;
}

export interface Classification {
  admit: boolean;
  topics: TechEventTopic[];
  /** 0–5. Ranks rows within a day; never decides whether one is shown. */
  score: number;
  matched: string[];
}

/**
 * Is this an AI or software-engineering event, and how strongly?
 *
 * Admission needs one hit from the AI list, the software list, or the brand
 * list. Support terms alone never admit — that path was tried first and it
 * turned "Raising Your Seed Round" and "Health Tech Happy Hour" into
 * engineering events.
 */
export function classifyTechEvent(input: {
  title: string;
  host?: string;
  /** The host calendar's own blurb. Adds score, never admits on its own. */
  hostDescription?: string;
}): Classification {
  const subject = tokenize(`${input.title} ${input.host ?? ""}`);
  if (matchTerms(subject, VETO_TERMS).length > 0) {
    return { admit: false, topics: [], score: 0, matched: [] };
  }

  const ai = matchTerms(subject, AI_TERMS);
  const swe = matchTerms(subject, SWE_TERMS);
  const aiBrand = matchTerms(subject, AI_BRAND_TERMS);
  const devBrand = matchTerms(subject, DEV_BRAND_TERMS);
  const brand = [...aiBrand, ...devBrand];
  const support = matchTerms(subject, SUPPORT_TERMS);
  if (ai.length === 0 && swe.length === 0 && brand.length === 0) {
    return { admit: false, topics: [], score: 0, matched: [] };
  }

  // The blurb is capped before it is read: a long calendar description would
  // otherwise out-vote the title it is supposed to be corroborating.
  const blurb = input.hostDescription
    ? tokenize(input.hostDescription.slice(0, 400))
    : null;
  const corroborated = blurb
    ? matchTerms(blurb, AI_TERMS).length + matchTerms(blurb, SWE_TERMS).length
    : 0;

  const topics: TechEventTopic[] = [];
  if (ai.length > 0 || aiBrand.length > 0) topics.push("ai");
  if (swe.length > 0 || devBrand.length > 0) topics.push("swe");
  for (const [topic, terms] of Object.entries(TOPIC_TERMS)) {
    if (matchTerms(subject, terms).length > 0) topics.push(topic as TechEventTopic);
  }

  const score = Math.min(5, Math.round((
    1.4 * Math.min(ai.length, 3)
    + 1.2 * Math.min(swe.length, 3)
    + 0.8 * Math.min(brand.length, 2)
    + 0.3 * Math.min(support.length, 3)
    + 0.2 * Math.min(corroborated, 3)
  ) * 10) / 10);

  return {
    admit: true,
    topics: TECH_EVENT_TOPICS.filter((topic) => topics.includes(topic)),
    score,
    matched: [...new Set([...ai, ...swe, ...brand])].slice(0, 6),
  };
}

/**
 * Is this somewhere you could actually get to?
 *
 * The coordinate is trusted first because it is unambiguous; the city name is
 * the fallback for hosts who published an address but no pin. An event with
 * neither is not assumed local — the whole point of the box is that a feed
 * scoped to "San Francisco" still carries events in Austin and London.
 */
export function inBayArea(place: {
  latitude?: number;
  longitude?: number;
  city?: string;
}): boolean {
  const { latitude, longitude } = place;
  if (typeof latitude === "number" && typeof longitude === "number") {
    return latitude >= BAY_AREA_BOUNDS.minLat && latitude <= BAY_AREA_BOUNDS.maxLat
      && longitude >= BAY_AREA_BOUNDS.minLon && longitude <= BAY_AREA_BOUNDS.maxLon;
  }
  if (!place.city) return false;
  // "San Francisco, CA" and "San Francisco, California" both reduce to the key.
  return BAY_AREA_CITIES.has(place.city.split(",")[0]!.trim().toLowerCase());
}

/* ─────────────────────────── list upkeep ─────────────────────────── */

/** Grace period: a talk that started at 18:00 is still worth seeing at 19:30. */
const ENDED_GRACE_MS = 4 * 60 * 60 * 1_000;

/** Once a week, as asked. Checked on read, so a browser visit is what triggers it. */
export const SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Is it time to scan again?
 *
 * Keyed off `startedAt`, not `finishedAt`: a scan that died halfway through
 * has still spent the week's requests, and re-running it on every page load
 * until it succeeds is how a personal dashboard gets itself rate-limited.
 */
export function isScanDue(state: TechEventScanState | null, now = Date.now()): boolean {
  if (!state) return true;
  const started = Date.parse(state.startedAt);
  if (!Number.isFinite(started)) return true;
  return now - started >= SCAN_INTERVAL_MS;
}

/** Has it already happened? */
export function hasPassed(event: TechEvent, now = Date.now()): boolean {
  const ends = event.endAt ? Date.parse(event.endAt) : Number.NaN;
  if (Number.isFinite(ends)) return ends < now;
  const starts = Date.parse(event.startAt);
  if (!Number.isFinite(starts)) return false;
  return starts + ENDED_GRACE_MS < now;
}

/** Soonest first; within a day, the stronger match leads. */
export function sortTechEvents(events: readonly TechEvent[]): TechEvent[] {
  return [...events].sort((a, b) => (
    a.startAt.localeCompare(b.startAt) || b.score - a.score || a.title.localeCompare(b.title)
  ));
}

/**
 * Fold a scan's results into the stored list.
 *
 * What the scan owns and what the reader owns are kept strictly apart: a
 * rescan refreshes every fact the host publishes (a moved event, a sold-out
 * one), and never touches `saved`, `hidden`, or `discoveredAt`. Losing "I've
 * already decided about this one" every Monday would make the page useless
 * exactly as it filled up.
 */
export function mergeTechEvents(
  stored: readonly TechEvent[],
  scanned: readonly TechEvent[],
  now = Date.now(),
): { events: TechEvent[]; added: number; expired: number } {
  const byId = new Map(stored.map((event) => [event.id, event]));
  let added = 0;

  for (const fresh of scanned) {
    const existing = byId.get(fresh.id);
    if (!existing) {
      byId.set(fresh.id, fresh);
      added += 1;
      continue;
    }
    byId.set(fresh.id, {
      ...fresh,
      discoveredAt: existing.discoveredAt,
      ...(existing.saved ? { saved: true } : {}),
      ...(existing.hidden ? { hidden: true } : {}),
    });
  }

  const live = [...byId.values()].filter((event) => !hasPassed(event, now));
  return { events: sortTechEvents(live), added, expired: byId.size - live.length };
}
