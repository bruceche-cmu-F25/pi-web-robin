/* One-time, non-destructive import of the user's freeCodeCamp Python study notes.
 * Run: node --experimental-strip-types scripts/seed-python-study-canvas.mjs
 * Re-running never overwrites a board the user has edited.
 */
import { randomUUID } from "node:crypto";
import { generateNKeysBetween } from "fractional-indexing";
import { createCanvas, listCanvases, saveCanvas } from "../extension/robin/canvas-domain.ts";
import { PYTHON_STUDY_CANVAS_TITLE } from "../extension/robin/learning-shelf.ts";

// Each row has a reading card, an active-recall prompt, and its answer off to the right.
// Deliberately concise: this is a navigable study map, not a verbatim course transcript.
const chapters = [
  {
    title: "01 · Python / 变量 / 类型",
    read: `Python 是通用、动态类型语言：可用于 Web、数据、自动化、嵌入式等。\n变量：user_age = 20；名字区分大小写，采用 snake_case，不能以数字开头或使用关键字。\nint、float、str、bool 是常见类型；type(x) 看类型，isinstance(x, int) 判断。\nprint(x) 输出；input('Name? ') 返回字符串。# 是单行注释；多行注释是多行 #，三引号字符串不是专用注释。`,
    ask: "为什么 x = 3; x = 'hi' 不需要先声明类型？input() 返回什么类型？",
    answer: "变量名绑定对象，运行时对象有类型；重新赋值可绑定另一种对象。input() 始终返回 str，需要 int(...) 等显式转换。",
  },
  {
    title: "02 · 字符串与切片",
    read: `字符串不可变。'Hello'[0] 是 H，[-1] 是 o；s[start:stop:step] 的 stop 不包含在结果中。\n拼接：+、+=；格式化：f'Hi {name}'；引号可用 \\ 转义。\n常用：len(s)、'll' in s、upper/lower、strip、replace、split、' '.join(parts)、startswith/endswith、find（没找到为 -1）、count、capitalize/title、isupper/islower。\n翻译字符：table = str.maketrans('abc', '123'); 'abc'.translate(table) → '123'。方法通常返回新字符串。`,
    ask: "s = '  abCA  '，怎样得到 'Abca' 而不修改 s？s[1:4:2] 又是什么？",
    answer: "s.strip().capitalize() → 'Abca'；s[1:4:2] → ' b'（原串索引 1 和 3，保留前导空格）。字符串方法生成新值。",
  },
  {
    title: "03 · 数字与运算",
    read: `+ - * / 是基本运算；/ 得浮点，// 向下取整，% 取模，** 求幂。\nfloat(3) → 3.0；int(3.9) → 3（向零截断，不是四舍五入）。abs(-3) → 3；pow(2, 3) → 8。\nround() 使用 ties-to-even：round(2.5) → 2，round(3.5) → 4。\n增强赋值：count += 1、total *= 2；混合 int 与 float 通常得到 float。`,
    ask: "-7 // 3 与 int(-7 / 3) 为什么不同？",
    answer: "-7 // 3 == -3（向负无穷取整）；int(-7 / 3) == -2（向零截断）。不要把两者当同义词。",
  },
  {
    title: "04 · 函数 / 参数 / 作用域",
    read: `def add(a, b=2): return a + b；add(3) → 5。参数数量不匹配通常是 TypeError。\n没有显式 return 的函数返回 None。局部变量和参数只在函数内可见；全局变量可以读取，但要在函数内重新绑定同名全局变量需 global（通常更适合传参/返回）。\n函数是可复用的输入→输出边界；少依赖外部可变状态。`,
    ask: "def f(x): print(x + 1)；print(f(2)) 会打印什么？怎样让 f 返回 3？",
    answer: "先打印 3，再打印 None。把 print(x + 1) 改为 return x + 1。",
  },
  {
    title: "05 · 条件 / 布尔逻辑",
    read: `if / elif / else 按顺序判断，首个满足的分支执行；也可以嵌套。比较：==、!=、>、<、>=、<=。\nNone、False、0、0.0、''、空容器是假值；非空字符串（包括 '0'）是真值；bool(x) 显式查看。\nand / or 短路并返回操作数本身，不一定是 bool：'' or 'default' → 'default'，0 and 10 → 0。not 总是返回 bool。`,
    ask: "name = ''；display = name or 'Guest' 的值？if 'False' 会进分支吗？",
    answer: "display 是 'Guest'；'False' 是非空字符串，所以是真值，会进分支。",
  },
  {
    title: "06 · 列表与元组",
    read: `list 有序、可变，索引从 0 起；a[-1] 是最后一个。越界抛 IndexError。切片 a[1:3] 返回新列表；可嵌套、可解包：name, *rest = values。\nappend(x) 加一个元素；extend(xs) 加多个；insert、remove（首个匹配）、pop（移除并返回）、clear、sort（原地）、reverse（原地）、index（找不到报 ValueError）。sorted(a) 返回新列表。\ntuple 有序、不可变：('a', 2)。也支持索引、切片、解包、count、index。固定记录用 tuple，需增删改用 list；元组内仍可能含可变对象。`,
    ask: "a = [1, 2]; a.append([3, 4]) 和 a.extend([3, 4]) 的结果分别是什么？",
    answer: "append 后是 [1, 2, [3, 4]]；extend 后是 [1, 2, 3, 4]。元组不可修改其槽位，但若槽位是 list，内部仍可修改。",
  },
  {
    title: "07 · 循环 / range / zip",
    read: `for item in items 遍历序列；while condition 在条件为真时反复执行。break 提前退出；continue 跳过本轮。循环的 else 只在没有被 break 终止时运行。\nrange(start, stop, step) 惰性产生整数，不含 stop；range(2, 11, 2) → 2,4,6,8,10。\nenumerate(items, start=0) 给 (序号, 值)；zip(xs, ys) 并行配对，默认到较短的一方结束。`,
    ask: "怎样打印三个名字及从 1 开始的编号？两个列表长度不同，zip 默认怎样处理？",
    answer: "for i, name in enumerate(names, 1): print(i, name)。zip 默认在最短 iterable 结束处停止；重要数据要主动检查长度。",
  },
  {
    title: "08 · 推导式 / 迭代工具",
    read: `列表推导式：[n for n in range(21) if n % 2 == 0]。表达式放前面，筛选条件放末尾。\nmap(fn, xs)、filter(predicate, xs) 返回惰性迭代器；简单映射/过滤也可以使用推导式。sum(xs, start=0) 求和。\nlambda x: x * 2 是简短匿名函数；适合 sorted(words, key=lambda s: s.lower()) 这种一次性参数，复杂逻辑用 def。`,
    ask: "如何得到单词列表中长度大于 4 的单词的大写副本，不改原列表？",
    answer: "[word.upper() for word in words if len(word) > 4]。遍历一次，额外空间与结果大小成正比。",
  },
  {
    title: "09 · 字典与集合",
    read: `dict 存唯一键→值；d[key] 缺失报 KeyError，d.get(key, default) 可提供默认。keys/values/items 是动态视图；pop、popitem、update、clear 修改字典。for key, value in d.items() 遍历键值。\nset 去重且无索引：set() 创建空集，{} 创建空字典。成员必须可哈希（不是简单地“任何不可变对象”）。add、remove（不存在报错）、discard（不报错）。\n集合运算：A | B 并、A & B 交、A - B 差、A ^ B 对称差；issubset、issuperset、isdisjoint。`,
    ask: "要计数词频用 dict 还是 set？要找两个列表的共同元素用什么？",
    answer: "词频用 dict：counts[w] = counts.get(w, 0) + 1。交集：set(a) & set(b)；集合会去重，也不保证原始顺序。",
  },
  {
    title: "10 · 模块 / 错误 / 调试",
    read: `标准库有 math、random、re、datetime、collections、heapq 等。import math → math.sqrt(36)；from math import sqrt 直接调用；避免 from math import * 污染命名空间。\nif __name__ == '__main__': 只在文件作为主程序运行时执行。\n常见异常：SyntaxError、NameError、TypeError、IndexError、AttributeError、ValueError、KeyError。用 print、断点或 pdb 定位；不要无差别吞异常。\ntry/except 捕获预期错误；else 成功后运行；finally 无论异常与否都运行（即使返回）。raise 可以主动报告错误；raise NewError(...) from e 保留原因。`,
    ask: "int('abc') 会抛什么？只想在直接运行脚本时执行 main() 怎么写？",
    answer: "会抛 ValueError。写 if __name__ == '__main__': main()。捕获具体异常，不要用裸 except 隐藏程序错误。",
  },
  {
    title: "11 · 类 / 封装 / 继承",
    read: `class 定义对象的属性和方法；__init__(self, ...) 初始化实例。实例属性属于各对象，类属性由类共享。\n@property / @x.setter 可在赋值时验证，setter 内写 self._x，避免 self.x 无限递归。单下划线 _internal 是约定；双下划线 __name 是名称改写，不是安全边界。\nChild(Parent) 继承；super() 调父类方法。同一接口的不同实现体现多态；抽象基类 abc.ABC + @abstractmethod 可要求子类实现契约。\n__str__、__eq__、__iter__ 等双下划线方法让内建语法调用自定义行为。优先简单数据结构，确实需要状态与行为封装时再用类。`,
    ask: "钱包余额为何应通过 deposit() 修改？在 @property balance.setter 内写 self.balance = value 会怎样？",
    answer: "方法可以集中验证金额/维护不变量。setter 内再次赋值 self.balance 会递归调用自身；应写私有存储名 self._balance。",
  },
  {
    title: "12 · 复杂度 / 数组 / 栈 / 队列",
    read: `Big O 描述随输入规模增长的时间/额外空间（不是秒数）：O(1)、O(log n)、O(n)、O(n log n)、O(n²)。\nPython list 是动态数组：按索引读 O(1)，末尾 append 均摊 O(1)，中间插入/删除 O(n)；扩容时 append 可达 O(n)。\n栈 LIFO：list.append/pop()，两端都在末尾 O(1) 均摊。队列 FIFO：collections.deque.append/popleft() 均摊 O(1)，不要反复 list.pop(0)。`,
    ask: "用 list.pop(0) 反复出队 n 次总体复杂度？如何改？",
    answer: "每次移动其余元素 O(n)，总计 O(n²)；换 deque.popleft()，n 次总体 O(n)。",
  },
  {
    title: "13 · 链表 / 哈希结构",
    read: `单链表节点存值与 next；头部插入 O(1)，遍历/随机访问 O(n)；尾部插入若维护 tail 可为 O(1)。双链表再存 prev，便于双向遍历。\ndict / set 基于哈希；常见查找、插入、删除均摊 O(1)，极端冲突/病态输入会退化。键/元素需要可哈希，不可变 tuple 也可能因包含 list 而不可哈希。\n选择：需按序号访问用 list；去重用 set；键值索引用 dict；频繁从两端进出用 deque。不要因为理论 O(1) 就盲目手写链表。`,
    ask: "访问链表第 100 个节点与 list[99] 分别是什么复杂度？",
    answer: "链表要沿 next 走，O(n)；动态数组按索引访问 O(1)。链表若已持有节点引用，插入/删除才可能 O(1)。",
  },
  {
    title: "14 · 递归 / 搜索 / 排序",
    read: `递归必须有终止条件，调用栈占空间；Python 递归深度有限，深树可改迭代。\n线性搜索无需排序：时间 O(n)，额外空间 O(1)。二分搜索必须先有序：每次缩半，时间 O(log n)，迭代实现额外空间 O(1)；若排序本身花 O(n log n)，一次搜索未必值得先排序。\n归并排序：分治+合并，时间 O(n log n)，额外空间 O(n)。sorted(xs, key=..., reverse=True) 返回新列表；xs.sort() 原地排序。`,
    ask: "无序列表只查找一次，先排序后二分一定比线性扫描快吗？",
    answer: "不一定。先排序 O(n log n) 再搜索 O(log n)，一次线性扫描 O(n)；重复搜索时才可能摊薄排序成本。",
  },
  {
    title: "15 · 图 / 树 / Trie",
    read: `图由顶点和边组成，可有向/无向、带权/无权、连通/不连通、含环/无环。邻接表适合稀疏图（O(V+E) 存储），邻接矩阵占 O(V²)，但查任意边 O(1)。\nBFS 用队列按层访问，可在无权图找最短边数路径；DFS 用栈/递归深入，可做遍历、环检测等。树是连通无环图。\n二叉树每节点最多两个孩子；BST 的左小右大要有明确定义并维护，不是所有二叉树都自动有序。Trie 共享字符串前缀，查询/插入与词长 L 成正比。`,
    ask: "在无权社交关系图找最少经过几个人，用 BFS 还是 DFS？稀疏图如何存？",
    answer: "用 BFS 分层找最短边数路径；稀疏图用邻接表，避免 O(V²) 的矩阵空间。",
  },
  {
    title: "16 · 堆与优先队列",
    read: `优先队列按优先级取出，不按插入顺序。最小堆每个父节点 ≤ 孩子；根是最小项（并非整个数组已排序）。\nheapq.heapify(xs) 原地建堆 O(n)；heappush / heappop 均 O(log n)；heappushpop 适合插入后取最小。\n通常放 (priority, sequence, item)；小优先级先出，sequence 用于相同优先级的稳定顺序，也避免不可比较对象触发 TypeError。`,
    ask: "两个任务优先级相同，任务对象不可比较，堆里存 (priority, task) 会有什么问题？",
    answer: "元组会继续比较 task，可能 TypeError。用 (priority, 自增序号, task)，序号打破平局。",
  },
  {
    title: "17 · 动态规划",
    read: `当子问题重复出现且最优解可由子问题组合时，考虑 DP；用空间换掉重复计算。\n自顶向下：递归 + 缓存（如 functools.cache / lru_cache）；自底向上：从小规模开始填表。\n步骤：定义状态、状态转移、基础情形、计算顺序、结果位置；最后评估时间和空间。不满足重复子问题就不必强行用 DP。\n例：爬楼梯 ways(n) = ways(n-1) + ways(n-2)，基础 ways(0)=ways(1)=1；滚动两个变量可把额外空间降到 O(1)。`,
    ask: "朴素递归爬楼梯为何慢？缓存与滚动变量分别解决什么？",
    answer: "朴素递归重复计算同一 ways(k)，时间指数级。缓存后 O(n) 时间/O(n) 空间；自底向上滚动变量可 O(n) 时间/O(1) 额外空间。",
  },
];

// Fixed-width cards with explicit wrapping: text remains independently editable in Excalidraw.
const COLUMN_X = [80, 670, 1260];
const CARD_WIDTH = 540;
const FONT_SIZE = 18;
const LINE_HEIGHT = 24;
function wrap(text, limit = 43) {
  return text.split("\n").flatMap((line) => {
    const result = [];
    let chunk = "", width = 0;
    for (const char of line) {
      const units = char.charCodeAt(0) > 255 ? 2 : 1;
      if (width + units > limit && chunk) { result.push(chunk); chunk = ""; width = 0; }
      chunk += char; width += units;
    }
    result.push(chunk);
    return result;
  }).join("\n");
}
const elements = [];
function card(x, y, text, fill, ink, heading = false) {
  const wrapped = wrap(text, heading ? 34 : 43);
  const height = Math.max(90, wrapped.split("\n").length * (heading ? 30 : LINE_HEIGHT) + 44);
  const common = { x, y, width: CARD_WIDTH, height, angle: 0, fillStyle: "solid", strokeWidth: 1,
    strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [randomUUID()], frameId: null,
    roundness: { type: 3 }, seed: 101 + elements.length, version: 1, versionNonce: 1,
    isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false };
  elements.push({ ...common, id: randomUUID(), type: "rectangle", strokeColor: fill === "#f4eddb" ? "#baa77e" : "#a2b9c9", backgroundColor: fill });
  elements.push({ ...common, id: randomUUID(), type: "text", x: x + 22, y: y + 18,
    width: CARD_WIDTH - 44, height: height - 36, strokeColor: ink, backgroundColor: "transparent",
    roundness: null, text: wrapped, originalText: wrapped, fontSize: heading ? 24 : FONT_SIZE,
    fontFamily: 3, textAlign: "left", verticalAlign: "top", containerId: null,
    autoResize: false, lineHeight: heading ? 1.25 : 4 / 3 });
  return height;
}
card(80, 70, "freeCodeCamp · Python 互动学习笔记", "#17324b", "#ffffff", true);
card(670, 70, "阅读 → 先自己回答 → 向右平移核对。拖动、编辑卡片，补充自己的例子；缩放/平移定位章节。", "#e7f1f4", "#17324b");
card(1260, 70, "原文整理自你提供的 Python 学习材料；这是复习地图，不替代课程练习。答案是自检参考，不会自动评分或记录掌握度。", "#f4eddb", "#29251d");
let y = 260;
for (const chapter of chapters) {
  const reading = card(COLUMN_X[0], y, `${chapter.title}\n\n${chapter.read}`, "#e7f1f4", "#17324b");
  const prompt = card(COLUMN_X[1], y, `${chapter.title}\n\n想一想 / 动手试\n\n${chapter.ask}`, "#ffffff", "#17324b");
  const answer = card(COLUMN_X[2], y, `${chapter.title}\n\n核对答案\n\n${chapter.answer}`, "#f4eddb", "#29251d");
  y += Math.max(reading, prompt, answer) + 42;
}
// The editor relies on strictly increasing fractional indices for element ordering.
for (const [i, key] of generateNKeysBetween(null, null, elements.length).entries()) elements[i].index = key;

const existing = listCanvases().find((board) => board.title === PYTHON_STUDY_CANVAS_TITLE);
if (existing) {
  console.log(`Already exists (left untouched): /notes?view=canvas&canvas=${existing.id}`);
} else {
  const board = createCanvas(PYTHON_STUDY_CANVAS_TITLE);
  saveCanvas(board.id, board.revision, { title: board.title, scene: {
    elements, files: {}, appState: { scrollX: 0, scrollY: 0, zoom: { value: 0.9 } },
  } });
  console.log(`Created ${chapters.length} chapters: /notes?view=canvas&canvas=${board.id}`);
}
