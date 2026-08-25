"use client";

import { useI18n } from "@/hooks/useI18n";
import { CURRICULUM, type CurriculumItem, type CurriculumTrack } from "@/extension/robin/study";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";

interface Props {
  track: CurriculumTrack;
  onTrackChange: (trackId: string) => void;
  /** The item the mentor is anchored to, marked so the two cannot disagree. */
  selected: string | null;
  onOpen: (item: CurriculumItem) => void;
}

/**
 * The syllabus, as the page rather than as a rail beside one.
 *
 * This used to be a 288px rail feeding an iframe, and the iframe was empty
 * more often than not: two thirds of the catalog is either a milestone or a
 * site that refuses to be framed, so the widest column on the screen was
 * usually holding a sentence apologising for being blank. Reading is not
 * LeetCode — there is no editor to sit beside, and a tutorial is better in a
 * real tab with its own history, scroll position and width than in a letterbox
 * we control. So the workspace stops pretending to be a reader and becomes
 * what it always actually was: a way in.
 *
 * Ordered is still the whole point. A bookmark folder is a pile of good
 * intentions; what turns the same links into a roadmap is that each module
 * states the capability it is for, which is why the outcome sits above the
 * links it justifies rather than behind a tooltip.
 *
 * What it deliberately does not show is how much of it you have done. There
 * are no ticks, no counts, and no ordering by what is left: this is a map, and
 * a map that grades you for the roads you have not driven is doing something
 * other than showing you where things are.
 */
export function SyllabusBoard({ track, onTrackChange, selected, onOpen }: Props) {
  const { t } = useI18n();

  return (
    <section className="flex min-w-0 flex-1 flex-col" style={{ minHeight: 0 }}>
      <header
        className="flex flex-col gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {CURRICULUM.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onTrackChange(candidate.id)}
              className="ui-action pi-chrome-label pi-bracket"
              data-state={candidate.id === track.id ? "accent" : undefined}
              style={{ fontSize: 10 }}
              title={candidate.title}
            >
              {t(`coding.trackName.${candidate.id}`)}
            </button>
          ))}
        </div>
        {/* The track's own sentence, in the catalog's language: this is content,
            not chrome, and translating it would mean maintaining a second
            syllabus that could drift from the first. */}
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: "80ch" }}>
          {track.outcome}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <div
          className="grid gap-4 p-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}
        >
          {track.modules.map((module, moduleIndex) => {
            // The same positional rotation as the shelf: each card takes one of
            // the calendar's six hues so neighbours stay distinct, and the hue
            // is recognition, not meaning — it is by position, not by id.
            const hue = EVENT_COLOR_KEYS[moduleIndex % EVENT_COLOR_KEYS.length];
            return (
              <section key={module.id} className="pi-card flex flex-col gap-2 p-4">
                <h2
                  className="pi-label"
                  style={{
                    fontSize: 11,
                    color: `var(--todo-${hue})`,
                    borderLeftColor: `var(--event-${hue})`,
                  }}
                >
                  {module.title}
                </h2>
                <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
                  {module.outcome}
                </p>
                <ul className="flex flex-col">
                  {module.items.map((item) => (
                    <li key={item.id}>
                      <ItemRow
                        item={item}
                        active={selected === item.id}
                        onOpen={() => onOpen(item)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * One resource, or one milestone.
 *
 * A resource is an anchor and nothing cleverer: the browser opens the tab, and
 * the click is recorded on the way past so the mentor knows what "this page"
 * means. Deliberately not `window.open` after an await — that is the shape
 * that gets caught by a popup blocker, and it would put a network round trip
 * between the click and the tab.
 *
 * A milestone is not a link because it is not a page. It is still clickable,
 * so the mentor can be pointed at what you are building.
 */
function ItemRow({
  item,
  active,
  onOpen,
}: {
  item: CurriculumItem;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const milestone = item.kind === "milestone";
  const href = milestone ? null : item.url;

  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1" style={{ fontSize: 12.5, lineHeight: 1.35 }}>
          {item.title}
        </span>
        <span
          className="pi-eyebrow shrink-0"
          style={{
            fontSize: 9,
            color: milestone ? "var(--accent-amber)" : "var(--text-dim)",
          }}
        >
          {milestone ? t("coding.study.milestoneMark") : t(`coding.kind.${item.kind}`)}
        </span>
      </span>
      {/* Why it is on the list. It was a tooltip when this was a 288px rail;
          in a column this wide it can just be said, and it is the line that
          decides whether a link gets opened or scrolled past. */}
      {item.hint ? (
        <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
          {item.hint}
        </span>
      ) : null}
    </>
  );

  const style = {
    color: active ? "var(--accent)" : "var(--text)",
    borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
    textDecoration: "none",
  };

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className="ui-action flex w-full flex-col gap-0.5 py-1.5 pl-2 pr-1 text-left"
      style={style}
      aria-current={active ? "true" : undefined}
    >
      {body}
    </a>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      className="ui-action flex w-full flex-col gap-0.5 py-1.5 pl-2 pr-1 text-left"
      style={style}
      aria-current={active ? "true" : undefined}
    >
      {body}
    </button>
  );
}
