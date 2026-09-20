import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // eslint-config-next ignores `.next/`, but a throwaway preview server builds
  // into `PI_WEB_DIST_DIR` — `.next-preview` by the recipe in next.config.ts.
  // .gitignore already covers `/.next-*/`; match it here so generated output
  // does not drown the report.
  { ignores: [".next-*/"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
