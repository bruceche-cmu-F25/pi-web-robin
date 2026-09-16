/** Deterministic async-hook checks without a DOM; browser checks cover React rendering. */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

export function hookHarness(file, imports = {}, globals = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const slot = (init) => slots[cursor++] ?? (slots[cursor - 1] = init());
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const state = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [state.value, (value) => { state.value = typeof value === "function" ? value(state.value) : value; }];
    },
    useRef: (current) => slot(() => ({ current })),
    useCallback(fn, deps) {
      const state = slot(() => ({}));
      if (changed(state.deps, deps)) Object.assign(state, { value: fn, deps });
      return state.value;
    },
    useMemo(fn, deps) {
      const state = slot(() => ({}));
      if (changed(state.deps, deps)) Object.assign(state, { value: fn(), deps });
      return state.value;
    },
    useEffect(fn, deps) {
      const state = slot(() => ({}));
      if (changed(state.deps, deps)) {
        effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
        state.deps = deps;
      }
    },
    useImperativeHandle(ref, fn) { ref.current = fn(); },
    forwardRef: (fn) => fn,
  };
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {}, AbortController, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
    ...globals,
  };
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  runInNewContext(outputText, context, { filename: file.pathname });
  return {
    exports: context.exports,
    render(fn) {
      cursor = 0;
      const result = fn();
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
      return result;
    },
    unmount() { for (const state of slots) state.cleanup?.(); },
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}
