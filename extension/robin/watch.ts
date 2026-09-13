/**
 * The watch list: lecture courses to watch when reading is not landing.
 *
 * A companion to Full Stack Open, not a second queue. Each course is a list of
 * lectures you tick off yourself; opening a video never marks it watched, the
 * same rule as the course steps. Net Ninja is tracked per series rather than
 * per ten-minute episode, which would bury the list in rows.
 *
 * Video ids and lengths were read from the official playlists on 2026-09-11.
 * A lecture links into its playlist so YouTube plays the next one after it.
 * Browser-safe: no `node:fs`.
 */
export interface WatchItem {
  /** YouTube video id, or playlist id for a series. The progress key. */
  id: string;
  title: string;
  minutes: number;
  /** A series: how many episodes the one row stands for. */
  episodes?: number;
  /** A series: its first episode, whose thumbnail stands for the series. */
  cover?: string;
  /** The Full Stack Open part it lines up with, when it clearly does. */
  fso?: string;
  optional?: boolean;
}

export interface WatchCourse {
  /** i18n key suffix: `watch.course.<id>.*`. */
  id: string;
  title: string;
  playlist?: string;
  /** Series rows each link to their own playlist instead of one shared one. */
  series?: boolean;
  links: readonly { label: string; url: string }[];
  items: readonly WatchItem[];
}

export const WATCH_COURSES: readonly WatchCourse[] = [
  {
    id: "cs50w",
    title: "CS50 Web Programming",
    playlist: "PLhQjrBD2T380xvFSUmToMMzERZ3qB5Ueu",
    links: [{ label: "cs50.harvard.edu/web", url: "https://cs50.harvard.edu/web/" }],
    items: [
      { id: "zFZrkCIc2Oc", title: "Lecture 0 — HTML and CSS", minutes: 124, fso: "P0" },
      { id: "NcoBAfJ6l2Q", title: "Lecture 1 — Git", minutes: 53 },
      { id: "EOLPQdVj5Ac", title: "Lecture 2 — Python", minutes: 68, optional: true },
      { id: "w8q0C-C1js4", title: "Lecture 3 — Django", minutes: 99, optional: true },
      { id: "YzP164YANAU", title: "Lecture 4 — SQL, Models and Migrations", minutes: 114, fso: "P13" },
      { id: "x5trGVMKTdY", title: "Lecture 5 — JavaScript", minutes: 111, fso: "P1" },
      { id: "jrBhi8wbzPw", title: "Lecture 6 — User Interfaces", minutes: 100, fso: "P1–2" },
      { id: "WbRDkJ4lPdY", title: "Lecture 7 — Testing and CI/CD", minutes: 94, fso: "P5 · P11" },
      { id: "6PWTxRGh_dk", title: "Lecture 8 — Scalability and Security", minutes: 88, fso: "P4" },
    ],
  },
  {
    id: "netninja",
    title: "Net Ninja",
    series: true,
    links: [{ label: "youtube.com/@NetNinja", url: "https://www.youtube.com/@NetNinja/playlists" }],
    items: [
      { id: "PL4cUxeGkcC9gZD-Tvwfod2gaISzfRiP9d", cover: "j942wKiXFu8", title: "Full Modern React Tutorial", minutes: 193, episodes: 32, fso: "P1–2" },
      { id: "PL4cUxeGkcC9jsz4LDYc6kv3ymONOKxwBU", cover: "zb3Qk8SG5Ms", title: "Node.js Crash Course", minutes: 284, episodes: 12, fso: "P3" },
      { id: "PL4cUxeGkcC9h77dJ-QJlwGlZlTd4ecZOA", cover: "ExcRbA7fy_A", title: "Complete MongoDB Tutorial", minutes: 173, episodes: 25, fso: "P3" },
      { id: "PL4cUxeGkcC9iyuClsf48SSgsJPBStHo7F", cover: "XdDZKeM5_pQ", title: "Unit Testing (Vitest) Crash Course", minutes: 156, episodes: 14, fso: "P5" },
      { id: "PL4cUxeGkcC9gUxtblNUahcsg0WLxmrK_y", cover: "xMCnDesBggM", title: "GraphQL Crash Course", minutes: 90, episodes: 9, fso: "P8" },
      { id: "PL4cUxeGkcC9gUgr39Q_yD6v-bSyMwKPUI", cover: "2pZmKW9-I_k", title: "TypeScript Tutorial", minutes: 155, episodes: 21, fso: "P9" },
    ],
  },
  {
    id: "missing",
    title: "MIT Missing Semester 2026",
    playlist: "PLyzOVJj3bHQunmnnTXrNbZnBaCA-ieK4L",
    links: [
      { label: "missing.csail.mit.edu", url: "https://missing.csail.mit.edu/2026/" },
      { label: "中文讲义", url: "https://missing-semester-cn.github.io/" },
    ],
    items: [
      { id: "MSgoeuMqUmU", title: "Course Overview + Introduction to the Shell", minutes: 75 },
      { id: "ccBGsPedE9Q", title: "Command-line Environment", minutes: 66 },
      { id: "QnM1nVzrkx8", title: "Development Environment and Tools", minutes: 54 },
      { id: "8VYT9TcUmKs", title: "Debugging and Profiling", minutes: 73 },
      { id: "9K8lB61dl3Y", title: "Version Control and Git", minutes: 70 },
      { id: "KBMiB-8P4Ns", title: "Packaging and Shipping Code", minutes: 64 },
      { id: "sTdz6PZoAnw", title: "Agentic Coding", minutes: 61 },
      { id: "2DOEATfXT8k", title: "Beyond the Code", minutes: 66 },
      { id: "XBiLUNx84CQ", title: "Code Quality", minutes: 75 },
    ],
  },
  {
    id: "cs50sql",
    title: "CS50 SQL",
    playlist: "PLhQjrBD2T382v1MBjNOhPu9SiJ1fsD4C0",
    links: [{ label: "cs50.harvard.edu/sql", url: "https://cs50.harvard.edu/sql/" }],
    items: [
      { id: "vHYeChEf2lA", title: "Lecture 0 — Querying", minutes: 79, fso: "P13" },
      { id: "_2t18Hy9Z0Y", title: "Lecture 1 — Relating", minutes: 102, fso: "P13" },
      { id: "QzRW6bfv3Fo", title: "Lecture 2 — Designing", minutes: 81, fso: "P13" },
      { id: "BD08USRd2M8", title: "Lecture 3 — Writing", minutes: 103, fso: "P13" },
      { id: "jZwGVuA8PMI", title: "Lecture 4 — Viewing", minutes: 82, fso: "P13" },
      { id: "qa5-mKVSQHQ", title: "Lecture 5 — Optimizing", minutes: 89, fso: "P13" },
      { id: "jXbXGkgT2Xg", title: "Lecture 6 — Scaling", minutes: 129, fso: "P13" },
    ],
  },
  {
    id: "cs50x",
    title: "CS50x",
    playlist: "PLhQjrBD2T380hlTqAU8HfvVepCcjCqTg6",
    links: [{ label: "cs50.harvard.edu/x", url: "https://cs50.harvard.edu/x/" }],
    items: [
      { id: "UuIEbpQms8o", title: "Lecture 0 — Scratch", minutes: 121 },
      { id: "SlqjA04_dpk", title: "Lecture 1 — C", minutes: 150 },
      { id: "h5Gc1n8ZuU8", title: "Lecture 2 — Arrays", minutes: 146 },
      { id: "6Svu_ae5ebk", title: "Lecture 3 — Algorithms", minutes: 120 },
      { id: "db0H0U13YsA", title: "Lecture 4 — Memory", minutes: 140 },
      { id: "PmAI76OGE_E", title: "Lecture 5 — Data Structures", minutes: 124 },
      { id: "Rl0ludWTLxs", title: "Lecture 6 — Python", minutes: 150 },
      { id: "oqRU2So6Z2Y", title: "Lecture 7 — SQL", minutes: 136 },
      { id: "-9bo8HlSxwQ", title: "Artificial Intelligence", minutes: 48 },
      { id: "yYst7puZXjw", title: "Lecture 8 — HTML, CSS, JavaScript", minutes: 142 },
      { id: "am7POvSZ4GE", title: "Lecture 9 — Flask", minutes: 147 },
      { id: "ApQTgFkf8TU", title: "Lecture 10 — The End", minutes: 52 },
    ],
  },
];

/** Channels to put on without a plan; nothing to tick off. */
export const WATCH_CHANNELS: readonly { id: string; title: string; url: string }[] = [
  { id: "hnasr", title: "Hussein Nasser", url: "https://www.youtube.com/@hnasr" },
  { id: "bytebytego", title: "ByteByteGo", url: "https://www.youtube.com/@ByteByteGo" },
];

export const WATCH_ITEM_IDS: ReadonlySet<string> = new Set(
  WATCH_COURSES.flatMap((course) => course.items.map((item) => item.id)),
);

/** YouTube's own still for the lecture, the same source the podcast shelf uses. */
export function watchThumbnail(item: WatchItem, size: "mqdefault" | "hqdefault" = "mqdefault"): string {
  return `https://i.ytimg.com/vi/${item.cover ?? item.id}/${size}.jpg`;
}

export function watchUrl(course: WatchCourse, item: WatchItem): string {
  if (course.series) return `https://www.youtube.com/playlist?list=${item.id}`;
  return `https://www.youtube.com/watch?v=${item.id}${course.playlist ? `&list=${course.playlist}` : ""}`;
}

/**
 * Per-course progress, the next lecture in each, and where to pick up.
 *
 * "Next" skips optional lectures, so a skipped Django week never becomes the
 * thing the page asks you to watch. "Up next" is the next lecture of the
 * course you last ticked something in — the one you were in the middle of —
 * or, when there is none, the first course with a lecture left.
 */
export function watchPlan(watchedIds: readonly string[]) {
  const watched = new Set(watchedIds.filter((id) => WATCH_ITEM_IDS.has(id)));
  const courses = WATCH_COURSES.map((course) => {
    const next = course.items.find((item) => !item.optional && !watched.has(item.id)) ?? null;
    return {
      id: course.id,
      watched: course.items.filter((item) => watched.has(item.id)).length,
      total: course.items.length,
      nextId: next?.id ?? null,
    };
  });
  const lastId = [...watchedIds].reverse().find((id) => watched.has(id));
  const lastCourse = lastId ? WATCH_COURSES.find((course) => course.items.some((item) => item.id === lastId)) : undefined;
  const upNext = courses.find((course) => course.id === lastCourse?.id && course.nextId)
    ?? courses.find((course) => course.nextId);
  return {
    watchedIds: [...watched],
    watched: watched.size,
    total: WATCH_ITEM_IDS.size,
    courses,
    upNext: upNext ? { courseId: upNext.id, itemId: upNext.nextId! } : null,
  };
}

export type WatchPlan = ReturnType<typeof watchPlan>;
