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

export interface CurriculumModuleGuide {
  /** The idea before the vocabulary: one short paragraph in ordinary language. */
  plainLanguage: string;
  prerequisites: string;
  applicationRole: string;
  jobRelevance: string;
  /** The one resource to use before reaching for supplements. */
  minimumItemId: string;
  smallExercise: string;
  exitCriteria: string;
}

export interface CurriculumModule {
  id: string;
  title: string;
  /** What you can do once this module is behind you. Written as a capability, not a topic. */
  outcome: string;
  /** Present on the fixed path; reference-only modules do not pretend to be units. */
  guide?: CurriculumModuleGuide;
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
    title: "Get ready for full-stack work",
    outcome:
      "Read and change everyday JavaScript, use Git without losing work, and use browser DevTools to explain what a page is doing.",
    modules: [
      {
        id: "js-core",
        title: "Build the JavaScript base",
        outcome:
          "Write small programs without fighting the language, follow asynchronous code, and inspect a page before guessing what broke.",
        guide: {
          plainLanguage:
            "JavaScript is the language every later browser and Node.js lesson assumes. This unit makes functions, objects, closures, and async behavior familiar enough that framework syntax is no longer the main difficulty.",
          prerequisites: "Basic computer use and enough Git to save and restore your work.",
          applicationRole:
            "This is the language layer shared by the browser UI and the Node.js server used later in the path.",
          jobRelevance:
            "Interviews and code reviews use closures, async behavior, objects, and debugging to tell whether you understand JavaScript or only remember framework syntax.",
          minimumItemId: "fcc-javascript-v9",
          smallExercise:
            "Implement debounce, throttle, and an event emitter, then explain where each implementation keeps its state.",
          exitCriteria:
            "Continue when you can explain closures and the event loop, trace async code, and finish small JavaScript exercises without copying a pattern blindly.",
        },
        items: [
          {
            id: "odin-foundations",
            title: "The Odin Project — Foundations",
            kind: "course",
            url: "https://www.theodinproject.com/paths/foundations/courses/foundations",
            hint: "Use the Git, HTML/CSS, DOM, and JavaScript sections as the gentle runway into Full Stack Open.",
          },
          {
            id: "fcc-javascript-v9",
            title: "freeCodeCamp — JavaScript V9",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/javascript-v9/",
            hint: "The drilling ground. Use it for weak spots; the certificate is not the point.",
          },
          {
            id: "mdn-js-guide",
            title: "MDN — JavaScript Guide",
            kind: "docs",
            url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
            hint: "The reference to reach for mid-problem, not another course to finish first.",
          },
          {
            id: "js-video",
            title: "JavaScript walkthrough",
            kind: "video",
            url: "https://www.youtube.com/watch?v=jS4aFq5-91M",
            hint: "Optional: use the walkthrough when the written explanation is not landing.",
          },
          {
            id: "js-core-milestone",
            title: "Build: debounce, throttle, an event emitter",
            kind: "milestone",
            hint:
              "Write all three from scratch, then explain why each one needs a closure and what breaks without it.",
          },
        ],
      },
    ],
  },
  {
    id: "fullstack",
    title: "The web, end to end",
    outcome:
      "Follow one application from the browser to an API and database, then test, secure, ship, and operate it without losing sight of the whole request.",
    modules: [
      {
        id: "web-fundamentals",
        title: "See a web application work",
        outcome:
          "Use the browser Network panel to follow a request and explain what the browser, server, HTTP, HTML, and JavaScript each contribute.",
        guide: {
          plainLanguage:
            "Before choosing a framework, watch a page load. The browser asks for files and data, the server responds, and JavaScript changes what is already on screen. DevTools makes that exchange visible.",
          prerequisites: "Everyday JavaScript, basic HTML, and the ability to open the browser Console and Network panels.",
          applicationRole:
            "This is the whole-system picture that connects browser runtime, HTTP messages, server responses, and rendering.",
          jobRelevance:
            "Debugging interviews and day-to-day full-stack work expect you to trace requests and distinguish browser, network, and server failures.",
          minimumItemId: "fso-part-0",
          smallExercise:
            "Choose one page load, record its requests in DevTools, and draw the browser-server sequence in your own words.",
          exitCriteria:
            "Continue when you can explain a page load from URL to rendered screen and locate a failure in the correct layer.",
        },
        items: [
          {
            id: "fullstackopen",
            title: "Full Stack Open — course index",
            kind: "course",
            url: "https://fullstackopen.com/en/",
            hint: "This is the spine. Follow the selected parts below in order instead of treating it as one giant final course.",
          },
          {
            id: "fso-part-0",
            title: "Full Stack Open — Part 0: Fundamentals of Web apps",
            kind: "course",
            url: "https://fullstackopen.com/en/part0",
            hint: "Start with the Network panel and sequence diagrams: build the whole-system picture before React.",
          },
          {
            id: "web-fundamentals-milestone",
            title: "Build: trace one click through the stack",
            kind: "milestone",
            hint:
              "Choose a button in an app you use, record its requests in DevTools, and draw the browser-server sequence in your own words.",
          },
        ],
      },
      {
        id: "frontend-libraries",
        title: "Build the interface and connect data",
        outcome:
          "Build a React component tree, give each piece of state one clear owner, and fetch and update server data without hiding the request flow.",
        guide: {
          plainLanguage:
            "A page is a tree of components. State is the changing information that redraws that tree. The hard part is not setting state; it is keeping one trustworthy source instead of several copies that drift apart.",
          prerequisites: "Comfort with JavaScript functions, arrays, objects, events, and asynchronous callbacks.",
          applicationRole:
            "This is the browser-side boundary: it turns user actions and server data into a UI without letting components disagree about reality.",
          jobRelevance:
            "Front-end interviews ask about state ownership, rendering, hooks, and shared state because these decisions determine whether a feature stays understandable as it grows.",
          minimumItemId: "fso-part-1",
          smallExercise:
            "Build a filterable list, then remove one duplicated piece of state so the filtered result is derived from a single source.",
          exitCriteria:
            "Continue when you can draw a component tree, point to the owner of every state value, and explain why derived data is not separate state.",
        },
        items: [
          {
            id: "fso-part-1",
            title: "Full Stack Open — Part 1: Introduction to React",
            kind: "course",
            url: "https://fullstackopen.com/en/part1",
          },
          {
            id: "fso-part-2",
            title: "Full Stack Open — Part 2: Communicating with server",
            kind: "course",
            url: "https://fullstackopen.com/en/part2",
          },
          {
            id: "fcc-frontend-libraries",
            title: "freeCodeCamp — Front End Development Libraries V9",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/front-end-development-libraries-v9/",
            hint: "Supplement only: use its exercises when React syntax needs more repetitions.",
          },
          {
            id: "frontend-libraries-milestone",
            title: "Build: rebuild one panel of this dashboard",
            kind: "milestone",
            hint:
              "Pick a panel you use daily, rebuild it, and justify whether each state belongs on the server, in the URL, or in a component.",
          },
        ],
      },
      {
        id: "backend-apis",
        title: "Move the logic behind an API",
        outcome:
          "Build a Node and Express service whose routes validate input, return useful errors, and make the browser-server boundary explicit.",
        guide: {
          plainLanguage:
            "The server receives an HTTP message, checks whether it is valid and allowed, runs a business rule, talks to storage, and turns the result into a response. Mixing those jobs into one route makes every change dangerous.",
          prerequisites: "HTTP requests and responses, JavaScript async code, and basic Node.js module use.",
          applicationRole:
            "This is where the application decides what is allowed to happen, independent of how the browser drew the button or how the database stores the result.",
          jobRelevance:
            "Backend interviews test validation, error handling, service boundaries, and failure modes because production code spends as much time rejecting bad work as accepting good work.",
          minimumItemId: "fso-part-3",
          smallExercise:
            "Add one create endpoint with validation and three explicit failures, then write the response the client receives for each one.",
          exitCriteria:
            "Continue when a route is thin, business rules can be tested without HTTP, and every expected failure has an intentional status and message.",
        },
        items: [
          {
            id: "fso-part-3",
            title: "Full Stack Open — Part 3: Node.js and Express",
            kind: "course",
            url: "https://fullstackopen.com/en/part3",
          },
          {
            id: "fcc-backend-apis",
            title: "freeCodeCamp — Back End Development and APIs",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/back-end-development-and-apis/",
            hint: "Supplement only: use it when Express and REST need a second explanation.",
          },
          {
            id: "backend-apis-milestone",
            title: "Build: a service with real failure behaviour",
            kind: "milestone",
            hint:
              "Validate every input and write down each failure mode, its status code, and what the client can do next.",
          },
        ],
      },
      {
        id: "testing-auth",
        title: "Add tests, users, and authentication",
        outcome:
          "Protect routes, test both sides of the application, and explain which failures belong to authentication, authorization, validation, or code.",
        guide: {
          plainLanguage:
            "Authentication answers who you are; authorization answers what you may do. A secure application checks both on the server even when the UI already hid the button.",
          prerequisites: "HTTP headers and cookies or tokens, server validation, and a data model with users and owned records.",
          applicationRole:
            "This boundary sits across the client, API, and database: credentials enter through HTTP, server policy protects actions, and ownership lives in data.",
          jobRelevance:
            "Login flows and access control expose whether a candidate understands trust boundaries rather than treating security as a front-end visibility toggle.",
          minimumItemId: "fso-part-4",
          smallExercise:
            "Protect one write action so an anonymous user gets 401, the wrong user gets 403, and the owner succeeds.",
          exitCriteria:
            "Continue when you can trace login through the stack and explain, with examples, the difference between 401, 403, and invalid input.",
        },
        items: [
          {
            id: "fso-part-4",
            title: "Full Stack Open — Part 4: Testing and user administration",
            kind: "course",
            url: "https://fullstackopen.com/en/part4",
          },
          {
            id: "fso-part-5",
            title: "Full Stack Open — Part 5: Testing React apps and routing",
            kind: "course",
            url: "https://fullstackopen.com/en/part5",
          },
          {
            id: "testing-auth-milestone",
            title: "Build: protect and test one complete user action",
            kind: "milestone",
            hint:
              "Take one write action from UI to database, require login, and leave a test at every boundary where it can fail.",
          },
        ],
      },
      {
        id: "state-engineering",
        title: "Make the front end hold together",
        outcome:
          "Choose local or shared state deliberately, extract a reusable hook, and explain the build and routing machinery around the application.",
        guide: {
          plainLanguage:
            "Once a page grows, state crosses component boundaries and repeated effects become hidden infrastructure. This unit makes those boundaries explicit instead of reaching for global state by reflex.",
          prerequisites: "A working React component tree with local state, effects, forms, and server communication.",
          applicationRole:
            "This is the front-end engineering layer that keeps larger features predictable as components, routes, and data dependencies multiply.",
          jobRelevance:
            "React interviews probe hooks, shared state, rendering, and reuse because most front-end complexity comes from ownership and synchronization rather than JSX.",
          minimumItemId: "fso-part-6",
          smallExercise:
            "Find two sources of truth in one feature, choose one owner, and extract one repeated stateful boundary into a custom hook.",
          exitCriteria:
            "Continue when you can justify local versus shared state, explain a hook's dependency behavior, and remove duplicated state without changing behavior.",
        },
        items: [
          {
            id: "fso-part-6",
            title: "Full Stack Open — Part 6: Advanced state management",
            kind: "course",
            url: "https://fullstackopen.com/en/part6",
          },
          {
            id: "fso-part-7",
            title: "Full Stack Open — Part 7: Hooks and tooling",
            kind: "course",
            url: "https://fullstackopen.com/en/part7",
          },
          {
            id: "state-engineering-milestone",
            title: "Build: remove duplicated state from one feature",
            kind: "milestone",
            hint:
              "Find two sources of truth, choose one owner, extract the repeated boundary into a hook, and explain why the new seam belongs there.",
          },
        ],
      },
      {
        id: "typescript",
        title: "Use TypeScript to rule out wrong states",
        outcome:
          "Model a domain with unions, generics, and narrowing so that an impossible state fails to compile instead of failing in production.",
        guide: {
          plainLanguage:
            "TypeScript is useful when types describe the real states of the application, not when every value is merely annotated. Good types turn impossible combinations into compiler errors.",
          prerequisites: "Comfortable JavaScript plus a real module whose inputs, outputs, and states you already understand.",
          applicationRole:
            "Types document and constrain the contracts inside the UI, across API boundaries, and around domain models.",
          jobRelevance:
            "Teams test narrowing, unions, generics, and API modeling because careless types can hide the same bugs as no types while adding false confidence.",
          minimumItemId: "fso-part-9",
          smallExercise:
            "Take one untyped module, model its states as a discriminated union, and make strict mode pass without any or casts.",
          exitCriteria:
            "Continue when an invalid state fails to compile and you can explain why each union, generic, and narrowing branch exists.",
        },
        items: [
          {
            id: "fso-part-9",
            title: "Full Stack Open — Part 9: TypeScript",
            kind: "course",
            url: "https://fullstackopen.com/en/part9",
          },
          {
            id: "ts-docs",
            title: "TypeScript Docs",
            kind: "docs",
            url: "https://www.typescriptlang.org/docs/",
            hint: "Reference material after Part 9, not a second prerequisite course.",
          },
          {
            id: "ts-advanced-playlist",
            title: "Advanced TypeScript (playlist)",
            kind: "video",
            url: "https://www.youtube.com/watch?v=lMfGp29Ht8c&list=PLIvujZeVDLMx040-j1W4WFs1BxuTGdI_b",
            hint: "Deepening material: use it after the basic models in Part 9 compile cleanly.",
          },
          {
            id: "typescript-milestone",
            title: "Build: type an untyped module end to end",
            kind: "milestone",
            hint:
              "Give a real module discriminated unions and useful generics, then get `strict` passing with no `any` and no casts.",
          },
        ],
      },
      {
        id: "relational-data",
        title: "Design data that stays correct",
        outcome:
          "Turn a domain into tables with keys, constraints, and indexes, then spot the queries that would otherwise become N+1 at scale.",
        guide: {
          plainLanguage:
            "A database is not a JSON drawer. Its schema states what can exist, constraints reject impossible data, queries ask precise questions, and indexes trade write cost and storage for faster reads.",
          prerequisites: "Server-side business rules and enough HTTP knowledge to know which data each request needs.",
          applicationRole:
            "This is the durable memory of the application. The server translates business operations into transactions and queries against it.",
          jobRelevance:
            "Full-stack roles regularly test schema design, joins, indexes, transactions, and N+1 queries because data mistakes survive deployments and become expensive at scale.",
          minimumItemId: "fso-part-13",
          smallExercise:
            "Draw three related tables for one project, add their keys and constraints, then write one join and name the index it needs.",
          exitCriteria:
            "Continue when you can defend the schema, explain every relationship and index, and spot where application code would issue one query per row.",
        },
        items: [
          {
            id: "fso-part-13",
            title: "Full Stack Open — Part 13: Relational databases",
            kind: "course",
            url: "https://fullstackopen.com/en/part13",
          },
          {
            id: "fcc-relational-database",
            title: "freeCodeCamp — Relational Database",
            kind: "course",
            url: "https://www.freecodecamp.org/learn/relational-database/",
            hint: "Supplement only: use the exercises when SQL syntax needs more repetitions.",
          },
          {
            id: "relational-data-milestone",
            title: "Build: the ER diagram for a project you already have",
            kind: "milestone",
            hint:
              "Draw it, name every needed index, and find every place the current code would fire one query per row.",
          },
        ],
      },
      {
        id: "production",
        title: "Ship and operate the application",
        outcome:
          "Run tests from CI, package the application in a container, manage environment configuration, and recover from a failed release.",
        guide: {
          plainLanguage:
            "Shipping is a feedback loop: tests catch known breakage, CI repeats the checks, deployment moves a known artifact, and observability tells you what the real system is doing after release.",
          prerequisites: "A working UI, API, data model, and authenticated user flow worth protecting.",
          applicationRole:
            "This wraps the whole stack. It turns code on one laptop into a service that can be changed, watched, and recovered by someone else.",
          jobRelevance:
            "Employers need engineers who can own a change after merge, so interviews probe testing boundaries, CI/CD, containers, configuration, logs, and rollback decisions.",
          minimumItemId: "fso-part-11",
          smallExercise:
            "Put one repository behind CI, break a test to prove the gate works, deploy it, then perform and document one rollback.",
          exitCriteria:
            "Continue when a clean checkout can pass CI and deploy without hidden local steps, and you can find and reverse a failed release.",
        },
        items: [
          {
            id: "fso-part-11",
            title: "Full Stack Open — Part 11: CI/CD",
            kind: "course",
            url: "https://fullstackopen.com/en/part11",
          },
          {
            id: "fso-part-12",
            title: "Full Stack Open — Part 12: Containers",
            kind: "course",
            url: "https://fullstackopen.com/en/part12",
          },
          {
            id: "full-stack-open-milestone",
            title: "Build: deploy something and roll it back",
            kind: "milestone",
            hint:
              "Use CI and environment config, then deliberately ship a bad version and perform the rollback you claim will work.",
          },
        ],
      },
      {
        id: "security-scale",
        title: "Ask what breaks next",
        outcome:
          "Review an application for security and scaling pressure, then name the first bottleneck and the cheapest defensible response.",
        guide: {
          plainLanguage:
            "Architecture is the set of expensive-to-change decisions. Scale does not mean adding every distributed-systems tool; it means measuring where one design stops working and changing the smallest boundary that buys enough room.",
          prerequisites: "One application built and deployed end to end, including its data model, failures, and operating signals.",
          applicationRole:
            "This is the view above individual layers: boundaries, ownership, data flow, failure propagation, replication, and the cost of changing the system.",
          jobRelevance:
            "System-design interviews test whether you can move from vague requirements to interfaces, data, estimates, failures, and explicit trade-offs without reciting product names.",
          minimumItemId: "cs50w",
          smallExercise:
            "Draw one deployed project, mark every trust and failure boundary, then name the first bottleneck and the evidence that would justify changing it.",
          exitCriteria:
            "You are ready when you can defend one end-to-end design aloud, including what you deliberately did not build and what evidence would change your decision.",
        },
        items: [
          {
            id: "cs50w",
            title: "CS50 Web — selected security and scalability material",
            kind: "course",
            url: "https://cs50.harvard.edu/web/",
            hint: "Use the security and scalability material for a second system view; do not repeat the whole Django course.",
          },
          {
            id: "roadmap-full-stack",
            title: "roadmap.sh — Full Stack Developer Roadmap",
            kind: "docs",
            url: "https://roadmap.sh/full-stack",
            hint: "A final gap checklist, never a reading order and never a reason to add every technology it names.",
          },
          {
            id: "security-scale-milestone",
            title: "Build: a one-page production review",
            kind: "milestone",
            hint:
              "Name the trust boundaries, the first likely bottleneck, the evidence that would confirm it, and the smallest change you would make.",
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
        guide: {
          plainLanguage:
            "Small-scale architecture decides which code owns business meaning and which code merely connects frameworks, databases, and HTTP. The goal is useful separation, not layers for their own sake.",
          prerequisites: "One end-to-end application whose routes, business rules, and persistence code you have already changed.",
          applicationRole:
            "This shapes the boundaries inside one service so domain decisions can survive framework and storage changes.",
          jobRelevance:
            "Design and senior coding interviews look for clear responsibilities, testable seams, and judgment about when abstraction costs more than it saves.",
          minimumItemId: "cosmic-python",
          smallExercise:
            "Redraw one project as domain, application, and adapter boundaries, then identify one framework type leaking inward.",
          exitCriteria:
            "Continue when you can defend each boundary and also name one place where adding another layer would be unnecessary.",
        },
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
        guide: {
          plainLanguage:
            "Once data and work live on several machines, delay and partial failure are normal. Replication, partitioning, and consistency are choices about which guarantees survive those failures.",
          prerequisites: "A deployed service, relational data fundamentals, and comfort reasoning about failures instead of only successful requests.",
          applicationRole:
            "This explains what changes when one database or service is no longer enough and state must cross machine boundaries.",
          jobRelevance:
            "System-design interviews use replication and consistency to test trade-off reasoning, not memorized definitions of CAP.",
          minimumItemId: "ddia",
          smallExercise:
            "Choose a system you use, identify what it replicates and partitions, and infer one consistency trade-off from observed behavior.",
          exitCriteria:
            "Continue when you can reason through one network partition and state which guarantee you keep, which you weaken, and why.",
        },
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
        guide: {
          plainLanguage:
            "A system design is an argument from requirements to decisions. Start with users and load, then choose interfaces, data, boundaries, and a scaling path that solves the stated problem.",
          prerequisites: "Experience building one full stack plus architecture, database, and distributed-systems vocabulary.",
          applicationRole:
            "This combines every layer into one defensible plan before implementation makes the expensive decisions harder to change.",
          jobRelevance:
            "System-design interviews directly measure requirement discovery, estimation, data modeling, interfaces, bottlenecks, and communication under ambiguity.",
          minimumItemId: "system-design-primer",
          smallExercise:
            "Design a URL shortener with requirements, estimates, API, schema, bottleneck, and one deliberately deferred feature.",
          exitCriteria:
            "Continue when you can drive a one-hour design aloud without skipping requirements, numbers, data, failures, or trade-offs.",
        },
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
        guide: {
          plainLanguage:
            "Real codebases reveal the compromises diagrams omit. Reading one means finding entry points, state, boundaries, data flow, and the decisions that make an unfamiliar repository coherent.",
          prerequisites: "Enough implementation and architecture experience to recognize frameworks without mistaking them for the domain.",
          applicationRole:
            "This is how you join an existing team, extend a system safely, and compare textbook patterns with production constraints.",
          jobRelevance:
            "Most jobs involve existing code, so interviews and onboarding reward engineers who can orient quickly and explain a system before changing it.",
          minimumItemId: "pi-web",
          smallExercise:
            "Read one repository you did not write and produce a one-page note on its boundaries, state, request flow, and one disputed decision.",
          exitCriteria:
            "You are ready when another engineer can use your note to find the main flow and you can support each claim with a file or interface.",
        },
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
      {
        id: "appendix-security",
        title: "Appendix: shift-left security (later)",
        outcome:
          "Keep three security resources on the shelf until the main path is done, then run secure coding and threat modeling as deliberate practice — not as the giant 'someday' stack.",
        guide: {
          plainLanguage:
            "Security needs more than a single 'what breaks next' module to do well. These resources stay on the shelf until the fundamentals are mastered, then become a real curriculum on trust boundaries, secure coding, and threat modeling.",
          prerequisites: "The full-stack and architecture spine is behind you; 'Ask what breaks next' has been read and applied once.",
          applicationRole:
            "This appendix is a queue, not the queue. Each item names when it will be promoted from the shelf into a real module.",
          jobRelevance:
            "Senior roles increasingly expect developers to be half-security-engineers; the shift-left emphasis in Andrew Ng's AI Engineering Skills is why this appendix exists.",
          minimumItemId: "owasp-asc",
          smallExercise:
            "Pick one item and state the specific reason it is parked instead of promoted, and what upgrade milestone would justify moving it into the main path.",
          exitCriteria:
            "Continue when you can articulate why security literacy earns a dedicated shelf instead of being smuggled into the general 'breaks next' review.",
        },
        items: [
          {
            id: "owasp-asc",
            title: "OWASP Application Security Curriculum (ASC101)",
            kind: "course",
            url: "https://owasp.org/www-project-application-security-curriculum/",
            hint: "The official starting point. Park until fundamentals are done.",
          },
          {
            id: "security-shepherd",
            title: "OWASP Security Shepherd (hands-on labs)",
            kind: "course",
            url: "https://vwad.owasp.org/app/security-shepherd/",
            hint: "Optional hands-on; your practice-*靶子 already covers this style, so keep it parked too.",
          },
          {
            id: "owasp-web-courses",
            title: "Coursera: OWASP Web Application Security",
            kind: "course",
            url: "https://www.coursera.org/learn/owasp-web-application-security",
            hint: "Needs-assessment style. Promote only if the ASC101 reading was not enough on its own.",
          },
        ],
      },
      {
        id: "appendix-observability",
        title: "Appendix: observability (later)",
        outcome:
          "Keep the OpenTelemetry entry and one upgrade milestone parked: SRE Book already owns the theory, this shelf exists so the hands-on skills stay visible and do not get lost.",
        guide: {
          plainLanguage:
            "SRE Book explains what observability is for. This shelf keeps one concrete entry point — OpenTelemetry's official free course — parked until you want the hands-on instrumentation skill, at which point it is promoted into the architecture track.",
          prerequisites: "You have already shipped at least one thing you could roll back; driven by the 'Ship and operate' milestone.",
          applicationRole:
            "Not a theory problem: a visibility problem. You only earn this by wiring traces/alerts into a project you already own.",
          jobRelevance:
            "Production-readiness interviews increasingly probe instrumentation choices and alert design, not just SLO vocabulary.",
          minimumItemId: "otel-lfs148",
          smallExercise:
            "Write down which milestone trigger would justify moving OTel from this shelf into a main module.",
          exitCriteria:
            "Continue when the SRE Book reading is paired with one real instrumentation-and-alert attempt — then this appendix is ready to be promoted.",
        },
        items: [
          {
            id: "otel-lfs148",
            title: "Getting Started with OpenTelemetry (LFS148)",
            kind: "course",
            url: "https://training.linuxfoundation.org/training/getting-started-with-opentelemetry-lfs148/",
            hint: "The official, free, ~8–10 hour entry point. Park until you are ready to wire it in.",
          },
        ],
      },
      {
        id: "appendix-agent-data",
        title: "Appendix: agent data infrastructure (later)",
        outcome:
          "Find three documents that teach how to build data infrastructure for agents — not just for humans or traditional software — and keep them visible until one project is ready to apply them.",
        guide: {
          plainLanguage:
            "Agents need data chosen for them, not dumped into maximum context. These documents explain why MCP is an integration boundary, how context becomes a curated working set, and how governance still applies. They stay parked until a real project is close enough to apply them.",
          prerequisites: "You have at least one project whose data model and agent surface can be reasoned about; this appendix is the reading list before that session.",
          applicationRole:
            "Andrew Ng's AI Engineering Skills explicitly names this as a rapidly evolving gap: reading agent data infrastructure as first-class work.",
          jobRelevance:
            "Anyone building with coding agents today will be asked how their data context was chosen and governed; this is the area Ng says has no textbook yet.",
          minimumItemId: "anthropic-context-engineering",
          smallExercise:
            "Choose one project, list its current agent data surface, and identify one place where context selection is still accidental rather than curated.",
          exitCriteria:
            "Continue when the documents are queued and the next project's first engineering session includes an explicit note on how its agent context will be chosen.",
        },
        items: [
          {
            id: "anthropic-context-engineering",
            title: "Anthropic — Effective Context Engineering for AI Agents",
            kind: "docs",
            url: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
            hint: "The core argument: context is a curated working set, not maximum token fill.",
          },
          {
            id: "mcp-spec",
            title: "Model Context Protocol specification",
            kind: "docs",
            url: "https://modelcontextprotocol.io/specification/",
            hint: "Read the boundary rule: MCP is an integration boundary, not a data plane.",
          },
          {
            id: "openai-agents-mcp",
            title: "OpenAI Agents SDK — MCP guide",
            kind: "docs",
            url: "https://openai.github.io/openai-agents-python/mcp/",
            hint: "Practical layer. Pair with the spec; do not jump straight into code without it.",
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
        guide: {
          plainLanguage:
            "A project is where separate lessons become one system. Choose something slightly larger than your last build, narrow it to one useful flow, and finish it before adding another technology.",
          prerequisites: "The core browser, UI, HTTP, server, data, authentication, and deployment units.",
          applicationRole:
            "This is the integration proof: one artifact showing that the layers work together and that you can make scope decisions.",
          jobRelevance:
            "A finished project gives interviewers concrete evidence for architecture, debugging, testing, deployment, and ownership questions.",
          minimumItemId: "project-based-learning",
          smallExercise:
            "Write a one-paragraph README for a project, define one end-to-end user flow, and ship that flow before expanding scope.",
          exitCriteria:
            "Continue when the project is deployed, another person can run it from the README, and you can explain every layer and trade-off.",
        },
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

/** One stop on the fixed route shown in the curriculum directory. */
export interface CurriculumPathStep {
  trackId: string;
  moduleId: string;
}

/**
 * The job-focused spine, separate from the catalog that supplies its content.
 *
 * It crosses track boundaries on purpose: projects happen before architecture,
 * while Python and craft remain available without pretending they are required
 * before someone can ship a full-stack application. This is navigation, not
 * progress — the sequence says what depends on what and records nothing.
 */
export const CURRICULUM_PATH: readonly CurriculumPathStep[] = [
  { trackId: "foundations", moduleId: "js-core" },
  { trackId: "fullstack", moduleId: "web-fundamentals" },
  { trackId: "fullstack", moduleId: "frontend-libraries" },
  { trackId: "fullstack", moduleId: "backend-apis" },
  { trackId: "fullstack", moduleId: "testing-auth" },
  { trackId: "fullstack", moduleId: "state-engineering" },
  { trackId: "fullstack", moduleId: "typescript" },
  { trackId: "fullstack", moduleId: "relational-data" },
  { trackId: "fullstack", moduleId: "production" },
  { trackId: "fullstack", moduleId: "security-scale" },
  { trackId: "projects", moduleId: "project-sources" },
  { trackId: "architecture", moduleId: "architecture-in-the-small" },
  { trackId: "architecture", moduleId: "distributed-fundamentals" },
  { trackId: "architecture", moduleId: "designing-a-system" },
  { trackId: "architecture", moduleId: "reading-architectures" },
];

export interface CurriculumOverviewStage extends CurriculumPathStep {
  id: string;
}

/** Eight system questions for the overview page; the detailed path above stays intact. */
export const CURRICULUM_OVERVIEW: readonly CurriculumOverviewStage[] = [
  { id: "browser-runtime", trackId: "foundations", moduleId: "js-core" },
  { id: "page-state", trackId: "fullstack", moduleId: "frontend-libraries" },
  { id: "http", trackId: "fullstack", moduleId: "web-fundamentals" },
  { id: "server", trackId: "fullstack", moduleId: "backend-apis" },
  { id: "data", trackId: "fullstack", moduleId: "relational-data" },
  { id: "auth", trackId: "fullstack", moduleId: "testing-auth" },
  { id: "production", trackId: "fullstack", moduleId: "production" },
  { id: "architecture", trackId: "fullstack", moduleId: "security-scale" },
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
      { id: "odin-foundations" },
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
    id: "fullstack",
    links: [
      { id: "fullstackopen" },
      { id: "fso-part-0" },
      { id: "fso-part-1" },
      { id: "fso-part-2" },
      { id: "fso-part-3" },
      { id: "fso-part-4" },
      { id: "fso-part-5" },
      { id: "fso-part-6" },
      { id: "fso-part-7" },
      { id: "fso-part-9" },
      { id: "fso-part-13" },
      { id: "fso-part-11" },
      { id: "fso-part-12" },
      { id: "cs50w" },
      { id: "roadmap-full-stack" },
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
      { id: "owasp-asc" },
      { id: "security-shepherd" },
      { id: "owasp-web-courses" },
      { id: "otel-lfs148" },
      { id: "anthropic-context-engineering" },
      { id: "mcp-spec" },
      { id: "openai-agents-mcp" },
    ],
  },
  {
    id: "projects",
    links: [
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
