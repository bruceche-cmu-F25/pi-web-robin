import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./PwaRegistration.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

for (const mode of ["development", "production"]) {
  test(`${mode} registers the root worker in place with the correct cache mode`, () => {
    const calls = [];
    const exports = {};
    runInNewContext(outputText, {
      exports,
      require: (name) => {
        assert.equal(name, "react");
        return { useEffect: (effect) => effect() };
      },
      process: { env: { NODE_ENV: mode, NEXT_PUBLIC_APP_VERSION: "test" } },
      document: { readyState: "complete" },
      navigator: {
        serviceWorker: {
          register: async (url, options) => { calls.push({ url, ...options }); },
          getRegistrations: () => assert.fail("must not unregister and lose push subscriptions"),
        },
      },
      console,
    });
    assert.equal(exports.PwaRegistration(), null);
    assert.deepEqual(calls, [{
      url: `/sw.js?v=test${mode === "development" ? "&pushOnly=1" : ""}`,
      scope: "/",
      updateViaCache: "none",
    }]);
  });
}
