/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Fuzz seed 46 (board-rx3), "two views". One keyed optimistic store over two async answers. Move A (row 3) is
// accepted and its action re-asks both answers (held until they land). While the re-asks are out, rename B guesses
// row 5's title. The row's own text shows the guess; a memo that finds row 5 in the store (the detail's `sel`) and
// a text reading `sel().title` keeps the old title. NOT REPRODUCED here (passes): in the app it needed the add
// placeholder guessed into the store as a row; with the placeholder in a list of its own (the guide) it is gone.
import { test, expect } from "vitest";
import { For, action, createMemo, createSignal, createOptimisticStore, flush, refresh } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
type Row = { id: number; title: string; col: string };
test("a memo finding a row in a store whose truth is re-asked misses another action's guess on that row", async () => {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const land = (k: string, v: any) => { const rs = fl[k] ?? []; fl[k] = []; rs.forEach(r => r(structuredClone(v))); };
  const c = document.body.appendChild(document.createElement("div"));

  const [todoAns] = createSignal<any>(() => ask("todo"), { loadingValue: null } as any);
  const [doneAns] = createSignal<any>(() => ask("done"), { loadingValue: null } as any);
  const [board, guess] = createOptimisticStore<Row[]>(() => [
    ...(todoAns() ?? []).map((r: any) => ({ ...r, col: "todo" })),
    ...(doneAns() ?? []).map((r: any) => ({ ...r, col: "done" })),
  ], [], { key: "id" });
  const sel = createMemo(() => board.find(r => r.id === 5) ?? null);
  const reask = action(function* () { refresh(todoAns); refresh(doneAns); });
  const move = action(function* (i: number) {
    guess(b => { b[i].col = "done"; });
    yield ask("move");
    yield reask();
  });
  const rename = action(function* (i: number, t: string) {
    guess(b => { b[i].title = t; });
    yield ask("rename");
  });
  render(() => <div>
    <ul><For each={board}>{r => <li>{r().id}:{r().title}</li>}</For></ul>
    <h2>{sel()?.title}</h2>
  </div>, c);
  const state = () => `${[...c.querySelectorAll("li")].map(l => l.textContent).join(",")} | ${c.querySelector("h2")!.textContent}`;

  land("todo", [{ id: 3, title: "R" }]); land("done", [{ id: 5, title: "K" }]); await tick();
  expect(state()).toBe("3:R,5:K | K");
  move(0); await tick();
  land("move", {}); await tick();                     // accepted: both re-asks out
  rename(board.findIndex(r => r.id === 5), "B"); await tick();
  console.log("after rename guess:", state());
  expect(state()).toBe("3:R,5:B | B");
});
