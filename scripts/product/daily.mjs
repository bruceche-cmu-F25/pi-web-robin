// macOS launchd entry point. Works even when pi-web is not open.
import { updateDailyOpportunities } from "../../extension/robin/product-opportunities.ts";
import { localDate } from "../../extension/robin/dates.ts";

const result = await updateDailyOpportunities();
const today = localDate();
const added = result.opportunities.filter((item) => item.discoveredOn === today).length;
console.log(`${new Date().toISOString()} | ${added} added today | ${result.opportunities.length} total${result.error ? ` | ${result.error}` : ""}`);
if (!result.checkedAt || localDate(new Date(result.checkedAt)) !== today) process.exitCode = 1;
