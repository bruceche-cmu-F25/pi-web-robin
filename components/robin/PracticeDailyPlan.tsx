"use client";

import { useI18n } from "@/hooks/useI18n";
import { type CatalogProblem, type PracticeList, type dailyPracticePlan } from "@/extension/robin/practice";
import { practiceHref } from "@/extension/robin/learning";

export function PracticeDailyPlan({ plan, list, onSelect }: {
  plan: ReturnType<typeof dailyPracticePlan>;
  list: PracticeList;
  onSelect?: (problem: CatalogProblem) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="flex min-w-0 flex-col gap-2 text-xs" aria-label={t("coding.plan.title")}>
      <h4 className="pi-eyebrow">{t("coding.plan.title")} · {plan.today}</h4>
      <p aria-live="polite" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {t("coding.plan.done", { fresh: plan.newDone, newTarget: plan.newTarget, review: plan.reviewDone, reviewTarget: plan.reviewTarget })}
      </p>
      <ul className="flex flex-col">
        {([ ["new", plan.newProblems], ["review", plan.reviews] ] as const).flatMap(([kind, problems]) =>
          problems.map((problem) => (
            <li key={problem.link} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0" style={{ color: "var(--text-muted)" }}>{t(`coding.plan.${kind}`)}</span>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(problem)} className="ui-action min-h-11 min-w-0 text-left" style={{ overflowWrap: "anywhere" }}>
                  {problem.problem}
                </button>
              ) : (
                <a href={practiceHref(problem.link, list)} className="ui-action flex min-h-11 min-w-0 items-center" style={{ overflowWrap: "anywhere" }}>
                  {problem.problem} →
                </a>
              )}
            </li>
          )),
        )}
      </ul>
      {plan.newProblems.length === 0 && plan.reviews.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>{t("coding.plan.clear")}</p>
      )}
      {plan.dueCount > plan.reviews.length && (
        <p style={{ color: "var(--text-muted)" }}>{t("coding.plan.backlog", { count: plan.dueCount - plan.reviews.length })}</p>
      )}
      {plan.dueCount === 0 && (
        <p style={{ color: "var(--text-muted)" }}>
          {plan.nextReviewOn ? t("coding.plan.nextReview", { date: plan.nextReviewOn }) : t("coding.plan.noReviews")}
        </p>
      )}
      <details>
        <summary className="ui-action flex min-h-11 cursor-pointer items-center">{t("coding.plan.rulesTitle")}</summary>
        <p className="leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("coding.plan.rules")}</p>
      </details>
    </section>
  );
}
