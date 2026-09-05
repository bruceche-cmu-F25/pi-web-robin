import type { StepId } from "@/extension/robin/product-playbook";
import type { LibraryCategory } from "@/extension/robin/product-shape";
import type { EventColorKey } from "@/extension/robin/eventColors";

/**
 * Every coloured surface in the product incubator, decided in one place.
 *
 * The rule is the calendar's, and for the same reason — see eventSurface.ts:
 * **colour is an edge, not a fill.** A row keeps the panel's own ground and
 * takes the hue as a spine down its left edge, so a list reads as one material
 * with a colour running through it rather than as competing washes.
 *
 * The palette is the calendar's nine, not a new one. Ideas and calendar series
 * never share a screen, so reusing the slots costs nothing and buys the two
 * surfaces the same colour temperature — which is the point of having a
 * palette at all.
 */

/**
 * The playbook's six steps, coloured so the list reads as a progression.
 *
 * The palette is the calendar's, and the keys have to hold in both themes,
 * which is a check the calendar never makes: it deals its colours in a fixed
 * order and so never picks one by name. The teal slot is unusable here —
 * light #5c8a83 but dark #9488cc, because today already owns teal on the dark
 * canvas — and it is the one key that moves.
 *
 * The order walks the wheel rather than the funnel, so two adjacent steps are
 * never a near-miss: slate → iris → honey → plum → rose → fern. Fern last is
 * meant; it sits beside `--success`, and a thing that reached distribution is
 * a thing that went well.
 */
const STEP_COLORS: Record<StepId, EventColorKey> = {
  spot: "slate",
  research: "iris",
  validate: "honey",
  build: "plum",
  improve: "rose",
  launch: "fern",
};

/** Wide enough to carry a hue at a glance down a column of rows. */
const SPINE_WIDTH = 4;

export interface StepSurface {
  /** The row's left spine. */
  spine: string;
  /** A whisper of the hue, for a row's ground. */
  wash: string;
  /** The hue at strength, for a label or a count. */
  ink: string;
}

/**
 * Parked drops the colour entirely rather than taking one of its own.
 *
 * Colour here encodes being live. Something you set aside should recede, and
 * giving it a hue of its own would make the shelf as loud as the work.
 */
export function stepSurface(step: StepId, parked?: boolean): StepSurface {
  if (parked) {
    return { spine: `${SPINE_WIDTH}px solid var(--border)`, wash: "transparent", ink: "var(--text-dim)" };
  }
  const key = STEP_COLORS[step];
  return {
    spine: `${SPINE_WIDTH}px solid var(--event-${key})`,
    wash: `var(--event-${key}-faint)`,
    ink: `var(--event-${key})`,
  };
}

/**
 * The library's five kinds of resource.
 *
 * This is the one place in the app where the doc's "spot colour marks a kind,
 * never a state" rule applies literally: a row's category is a fixed
 * classification, so it can carry a hue without ever being misread as an
 * alert. Status stays on the semantic tokens, where a reader already knows
 * what red means.
 *
 * The five hues are simply five, far enough apart in both themes to be told
 * at a glance; they no longer echo a pipeline, because there is no longer a
 * pipeline for them to echo.
 */
const CATEGORY_COLORS: Record<LibraryCategory, EventColorKey> = {
  source: "slate",
  test: "honey",
  stack: "plum",
  distribution: "fern",
  tool: "iris",
};

export interface CategoryChip {
  background: string;
  borderColor: string;
  color: string;
}

export function categoryChip(category: LibraryCategory): CategoryChip {
  const key = CATEGORY_COLORS[category];
  return {
    background: `var(--event-${key}-faint)`,
    borderColor: `var(--event-${key}-line)`,
    color: `var(--event-${key})`,
  };
}
