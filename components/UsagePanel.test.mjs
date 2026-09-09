import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { UsageBar } = await jiti.import("./UsagePanel.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { getLocalePlugin, getSupportedLocales } = await jiti.import("@/lib/i18n/registry");
const { translateMessage } = await jiti.import("@/lib/i18n/format");
const now = Date.parse("2026-09-06T10:00:00Z");

function render(resetAt) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(UsageBar, { window: { label: "5 hours", usedPercent: 32, resetAt }, now }),
  ));
}

test("quota bars show the exact local reset time and localized remaining time", () => {
  const reset = new Date(now + 7_200_000);
  const html = render(reset.getTime());
  assert.match(html, /32% used · 68% remaining/);
  assert.ok(html.includes(`dateTime="${reset.toISOString()}"`));
  assert.ok(html.includes(reset.toLocaleString("en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  })));
  assert.match(html, /in 2 hours/);
  assert.doesNotMatch(html, /models\.usage/);
});

test("unknown or invalid reset times are explicit; elapsed times do not claim renewed quota", () => {
  for (const resetAt of [undefined, null, NaN, Infinity]) {
    assert.match(render(resetAt), /Provider did not report a reset time/);
  }
  const html = render(now - 60_000);
  assert.match(html, /Reset time passed; refresh to check/);
  assert.match(html, /32% used/);
});

test("every Usage panel translation exists in all supported languages and interpolates times", async () => {
  const source = await readFile(new URL("./UsagePanel.tsx", import.meta.url), "utf8");
  for (const locale of getSupportedLocales()) {
    const messages = getLocalePlugin(locale).messages;
    for (const [, key] of source.matchAll(/t\("(models\.usage\w*)"/g)) {
      assert.ok(messages[key], `${locale}: ${key}`);
    }
    const reset = translateMessage(locale, "models.usageResets", { [locale]: messages }, { time: "12:00" });
    assert.ok(reset.includes("12:00"));
    assert.ok(!reset.includes("{time}"));
  }
});
