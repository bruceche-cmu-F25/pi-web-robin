/** Versioned collection catalogue for Robin's explicit SQLite migration.
 * Historical task-* names / tasks.sqlite are retained so phase-1 installs upgrade
 * in place rather than accidentally opening a second source of truth.
 */
import { RUNTIME_STATE_FILES, RUNTIME_STATE_VERSION } from "./runtime-state-schema.ts";

export const TASK_SCHEMA_VERSION = 3;
export const TASK_TABLES = ["todos", "rounds", "events", "links", "jobs", "tech_events", "runtime_state"] as const;
export type TaskTable = (typeof TASK_TABLES)[number];

interface Collection {
  since: number;
  /** null: one row per registered object file, not a legacy collection array. */
  file: string | null;
  requiredStrings: readonly string[];
  optionalStrings: readonly string[];
  check?: string;
}
export const TASK_COLLECTIONS: Record<TaskTable, Collection> = {
  todos: {
    since: 1, file: "todos.json", requiredStrings: ["title", "createdAt"],
    optionalStrings: ["startDate", "due", "plannedOn", "reviewAfter", "archivedAt", "color", "url", "completedAt"],
    check: "json_type(payload, '$.done') IN ('true', 'false')",
  },
  rounds: {
    since: 1, file: "rounds.json", requiredStrings: ["company", "createdAt", "updatedAt"],
    optionalStrings: ["role", "due", "detail", "threadId", "todoId", "closedAt"],
    check: "json_extract(payload, '$.kind') IN ('oa', 'interview') AND json_extract(payload, '$.status') IN ('open', 'done', 'missed', 'cancelled')",
  },
  events: {
    since: 2, file: "events.json", requiredStrings: ["title", "date", "createdAt"],
    optionalStrings: ["endDate", "start", "end", "location", "description", "url", "meetingUrl", "organizer"],
  },
  links: {
    since: 2, file: "links.json", requiredStrings: ["title", "url", "createdAt"],
    optionalStrings: ["group", "icon", "iconCheckedAt"],
  },
  jobs: {
    since: 2, file: "jobs.json", requiredStrings: ["title", "company", "url", "location", "source", "discoveredAt"],
    optionalStrings: ["postedAt", "description", "reason", "scoredAt", "scoredBy", "scoreContext", "appliedAt", "note", "notifiedAt"],
    check: "json_extract(payload, '$.status') IN ('new', 'shortlist', 'applied', 'dropped')",
  },
  tech_events: {
    since: 2, file: "tech-events.json", requiredStrings: ["title", "url", "source", "startAt", "discoveredAt"],
    optionalStrings: ["host", "endAt", "timezone", "city", "venue", "coverUrl"],
  },
  runtime_state: {
    since: RUNTIME_STATE_VERSION, file: null, requiredStrings: [], optionalStrings: [],
    check: `json_type(payload, '$.value') = 'object' AND id IN (${RUNTIME_STATE_FILES.map((file) => `'${file}'`).join(", ")})`,
  },
};

export function taskTableName(table: TaskTable): TaskTable {
  if (!TASK_TABLES.includes(table)) throw new Error("Unknown task table");
  return table;
}

export function tablesAtVersion(version: number): TaskTable[] {
  return TASK_TABLES.filter((table) => TASK_COLLECTIONS[table].since <= version);
}

/** Original JSON files for the named collections, including sparse object rows. */
export function taskSourceFiles(tables: readonly TaskTable[]): string[] {
  return tables.flatMap((table) => TASK_COLLECTIONS[table].file ?? [...RUNTIME_STATE_FILES]);
}

/** Only creates newly introduced tables. Never rewrites already migrated rows. */
export function taskSchemaSql(fromVersion = 0, toVersion = TASK_SCHEMA_VERSION): string {
  const collections = TASK_TABLES.filter((table) => TASK_COLLECTIONS[table].since > fromVersion && TASK_COLLECTIONS[table].since <= toVersion);
  const statements = collections.map((table) => {
    const definition = TASK_COLLECTIONS[table];
    const checks = [
      "json_valid(payload) AND json_type(payload) = 'object'",
      "length(id) > 0 AND json_type(payload, '$.id') = 'text' AND json_extract(payload, '$.id') = id",
      ...definition.requiredStrings.map((field) => `json_type(payload, '$.${field}') = 'text'`),
      ...(definition.check ? [definition.check] : []),
    ];
    return `CREATE TABLE ${table} (
      id TEXT PRIMARY KEY NOT NULL,
      position INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK (COALESCE(${checks.join(" AND ")}, 0))
    ) STRICT;
    CREATE INDEX ${table}_position ON ${table}(position);`;
  });
  if (fromVersion < 2 && toVersion >= 2) {
    // Committed together with the import. If selector publication is interrupted,
    // the offline migrator can finish it without ever reimporting stale JSON.
    statements.push("CREATE TABLE storage_migrations (version INTEGER PRIMARY KEY, selection TEXT NOT NULL CHECK(json_valid(selection))) STRICT;");
  }
  statements.push(`PRAGMA user_version = ${toVersion};`);
  return statements.join("\n");
}
