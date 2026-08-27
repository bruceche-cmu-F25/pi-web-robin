import assert from "node:assert/strict";
import { test } from "node:test";
import { CANVAS_COURSES_URL, GMAIL_INBOX_URL, inferTodoUrl, todoUrl } from "./todo-links.ts";

test("a link written into the title is the link", () => {
  assert.equal(
    inferTodoUrl("考取 Google Cloud Associate Cloud Engineer（官方链接：https://cloud.google.com/learn/certification/cloud-engineer/）"),
    "https://cloud.google.com/learn/certification/cloud-engineer/",
  );
  // The closing CJK bracket belongs to the sentence, not to the address.
  assert.equal(inferTodoUrl("看看（https://example.com/a）再说"), "https://example.com/a");
});

test("course numbers point at Canvas, in every shape they are written", () => {
  for (const title of [
    "看 14795 的 Gradescope",
    "14848 HW1 Deadline",
    "18658 Challenge Due",
    "准备修读 CMU 14-848 Cloud Infrastructure",
    "在 SIO 上解决冲突并处理 14757-SV 选课注册邀请",
  ]) {
    assert.equal(inferTodoUrl(title), CANVAS_COURSES_URL, title);
  }
});

test("digits that are not course numbers are left alone", () => {
  for (const title of [
    "打印 I-94、I-20 和 I-485 797 Notice",
    "给 BOA 账户转钱转到 1500",
    "打给 412-268-2000",
    "截止 2026-08-30",
    "买 7 天地铁票",
  ]) {
    assert.equal(inferTodoUrl(title), undefined, title);
  }
});

test("an address in the title becomes a mailto, other email talk opens the inbox", () => {
  assert.equal(inferTodoUrl("问问 farag@cmu.edu 还有没有 research"), "mailto:farag@cmu.edu");
  assert.equal(inferTodoUrl("回复 advisor 的邮件"), GMAIL_INBOX_URL);
  assert.equal(inferTodoUrl("Reply to the recruiter email"), GMAIL_INBOX_URL);
  // An address beats a course number: it says exactly where the task goes.
  assert.equal(inferTodoUrl("14795 的助教 ta@andrew.cmu.edu"), "mailto:ta@andrew.cmu.edu");
});

test("a set link always wins over what the title implies", () => {
  assert.equal(
    todoUrl({ title: "14848 HW1 Deadline", url: "https://canvas.cmu.edu/courses/47523" }),
    "https://canvas.cmu.edu/courses/47523",
  );
  assert.equal(todoUrl({ title: "买 oat milk" }), undefined);
});
