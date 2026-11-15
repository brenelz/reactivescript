/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Show, action, createSignal, createOptimisticStore, flush, refresh } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
type Row = { id: number; title: string; adding?: boolean };
// the .rx runtime's keyed landing (rt-web.ts landDraft): rows matched by key, leaves merged
function landDraft(draft: any[], v: any[]) {
  const had = new Map<unknown, any>(); for (const row of draft) had.set(row.id, row);
  v.forEach((x, i) => { const row = had.get(x.id); if (row) { for (const k of Object.keys(x)) if (row[k] !== x[k]) row[k] = x[k]; if (draft[i] !== row) draft[i] = row; } else draft[i] = x; });
  draft.length = v.length;
}
test("a row guessed into a store doesn't show while a held add's write and an accepted move's refresh are out", async () => {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const land = (k: string, v: any) => { const rs = fl[k] ?? []; if (!rs.length) throw new Error("no ask " + k); fl[k] = []; rs.forEach(r => r(structuredClone(v))); };
  const c = document.body.appendChild(document.createElement("div"));

  const [todoAns, setTodoAns] = createSignal<any>(() => ask("todo"), { loadingValue: null } as any);
  const [doingAns] = createSignal<any>(() => ask("doing"), { loadingValue: null } as any);
  const [todo, setTodo] = createOptimisticStore<Row[]>((d: any) => { landDraft(d, todoAns() ?? []); }, [], { key: "id" } as any);
  const [doing, setDoing] = createOptimisticStore<Row[]>((d: any) => { landDraft(d, doingAns() ?? []); }, [], { key: "id" } as any);

  // a move as the server makes it: each list's new shape, as a function guess (#4724: one write per differing index)
  const move = action(function* (id: number) {
    const row = todo.find(r => r.id === id)!;
    setTodo((rs: Row[]) => rs.filter(r => r.id !== id));
    setDoing((rs: Row[]) => [...rs, { ...row }]);
    yield ask("move");
    refresh(todoAns); refresh(doingAns);
  });
  // an add: a placeholder guessed at the end of To do; the answer is the new card, written into To do's answer
  const add = action(function* (key: number, title: string, at: number) {
    setTodo((d: any) => { d[at] = { id: key, title, adding: true }; });
    const r: any = yield ask(`add:${title}`);
    setTodoAns((cs: any[]) => [...cs, { id: r.id, title: r.title }]);
  });

  const col = (rows: Row[]) => <ul><For each={rows}>{(r: any) => <li>{r.adding ? `(${r.title})` : r.id}</li>}</For></ul>;
  render(() => <div><Show when={todoAns() != null} fallback={<ul><li>loading</li></ul>}>{col(todo)}</Show><Show when={doingAns() != null} fallback={<ul><li>loading</li></ul>}>{col(doing)}</Show></div>, c);
  const state = () => [...c.querySelectorAll("ul")].map(u => [...u.querySelectorAll("li")].map(l => l.textContent).join(",")).join(" | ");

  land("todo", [{ id: 1, title: "a" }, { id: 2, title: "b" }]); land("doing", [{ id: 3, title: "c" }]); await tick();
  add(-1, "A", todo.length); await tick();
  land("add:A", { id: 10, title: "A" }); await tick();
  expect(state()).toBe("1,2,10 | 3");
  move(10); await tick();
  expect(state()).toBe("1,2 | 3,10");
  add(-2, "B", todo.length); await tick();
  land("add:B", { id: 11, title: "B" }); await tick();          // held with the move (same slot, todo[2])
  land("move", {}); await tick();                               // accepted: refreshes of both answers out
  console.log("before C:", state());
  add(-3, "C", todo.length); await tick();
  console.log("after C:", state());
  expect(state()).toContain("(C)");
});
