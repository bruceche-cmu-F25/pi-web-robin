/**
 * The reading list on the Learning Hub: fixed reference links, in the groups
 * they were collected in. Every link opens in its own tab — most of these
 * sites refuse to be framed, and a book or a docs site keeps its own history
 * and reading width there anyway.
 *
 * Full Stack Open is not listed part by part: it has its own workspace at
 * /learn/fso, and lecture courses are on the watch list at /learn/watch.
 * Browser-safe: no `node:fs`.
 */
export interface ShelfLink {
  title: string;
  url: string;
  /** Why it is on the shelf; shown on hover. */
  hint?: string;
}

export interface ShelfGroup {
  /** i18n key suffix: `learn.shelf.<id>`. */
  id: string;
  links: readonly ShelfLink[];
}

export const LEARNING_SHELF: readonly ShelfGroup[] = [
  {
    id: "entry",
    links: [
      {
        title: "The Odin Project — Foundations",
        url: "https://www.theodinproject.com/paths/foundations/courses/foundations",
        hint: "Use the Git, HTML/CSS, DOM, and JavaScript sections as the gentle runway into Full Stack Open.",
      },
      {
        title: "freeCodeCamp — JavaScript V9",
        url: "https://www.freecodecamp.org/learn/javascript-v9/",
        hint: "The drilling ground. Use it for weak spots; the certificate is not the point.",
      },
      {
        title: "MDN — JavaScript Guide",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
        hint: "The reference to reach for mid-problem, not another course to finish first.",
      },
      {
        title: "JavaScript walkthrough",
        url: "https://www.youtube.com/watch?v=jS4aFq5-91M",
        hint: "Optional: use the walkthrough when the written explanation is not landing.",
      },
      {
        title: "Advanced TypeScript (playlist)",
        url: "https://www.youtube.com/watch?v=lMfGp29Ht8c&list=PLIvujZeVDLMx040-j1W4WFs1BxuTGdI_b",
        hint: "Deepening material: use it after the basic models in Part 9 compile cleanly.",
      },
      {
        title: "TypeScript Docs",
        url: "https://www.typescriptlang.org/docs/",
        hint: "Reference material after Part 9, not a second prerequisite course.",
      },
    ],
  },
  {
    id: "freecodecamp",
    links: [
      {
        title: "freeCodeCamp — Front End Development Libraries V9",
        url: "https://www.freecodecamp.org/learn/front-end-development-libraries-v9/",
        hint: "Supplement only: use its exercises when React syntax needs more repetitions.",
      },
      {
        title: "freeCodeCamp — Back End Development and APIs",
        url: "https://www.freecodecamp.org/learn/back-end-development-and-apis/",
        hint: "Supplement only: use it when Express and REST need a second explanation.",
      },
      {
        title: "freeCodeCamp — Relational Database",
        url: "https://www.freecodecamp.org/learn/relational-database/",
        hint: "Supplement only: use the exercises when SQL syntax needs more repetitions.",
      },
    ],
  },
  {
    id: "fullstack",
    links: [
      {
        title: "Full Stack Open — course index",
        url: "https://fullstackopen.com/en/",
        hint: "This is the spine. Work through it in the Full Stack Open workspace (/learn/fso), part by part, rather than as one giant final course.",
      },
      {
        title: "CS50 Web — notes and projects",
        url: "https://cs50.harvard.edu/web/",
        hint: "The written side of the lectures on the watch list (/learn/watch). Read a lecture's notes only when the video left a gap; the projects are optional next to Full Stack Open's exercises.",
      },
      {
        title: "Week 1–6/7 — Full-stack notes",
        url: "https://app.notion.com/p/Week-1-till-6-7-374a5189545c80bf8e1bf848a1ecf11c?source=copy_link",
        hint: "Your weekly review of the full-stack architecture, each layer's role, API contracts, databases, deployment, and operations.",
      },
    ],
  },
  {
    id: "roadmaps",
    links: [
      {
        title: "roadmap.sh — Full Stack Developer Roadmap",
        url: "https://roadmap.sh/full-stack",
        hint: "A final gap checklist, never a reading order and never a reason to add every technology it names.",
      },
      {
        title: "roadmap.sh — DevOps Roadmap",
        url: "https://roadmap.sh/devops",
        hint: "Use after operating one deployed application to identify the next production skill worth practicing.",
      },
      {
        title: "roadmap.sh — AI Engineer Roadmap",
        url: "https://roadmap.sh/ai-engineer",
        hint: "Use as a gap checklist after building one end-to-end AI feature with evaluation and failure handling.",
      },
      {
        title: "roadmap.sh — Frontend Developer Roadmap",
        url: "https://roadmap.sh/frontend",
        hint: "Use as a gap checklist after building a working interface, not as a reading order.",
      },
      {
        title: "roadmap.sh — Backend Developer Roadmap",
        url: "https://roadmap.sh/backend",
        hint: "Use as a gap checklist after shipping an API, not as a reason to learn every listed technology.",
      },
      {
        title: "roadmap.sh — System Design Roadmap",
        url: "https://roadmap.sh/system-design",
        hint: "Use as a coverage checklist after practicing complete designs aloud.",
      },
      {
        title: "roadmap.sh — Kubernetes Roadmap",
        url: "https://roadmap.sh/kubernetes",
        hint: "Keep as a later checklist; learn Kubernetes when a real deployment needs orchestration beyond one host.",
      },
    ],
  },
  {
    id: "python",
    links: [
      {
        title: "30 Days of Python — Asabeneh",
        url: "https://github.com/Asabeneh/30-Days-Of-Python",
        hint: "Move at your own pace instead of obeying the 30-day label; write and run code every session, then revisit weak language features.",
      },
      {
        title: "FastAPI Tutorial",
        url: "https://fastapi.tiangolo.com/tutorial/",
        hint: "Learn routing, validation, dependencies, errors, and OpenAPI first; then move the business rule out of the route in your own service.",
      },
      {
        title: "FastAPI Full Stack Template",
        url: "https://github.com/fastapi/full-stack-fastapi-template",
        hint: "Read the structure for boundaries and deployment ideas; do not copy a template before you understand its trade-offs.",
      },
      {
        title: "pytest — Getting Started",
        url: "https://docs.pytest.org/en/stable/getting-started.html",
        hint: "Start with one pure rule and one clear assertion, then use fixtures only where setup is genuinely shared or controls an external boundary.",
      },
      {
        title: "Packaging Python Projects",
        url: "https://packaging.python.org/en/latest/tutorials/packaging-projects/",
        hint: "Follow the official path from `pyproject.toml` through build and TestPyPI, and explain what each generated artifact is for.",
      },
      {
        title: "Architecture Patterns with Python",
        url: "https://www.cosmicpython.com/book/preface",
        hint: "The one book here that maps straight onto how Robin is already built: a domain module, then HTTP and tool adapters around it.",
      },
      {
        title: "GitHub Actions — Build and Test Python",
        url: "https://docs.github.com/en/actions/tutorials/build-and-test-code/python",
        hint: "Turn the local test command into a clean-checkout gate, pin the Python versions you support, and keep failure output visible in the job log.",
      },
    ],
  },
  {
    id: "architecture",
    links: [
      {
        title: "Martin Fowler — Architecture",
        url: "https://martinfowler.com/architecture/",
        hint: "Short essays. Start with the ones on layering and on evolutionary design.",
      },
      {
        title: "Designing Data-Intensive Applications",
        url: "https://dataintensive.net/",
        hint: "Chapters 1–6 are the spine. Slow reading: one trade-off per chapter, written down in your own words.",
      },
      {
        title: "Google SRE Book",
        url: "https://sre.google/sre-book/table-of-contents/",
        hint: "What running the thing teaches you: SLOs, overload, cascading failure.",
      },
      {
        title: "System Design Primer",
        url: "https://github.com/donnemartin/system-design-primer",
        hint: "The index of the whole subject. Use it to find gaps, not as a reading order.",
      },
      {
        title: "System Design 101",
        url: "https://github.com/ByteByteGoHq/system-design-101",
        hint: "Diagram-first. Good for checking whether you can redraw a thing from memory.",
      },
      {
        title: "OWASP Application Security Curriculum (ASC101)",
        url: "https://owasp.org/www-project-application-security-curriculum/",
        hint: "The official starting point. Park until fundamentals are done.",
      },
      {
        title: "OWASP Security Shepherd (hands-on labs)",
        url: "https://vwad.owasp.org/app/security-shepherd/",
        hint: "Optional hands-on; your practice-*靶子 already covers this style, so keep it parked too.",
      },
      {
        title: "Coursera: OWASP Web Application Security",
        url: "https://www.coursera.org/learn/owasp-web-application-security",
        hint: "Needs-assessment style. Promote only if the ASC101 reading was not enough on its own.",
      },
      {
        title: "Getting Started with OpenTelemetry (LFS148)",
        url: "https://training.linuxfoundation.org/training/getting-started-with-opentelemetry-lfs148/",
        hint: "The official, free, ~8–10 hour entry point. Park until you are ready to wire it in.",
      },
      {
        title: "Anthropic — Effective Context Engineering for AI Agents",
        url: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
        hint: "The core argument: context is a curated working set, not maximum token fill.",
      },
      {
        title: "Model Context Protocol specification",
        url: "https://modelcontextprotocol.io/specification/",
        hint: "Read the boundary rule: MCP is an integration boundary, not a data plane.",
      },
      {
        title: "OpenAI Agents SDK — MCP guide",
        url: "https://openai.github.io/openai-agents-python/mcp/",
        hint: "Practical layer. Pair with the spec; do not jump straight into code without it.",
      },
    ],
  },
  {
    id: "projects",
    links: [
      {
        title: "Project Based Learning",
        url: "https://github.com/practical-tutorials/project-based-learning",
        hint: "Choose by the capability you need next, not by novelty; reduce the tutorial to one deployable user flow before writing code.",
      },
      {
        title: "OpenWorker",
        url: "https://github.com/andrewyng/openworker",
        hint: "Read the worker lifecycle first: how work enters, where execution state lives, what tools can do, and how a failed or interrupted run is represented.",
      },
      {
        title: "OpenWork",
        url: "https://github.com/different-ai/openwork",
        hint: "Use it as the product-side comparison: trace how the interface creates, observes, steers, and resumes work rather than cataloging components.",
      },
      {
        title: "PocketFlow — Codebase Knowledge",
        url: "https://github.com/the-pocket/pocketflow-tutorial-codebase-knowledge",
        hint: "Trace how a repository becomes navigable knowledge: ingestion, structure extraction, retrieval, generation, and the points where stale or missing context appears.",
      },
      {
        title: "RepoWiki",
        url: "https://github.com/he-yufeng/RepoWiki",
        hint: "Compare its repository map and generated documentation boundary with PocketFlow; note what it stores, recomputes, and trusts from the model.",
      },
      {
        title: "Aider",
        url: "https://github.com/Aider-AI/aider",
        hint: "Read one mature coding-agent architecture by following command input through repository mapping, model context, edits, Git integration, and error recovery.",
      },
      {
        title: "Pi Web",
        url: "https://github.com/agegr/pi-web",
        hint: "Your own. Read it as though someone else wrote it and you have to extend it Monday.",
      },
    ],
  },
  {
    id: "design",
    links: [
      {
        title: "Noiced",
        url: "https://noiced.com/",
        hint: "Use the curated product work to study full-page hierarchy; save one composition and label its primary action, reading order, and spacing rhythm.",
      },
      {
        title: "Minimum",
        url: "https://mnmm.xyz/",
        hint: "Study restraint: identify what was removed, how contrast replaces decoration, and where the design still provides enough interaction feedback.",
      },
      {
        title: "Deck Gallery",
        url: "https://deck.gallery/",
        hint: "Use slide sequences to practice narrative hierarchy—how one idea is staged, paced, and handed to the next without a permanent navigation shell.",
      },
      {
        title: "Recent",
        url: "https://recent.design/",
        hint: "Use current examples as a trend check, then separate durable information design from treatments likely to date quickly.",
      },
      {
        title: "Logosystem",
        url: "https://logosystem.co/",
        hint: "Study identity as a system: record the rules connecting marks, type, color, spacing, and responsive variations rather than saving one logo.",
      },
      {
        title: "Wild — Craft, Engineered",
        url: "https://craft.wild.as/",
        hint: "Inspect the engineering behind expressive work: identify which effects serve hierarchy and which performance or accessibility fallback keeps them usable.",
      },
      {
        title: "React Bits — Dither",
        url: "https://reactbits.dev/backgrounds/dither",
        hint: "Treat this as an effect study, not a default background: inspect its cost, contrast impact, input behavior, and static fallback before borrowing it.",
      },
      {
        title: "Canvas UI — Components",
        url: "https://canvasui.dev/components",
        hint: "Study how expressive components package state and interaction; reproduce one behavior with your design tokens instead of importing a mismatched visual system.",
      },
      {
        title: "GSAP",
        url: "https://github.com/greensock/gsap",
        hint: "Use the core API for one interruptible timeline; add a plugin only when the interaction specifically needs scroll, drag, SVG, or layout coordination.",
      },
      {
        title: "Unicorn Studio — Inspiration",
        url: "https://www.unicorn.studio/inspiration",
        hint: "Use it for motion references; describe the trigger, spatial relationship, timing, and reduced-motion alternative before choosing an effect.",
      },
    ],
  },
  {
    id: "gym",
    links: [
      {
        title: "Daily Assistant — repository",
        url: "https://github.com/bruceche-cmu-F25/Daily_Asistant/tree/codex/react-fastapi-refactor",
        hint: "Start with the top-level structure and README, identify each deployable boundary, then follow one feature instead of browsing every folder.",
      },
      {
        title: "Daily Assistant — LearnPage source",
        url: "https://github.com/bruceche-cmu-F25/Daily_Asistant/blob/codex/react-fastapi-refactor/frontend/src/pages/LearnPage.tsx",
        hint: "Inventory local, derived, URL, and server state; mark each effect and ask which synchronization responsibility forced it to exist.",
      },
      {
        title: "Daily Assistant — backend source",
        url: "https://github.com/bruceche-cmu-F25/Daily_Asistant/tree/codex/react-fastapi-refactor/backend/daily_dashboard",
        hint: "Trace request validation, business rules, persistence, and error translation; note every place framework or storage details leak inward.",
      },
      {
        title: "Project Based Learning",
        url: "https://github.com/practical-tutorials/project-based-learning#python",
        hint: "Choose by the capability you need next, not by novelty; reduce the tutorial to one deployable user flow before writing code.",
      },
      {
        title: "Build Your Own X",
        url: "https://github.com/codecrafters-io/build-your-own-x",
        hint: "Use this when you need to understand an abstraction from the inside; pick one system, define the smallest faithful version, and document what you omitted.",
      },
    ],
  },
];
