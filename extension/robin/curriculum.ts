/**
 * The study curriculum — hand-curated reference data.
 *
 * Unlike ./neetcode-catalog.ts this file is not generated: there is no
 * upstream to regenerate it from, because the ordering *is* the content. A
 * shelf of good links is not a curriculum; what makes it one is that each
 * module says what you can do when it is behind you, and ends in something you
 * have to build. Those two sentences per module are the part that cannot be
 * scraped.
 *
 * An item is keyed by a stable id rather than its URL. URLs move — freeCodeCamp
 * has already renumbered its courses once — and a moved URL must not silently
 * orphan the history filed under it.
 *
 * Every item is a way out to somewhere else: the workspace opens these in a
 * tab rather than a frame, so there is nothing here recording whether a host
 * permits being framed. It stopped mattering when the frame went.
 */

export const ITEM_KINDS = ["course", "docs", "video", "book", "repo", "gallery", "milestone"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface CurriculumItem {
  /** Stable, globally unique across the curriculum. Records are filed under it. */
  id: string;
  title: string;
  kind: ItemKind;
  /** Absent only on a milestone, which is something you do rather than somewhere you go. */
  url?: string;
  /** One line on why this earns a place here — not a description of its contents. */
  hint?: string;
}

export interface CurriculumModule {
  id: string;
  title: string;
  /** What you can do once this module is behind you. Written as a capability, not a topic. */
  outcome: string;
  items: CurriculumItem[];
}

export interface CurriculumTrack {
  id: string;
  title: string;
  outcome: string;
  modules: CurriculumModule[];
}

/**
 * The tracks, in the order they build on each other.
 *
 * Foundations first because everything after it assumes the language; the web
 * and Python tracks are siblings and can be taken in either order; architecture
 * comes after both because designing a system you have never built is how you
 * end up with designs that sound right and cannot be implemented. Projects and
 * craft are not a phase — they run alongside, which is why they carry
 * milestones but no reading order.
 */
export const CURRICULUM: readonly CurriculumTrack[] = [
  {
    id: "foundations",
    title: "Language foundations",
    outcome:
      "Write JavaScript and TypeScript you can defend in review: closures and async you can reason about, and a type system you use on purpose rather than to silence errors.",
    modules: [
      {
        id: "js-core",
        title: "JavaScript, properly",
        outcome:
          "Explain closures, `this`, the event loop, and prototypes well enough to debug someone else's code with them.",
        items: [
          {
            id: "fcc-javascript-v9",
            title: "freeCodeCamp — JavaScript V9",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/javascript-v9/",
            hint: "The drilling ground. Do it for the reps; the certificate is not the point.",
          },
          {
            id: "mdn-js-guide",
            title: "MDN — JavaScript Guide",
            kind: "docs",
            url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
            hint: "The reference to reach for mid-problem. Read the Guide, not only the API pages.",
          },
          {
            id: "js-video",
            title: "JavaScript walkthrough",
            kind: "video",
            url: "https://www.youtube.com/watch?v=jS4aFq5-91M",
          },
          {
            id: "js-core-milestone",
            title: "Build: debounce, throttle, an event emitter",
            kind: "milestone",
            hint:
              "Write all three from scratch, no library, then say out loud why each one needs a closure and what breaks without it.",
          },
        ],
      },
      {
        id: "typescript",
        title: "TypeScript as a type system",
        outcome:
          "Model a domain in types — unions, generics, narrowing — so that a wrong state fails to compile instead of failing at runtime.",
        items: [
          {
            id: "ts-docs",
            title: "TypeScript Docs",
            kind: "docs",
            url: "https://www.typescriptlang.org/docs/",
            hint: "The handbook front to back once, then the reference as needed.",
          },
          {
            id: "ts-advanced-playlist",
            title: "Advanced TypeScript (playlist)",
            kind: "video",
            url: "https://www.youtube.com/watch?v=lMfGp29Ht8c&list=PLIvujZeVDLMx040-j1W4WFs1BxuTGdI_b",
          },
          {
            id: "typescript-milestone",
            title: "Build: type an untyped module end to end",
            kind: "milestone",
            hint:
              "Take a real module, give its states discriminated unions and its repetition generics, and get `strict` passing with no `any` and no casts.",
          },
        ],
      },
    ],
  },
  {
    id: "fullstack",
    title: "The web, end to end",
    outcome:
      "Ship a whole application: a UI with state you can account for, an API with validation and auth, a schema with indexes, and a deploy that runs from CI.",
    modules: [
      {
        id: "frontend-libraries",
        title: "Front-end libraries",
        outcome:
          "Build a component tree where every piece of state has one obvious owner, and say why it lives there.",
        items: [
          {
            id: "fcc-frontend-libraries",
            title: "freeCodeCamp — Front End Development Libraries V9",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/front-end-development-libraries-v9/",
          },
          {
            id: "frontend-libraries-milestone",
            title: "Build: rebuild one panel of this dashboard",
            kind: "milestone",
            hint:
              "Pick a panel you use daily, rebuild it as a component with its own state, and justify each state location — server, URL, or component.",
          },
        ],
      },
      {
        id: "backend-apis",
        title: "APIs that survive contact",
        outcome:
          "Design an HTTP interface with validation, auth, and errors a client can actually act on.",
        items: [
          {
            id: "fcc-backend-apis",
            title: "freeCodeCamp — Back End Development and APIs",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/back-end-development-and-apis/",
          },
          {
            id: "backend-apis-milestone",
            title: "Build: a service with real failure behaviour",
            kind: "milestone",
            hint:
              "Validation on every input, auth on every route, and a written list of its failure modes and what the client sees for each.",
          },
        ],
      },
      {
        id: "relational-data",
        title: "Relational data",
        outcome:
          "Turn a domain into a schema: keys, constraints, the indexes it needs, and the queries that would otherwise be N+1.",
        items: [
          {
            id: "fcc-relational-database",
            title: "freeCodeCamp — Relational Database",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/relational-database/",
          },
          {
            id: "relational-data-milestone",
            title: "Build: the ER diagram for a project you already have",
            kind: "milestone",
            hint:
              "Draw it, then name every index it needs and every place the current code would fire one query per row.",
          },
        ],
      },
      {
        id: "full-stack-open",
        title: "The whole stack, in one pass",
        outcome:
          "Carry one application from component to deploy without leaving a layer to someone else.",
        items: [
          {
            id: "fullstackopen",
            title: "Full Stack Open",
            kind: "course",
            url: "https://fullstackopen.com/en/",
            hint: "The most complete single path here. Long — treat it as the spine of a season, not a week.",
          },
          {
            id: "full-stack-open-milestone",
            title: "Build: deploy something yourself",
            kind: "milestone",
            hint:
              "CI, environment config, and a rollback you have actually run once — not one you believe would work.",
          },
        ],
      },
    ],
  },
  {
    id: "python",
    title: "Python engineering",
    outcome:
      "Write Python that ships: typed, tested, packaged, and running in CI rather than on your machine.",
    modules: [
      {
        id: "fastapi",
        title: "Services with FastAPI",
        outcome: "Serve typed request and response models, with docs you would hand to a stranger.",
        items: [
          {
            id: "fastapi-tutorial",
            title: "FastAPI Tutorial",
            kind: "docs",
            url: "https://fastapi.tiangolo.com/tutorial/",
          },
          {
            id: "fastapi-milestone",
            title: "Build: put one of your own tools behind an API",
            kind: "milestone",
            hint: "Typed models both directions, and generated docs that are enough on their own.",
          },
        ],
      },
      {
        id: "testing-ci",
        title: "Tests and CI",
        outcome:
          "Write tests that fail for the right reason, and a pipeline that blocks a merge when they do.",
        items: [
          {
            id: "pytest-getting-started",
            title: "pytest — Getting Started",
            kind: "docs",
            url: "https://docs.pytest.org/en/stable/getting-started.html",
          },
          {
            id: "gh-actions-python",
            title: "GitHub Actions — Build and Test Python",
            kind: "docs",
            url: "https://docs.github.com/en/actions/tutorials/build-and-test-code/python",
          },
          {
            id: "testing-ci-milestone",
            title: "Build: get one repo to a green pipeline",
            kind: "milestone",
            hint:
              "Then break a test on purpose and confirm the merge is actually blocked. A pipeline nobody has seen fail proves nothing.",
          },
        ],
      },
      {
        id: "packaging",
        title: "Packaging",
        outcome: "Turn a folder of scripts into something installable by someone who is not you.",
        items: [
          {
            id: "packaging-python",
            title: "Packaging Python Projects",
            kind: "docs",
            url: "https://packaging.python.org/en/latest/tutorials/packaging-projects/",
          },
          {
            id: "packaging-milestone",
            title: "Build: publish to TestPyPI",
            kind: "milestone",
            hint: "Then install it into a clean virtualenv and run it. That last step is the test.",
          },
        ],
      },
    ],
  },
  {
    id: "architecture",
    title: "Architecture & system design",
    outcome:
      "Take a vague requirement to a design you can defend: boundaries, data model, failure behaviour, and trade-offs you chose on purpose rather than inherited.",
    modules: [
      {
        id: "architecture-in-the-small",
        title: "Architecture in the small",
        outcome:
          "Keep domain logic free of the framework — repositories, a service layer, a unit of work, events — and know when that separation is worth its cost.",
        items: [
          {
            id: "cosmic-python",
            title: "Architecture Patterns with Python",
            kind: "book",
            url: "https://www.cosmicpython.com/book/preface",
            hint:
              "The one book here that maps straight onto how Robin is already built: a domain module, then HTTP and tool adapters around it.",
          },
          {
            id: "fowler-architecture",
            title: "Martin Fowler — Architecture",
            kind: "docs",
            url: "https://martinfowler.com/architecture/",
            hint: "Short essays. Start with the ones on layering and on evolutionary design.",
          },
          {
            id: "architecture-in-the-small-milestone",
            title: "Build: redraw Robin's job pipeline as ports and adapters",
            kind: "milestone",
            hint:
              "Name every port. Then find the one place a framework type leaks into the domain — there is always one.",
          },
        ],
      },
      {
        id: "distributed-fundamentals",
        title: "Distributed fundamentals",
        outcome:
          "Reason about replication, partitioning, and consistency from first principles instead of quoting CAP.",
        items: [
          {
            id: "ddia",
            title: "Designing Data-Intensive Applications",
            kind: "book",
            url: "https://dataintensive.net/",
            hint:
              "Chapters 1–6 are the spine. Slow reading: one trade-off per chapter, written down in your own words.",
          },
          {
            id: "sre-book",
            title: "Google SRE Book",
            kind: "book",
            url: "https://sre.google/sre-book/table-of-contents/",
            hint: "What running the thing teaches you: SLOs, overload, cascading failure.",
          },
          {
            id: "distributed-fundamentals-milestone",
            title: "Build: reverse-engineer a system you use daily",
            kind: "milestone",
            hint:
              "Write down what it replicates, what it partitions, and which consistency it gives up — with the observation each conclusion came from.",
          },
        ],
      },
      {
        id: "designing-a-system",
        title: "Designing a system end to end",
        outcome:
          "Drive an open-ended design from requirements through estimates, interfaces, and data model to the trade-off you would defend — out loud, in an hour.",
        items: [
          {
            id: "system-design-primer",
            title: "System Design Primer",
            kind: "repo",
            url: "https://github.com/donnemartin/system-design-primer",
            hint: "The index of the whole subject. Use it to find gaps, not as a reading order.",
          },
          {
            id: "system-design-101",
            title: "System Design 101",
            kind: "repo",
            url: "https://github.com/ByteByteGoHq/system-design-101",
            hint: "Diagram-first. Good for checking whether you can redraw a thing from memory.",
          },
          {
            id: "designing-a-system-milestone",
            title: "Build: the design doc for a URL shortener",
            kind: "milestone",
            hint:
              "Requirements, back-of-envelope numbers, API, data model, scaling path — and a section on what you deliberately did not do.",
          },
        ],
      },
      {
        id: "reading-architectures",
        title: "Reading real architectures",
        outcome: "Get oriented in an unfamiliar codebase quickly, and steal what is good in it.",
        items: [
          {
            id: "pocketflow-codebase-knowledge",
            title: "PocketFlow — Codebase Knowledge",
            kind: "repo",
            url: "https://github.com/the-pocket/pocketflow-tutorial-codebase-knowledge",
          },
          {
            id: "repowiki",
            title: "RepoWiki",
            kind: "repo",
            url: "https://github.com/he-yufeng/RepoWiki",
          },
          {
            id: "aider",
            title: "Aider",
            kind: "repo",
            url: "https://github.com/Aider-AI/aider",
          },
          {
            id: "pi-web",
            title: "Pi Web",
            kind: "repo",
            url: "https://github.com/agegr/pi-web",
            hint: "Your own. Read it as though someone else wrote it and you have to extend it Monday.",
          },
          {
            id: "reading-architectures-milestone",
            title: "Build: a one-page architecture note on a repo you did not write",
            kind: "milestone",
            hint:
              "Its boundaries, where its state lives, and the one decision you would have made differently — with the reason.",
          },
        ],
      },
    ],
  },
  {
    id: "projects",
    title: "Project gym",
    outcome: "Turn the reading into things that exist and can be shown to someone.",
    modules: [
      {
        id: "project-sources",
        title: "Where the projects come from",
        outcome: "Always have a next project queued that is one size larger than the last.",
        items: [
          {
            id: "project-based-learning",
            title: "Project Based Learning",
            kind: "repo",
            url: "https://github.com/practical-tutorials/project-based-learning",
          },
          {
            id: "build-your-own-x",
            title: "Build Your Own X",
            kind: "repo",
            url: "https://github.com/codecrafters-io/build-your-own-x",
          },
          {
            id: "project-sources-milestone",
            title: "Build: ship one of them end to end",
            kind: "milestone",
            hint: "Write the README first. If it cannot be described in a paragraph, the scope is wrong.",
          },
        ],
      },
      {
        id: "daily-assistant",
        title: "Daily Assistant",
        outcome: "Keep your own project honest: read it back against what you have since learned.",
        items: [
          {
            id: "daily-assistant-repo",
            title: "Daily Assistant — repository",
            kind: "repo",
            url: "https://github.com/bruceche-cmu-F25/Daily_Asistant/tree/codex/react-fastapi-refactor",
          },
          {
            id: "daily-assistant-learnpage",
            title: "Daily Assistant — LearnPage source",
            kind: "repo",
            url:
              "https://github.com/bruceche-cmu-F25/Daily_Asistant/blob/codex/react-fastapi-refactor/frontend/src/pages/LearnPage.tsx",
          },
          {
            id: "daily-assistant-backend",
            title: "Daily Assistant — backend source",
            kind: "repo",
            url:
              "https://github.com/bruceche-cmu-F25/Daily_Asistant/tree/codex/react-fastapi-refactor/backend/daily_dashboard",
          },
        ],
      },
      {
        id: "ai-tooling",
        title: "AI tooling worth reading",
        outcome: "Know how the agent tools you use are built, so you can bend them rather than wait.",
        items: [
          {
            id: "openworker",
            title: "OpenWorker",
            kind: "repo",
            url: "https://github.com/andrewyng/openworker",
          },
          {
            id: "openwork",
            title: "OpenWork",
            kind: "repo",
            url: "https://github.com/different-ai/openwork",
          },
        ],
      },
    ],
  },
  {
    id: "craft",
    title: "Craft & motion",
    outcome: "Develop taste, and the vocabulary to say why a page feels right instead of only that it does.",
    modules: [
      {
        id: "inspiration",
        title: "Galleries",
        outcome: "Build a reference library you can point at during a design argument.",
        items: [
          { id: "noiced", title: "Noiced", kind: "gallery", url: "https://noiced.com/" },
          { id: "minimum", title: "Minimum", kind: "gallery", url: "https://mnmm.xyz/" },
          { id: "deck-gallery", title: "Deck Gallery", kind: "gallery", url: "https://deck.gallery/" },
          { id: "recent-design", title: "Recent", kind: "gallery", url: "https://recent.design/" },
          { id: "logosystem", title: "Logosystem", kind: "gallery", url: "https://logosystem.co/" },
          {
            id: "wild-craft",
            title: "Wild — Craft, Engineered",
            kind: "gallery",
            url: "https://craft.wild.as/",
          },
          {
            id: "unicorn-studio",
            title: "Unicorn Studio — Inspiration",
            kind: "gallery",
            url: "https://www.unicorn.studio/inspiration",
          },
        ],
      },
      {
        id: "motion-tools",
        title: "Motion and components",
        outcome: "Reach for a motion idea deliberately, and implement it without a library you cannot debug.",
        items: [
          {
            id: "react-bits-dither",
            title: "React Bits — Dither",
            kind: "docs",
            url: "https://reactbits.dev/backgrounds/dither",
          },
          {
            id: "canvas-ui",
            title: "Canvas UI — Components",
            kind: "docs",
            url: "https://canvasui.dev/components",
          },
          { id: "gsap", title: "GSAP", kind: "repo", url: "https://github.com/greensock/gsap" },
          {
            id: "motion-tools-milestone",
            title: "Build: give one page a single motion idea",
            kind: "milestone",
            hint: "One idea, applied consistently, beats five effects. Then remove anything that does not serve it.",
          },
        ],
      },
    ],
  },
];

/* ──────────────────────────── the shelf ──────────────────────────── */

export interface ShelfLink {
  /** Curriculum item id. The shelf never holds a URL the syllabus does not. */
  id: string;
  /**
   * Overrides the item's URL for this appearance only.
   *
   * Exists for one case: a resource that earns a place twice, once whole and
   * once at a section anchor. Without it the shelf would either lose the
   * anchor or need its own copy of the address.
   */
  url?: string;
}

export interface ShelfGroup {
  /** Heading, translated through `learn.shelf.<id>`. */
  id: string;
  links: ShelfLink[];
}

/**
 * The links shelf on the Learning Hub — the original reading list, in the
 * order and the groups it was collected in.
 *
 * A second arrangement of the same resources, and deliberately so. CURRICULUM
 * above orders them for teaching: what has to be understood before what. This
 * orders them the way the person who gathered them thinks about them, which is
 * how you find something again when you already know what you are looking for.
 * Neither ordering is the other's fault, and both stay honest because the
 * items themselves live in exactly one place — a shelf entry is an id, so a
 * moved URL is still a one-line fix.
 *
 * `architecture` is the one group with no counterpart in the original list. It
 * is here because the list had almost nothing on the subject it was gathered
 * to serve; drop the group and the shelf goes back to being silent about it.
 */
export const LEARNING_SHELF: readonly ShelfGroup[] = [
  {
    id: "entry",
    links: [
      { id: "fcc-javascript-v9" },
      { id: "mdn-js-guide" },
      { id: "js-video" },
      { id: "ts-advanced-playlist" },
      { id: "ts-docs" },
    ],
  },
  {
    id: "freecodecamp",
    links: [
      { id: "fcc-frontend-libraries" },
      { id: "fcc-backend-apis" },
      { id: "fcc-relational-database" },
    ],
  },
  {
    id: "python",
    links: [
      { id: "fastapi-tutorial" },
      { id: "pytest-getting-started" },
      { id: "packaging-python" },
      { id: "cosmic-python" },
      { id: "gh-actions-python" },
    ],
  },
  {
    id: "architecture",
    links: [
      { id: "fowler-architecture" },
      { id: "ddia" },
      { id: "sre-book" },
      { id: "system-design-primer" },
      { id: "system-design-101" },
    ],
  },
  {
    id: "projects",
    links: [
      { id: "fullstackopen" },
      { id: "project-based-learning" },
      { id: "openworker" },
      { id: "openwork" },
      { id: "pocketflow-codebase-knowledge" },
      { id: "repowiki" },
      { id: "aider" },
      { id: "pi-web" },
    ],
  },
  {
    id: "design",
    links: [
      { id: "noiced" },
      { id: "minimum" },
      { id: "deck-gallery" },
      { id: "recent-design" },
      { id: "logosystem" },
      { id: "wild-craft" },
      { id: "react-bits-dither" },
      { id: "canvas-ui" },
      { id: "gsap" },
      { id: "unicorn-studio" },
    ],
  },
  {
    id: "gym",
    links: [
      { id: "daily-assistant-repo" },
      { id: "daily-assistant-learnpage" },
      { id: "daily-assistant-backend" },
      {
        id: "project-based-learning",
        url: "https://github.com/practical-tutorials/project-based-learning#python",
      },
      { id: "build-your-own-x" },
    ],
  },
];
