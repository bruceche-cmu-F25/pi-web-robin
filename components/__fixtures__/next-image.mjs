import { createElement } from "react";

// Next's compiler supplies the real image wrapper; Node-only render tests need
// only its intrinsic markup, without the framework's CJS default interop.
export default function Image({ priority, fill, unoptimized, ...props }) {
  void priority; void fill; void unoptimized;
  return createElement("img", props);
}
