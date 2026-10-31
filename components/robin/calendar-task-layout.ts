import type { Todo } from "../../extension/robin/todo-domain.ts";
import { layoutSpanBars } from "../../extension/robin/layout.ts";

/** Keep ranges continuous. A hidden range counts once on each day it actually covers. */
export function calendarTaskPreview(todos: readonly Todo[], days: string[]) {
  const ranges = todos.flatMap((todo) => !todo.done && !todo.archivedAt && todo.due
    ? [{ ...todo, date: todo.startDate ?? todo.due, endDate: todo.due }] : []);
  const { bars } = layoutSpanBars(ranges, days);
  const visible = bars.filter((bar) => bar.lane < 3);
  return {
    visible,
    total: bars.length,
    days: days.map((date, index) => {
      const active = bars.filter((bar) => bar.startIndex <= index && bar.endIndex >= index);
      return { date, todos: active.map((bar) => bar.event), hidden: active.filter((bar) => bar.lane >= 3).length };
    }),
  };
}
