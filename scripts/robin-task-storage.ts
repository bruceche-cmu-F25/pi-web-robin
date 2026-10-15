/** Run with npm run robin:storage -- <command>. No live services are stopped here. */
import { checkTaskStorage, exportTaskSnapshot, migrateTasksToSqlite } from "../extension/robin/task-migration.ts";

const [command, argument, ...extra] = process.argv.slice(2);
try {
  if (extra.length) throw new Error("Too many arguments");
  let result;
  if (command === "check" && argument === undefined) {
    result = checkTaskStorage();
  } else if (command === "migrate" && argument === "--writers-stopped") {
    result = migrateTasksToSqlite();
  } else if (command === "export" && argument && !argument.startsWith("--")) {
    result = exportTaskSnapshot(argument);
  } else {
    throw new Error("Usage: npm run robin:storage -- check | migrate --writers-stopped | export <new-directory>\nSet ROBIN_DATA_DIR for a non-default store. Stop Web, Pi, Telegram and scheduled writers BEFORE migrate; --writers-stopped only acknowledges that you did so.");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
