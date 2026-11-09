import { addDays } from "../../extension/robin/dates.ts";

/** Accelerated Python review before the existing 2026-11-23 backend transition.
 * These are prompts, not attendance or a replacement for the editable weekly plan. */
const topics = [
  ["Python 与基本语法", "用途、运行脚本/REPL；变量命名、注释、print、类型、type/isinstance。", "Python foundations", "Use cases, script/REPL, names, comments, print, types, type/isinstance."],
  ["字符串基础", "不可变、索引/负索引、转义、拼接、f-string、切片、len、in。", "String basics", "Immutability, indexing, escaping, concatenation, f-strings, slicing, len, in."],
  ["字符串方法", "大小写、strip、replace、split/join、startswith/endswith、find/count、maketrans/translate。", "String methods", "Case, strip, replace, split/join, prefix/suffix, find/count, maketrans/translate."],
  ["数值与函数", "四则运算、%、//、**、类型转换、round/abs/pow、增强赋值；函数参数、默认值、return/None、input、作用域。", "Numbers and functions", "Arithmetic, conversion, augmented assignment; parameters, defaults, return/None, input, scope."],
  ["条件与布尔逻辑", "比较运算、if/elif/else、嵌套条件、真值、bool、and/or/not 与短路。", "Conditions and booleans", "Comparisons, if/elif/else, truthiness, bool, and/or/not, short-circuiting."],
  ["列表基础", "索引/负索引、可变性、越界、del、嵌套、解包/星号解包、切片与步长。", "List basics", "Indexing, mutability, bounds, del, nesting, unpacking, slicing and steps."],
  ["列表方法与元组", "append 与 extend 的区别；insert/remove/pop、sort/sorted；元组不可变、解包、切片、count/index。", "Lists and tuples", "append vs extend, insert/remove/pop, sort/sorted; tuple immutability, unpacking, slicing and methods."],
  ["循环与迭代", "for/while、break/continue/else、range 的边界与负步长、enumerate、zip。", "Loops and iteration", "for/while, break/continue/else, range bounds and steps, enumerate, zip."],
  ["推导式与迭代工具", "列表推导式、filter/map/sum、lambda；比较可读性与返回的迭代器。", "Comprehensions and iterables", "List comprehensions, filter/map/sum and lambda; readability and iterators."],
  ["字典", "创建与访问、get 默认值、keys/values/items、update/pop/popitem、遍历键值对。", "Dictionaries", "Construction, lookup/get, keys/values/items, update/pop/popitem, iteration."],
  ["集合与容器对比", "set 去重、add/discard/remove；并/交/差/对称差、子集；何时用 list/tuple/dict/set。", "Sets and collections", "Set uniqueness, mutation and set operations; when to choose each collection."],
  ["模块与排错", "标准库与 import、__main__；常见异常、try/except/else/finally、raise/from、print 与 pdb 排查。", "Modules and debugging", "Stdlib imports, __main__, common exceptions, try/except/else/finally, raise/from, print and pdb."],
  ["类、对象与属性", "class、__init__、实例/类属性、方法；@property 与 setter/deleter，避免 setter 递归。", "Classes and properties", "class, __init__, instance/class attributes, methods, properties and setters/deleters."],
  ["面向对象的边界", "封装与单/双下划线、继承/super、多态、ABC/abstractmethod、常用 dunder。", "OOP boundaries", "Encapsulation, inheritance/super, polymorphism, ABCs and common dunder methods."],
  ["复杂度与线性结构", "时间/空间 Big O；动态数组、栈、deque 队列、单/双向链表及操作代价。", "Complexity and linear structures", "Time/space Big O, dynamic arrays, stacks, deque queues and linked lists."],
  ["哈希与递归", "dict/set 查找、哈希冲突与平均/最坏复杂度；递归基例与调用栈。", "Hashing and recursion", "dict/set lookups, collisions and complexity; recursive base cases and call stacks."],
  ["查找与排序", "线性/二分查找及有序前提；归并排序的分治、时间与额外空间。", "Search and sorting", "Linear/binary search and sorted input; merge sort time and extra space."],
  ["图与树", "邻接表/矩阵、BFS/DFS、无权最短路、树与二叉搜索树、Trie 前缀查找。", "Graphs and trees", "Adjacency list/matrix, BFS/DFS, unweighted shortest paths, trees, BSTs and tries."],
  ["堆、动态规划与总复盘", "heapq 与优先队列；DP 的重叠子问题、记忆化/制表法；回看最不熟的三块。", "Heaps, DP and review", "heapq and priority queues; overlapping subproblems, memoization/tabulation; revisit three weak spots."],
] as const;

export const PYTHON_REVIEW_DAYS = topics.map(([zh, focusZh, en, focusEn], index) => ({
  date: addDays("2026-11-04", index), zh, focusZh, en, focusEn,
}));

export function pythonReviewForWeek(week: string) {
  const end = addDays(week, 6);
  return PYTHON_REVIEW_DAYS.filter(({ date }) => date >= week && date <= end);
}
