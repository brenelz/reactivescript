// Drives the running playground (`pnpm dev`) in headless Chromium. PLAYGROUND_URL overrides the address and
// CHROMIUM the browser binary.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const URL = process.env.PLAYGROUND_URL ?? "http://localhost:3020/";
const exe =
  process.env.CHROMIUM ??
  [`${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`].find(existsSync);

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n").join("\n     ")}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const editor = page.getByTestId("editor");
const js = page.getByTestId("solid");
const settle = () => page.waitForTimeout(300);
const codes = () => page.getByTestId("diag-code").allInnerTexts();
const type = async (text) => {
  await editor.fill(text);
  await page.waitForTimeout(400);
};

await page.goto(URL);
await editor.waitFor();

await check("the featured example reads as Solid primitives: two memos for label", async () => {
  await js.getByText("createMemo", { exact: false }).first().waitFor({ timeout: 5000 });
  const text = await js.innerText();
  assert(text.includes("const [id, setId] = createSignal(1);"), "no createSignal for id");
  assert(text.includes("const label$await = createMemo(() => fetchUser(id()));"), "no memo for the hoisted await");
  assert(text.includes("const label = createMemo(() => label$await()?.name + suffix());"), "no memo for the rest of label");
  assert(text.includes("<Errored") && text.includes("<Loading"), "no Errored/Loading");
  assert(!text.includes("__rt") && !text.includes("_$template"), "runtime or compiled code in the view");
});

await check("Explain notes each line's .rx form and lists the primitives", async () => {
  const notes = await page.getByTestId("note").allInnerTexts();
  assert(notes.some((n) => n.includes("source id := …")), `notes: ${notes.join(" | ")}`);
  assert(notes.some((n) => n.includes("the await in label") && n.includes("reads id")), `notes: ${notes.join(" | ")}`);
  assert(notes.some((n) => n.includes("equation label") && n.includes("suffix")), `notes: ${notes.join(" | ")}`);
  const table = await page.getByTestId("explain").innerText();
  assert(table.includes("createMemo") && table.includes("an equation x = e"), `table: ${table}`);
  await page.getByTestId("explain-toggle").uncheck();
  assert((await page.getByTestId("note").count()) === 0, "notes still shown with Explain off");
  await page.getByTestId("explain-toggle").check();
});

await check("an object source reads as createStore", async () => {
  await type(`export default component App() {\n  source person := { first: "Ada", last: "Lovelace" }\n  <p>{person.first}</p>\n}\n`);
  const text = await js.innerText();
  assert(text.includes("const [person, setPerson] = createStore({"), `no createStore:\n${text}`);
  assert(text.includes("person?.first") && !text.includes("person()"), "the store is called like a signal");
});

await check("a rest prop reads as omit, spread without a call", async () => {
  await type(`component Badge({ label, tone = "info", ...rest }) {\n  <span class={tone} {...rest}>{label}</span>\n}\nexport default component App() {\n  <Badge label="New" title="fresh" />\n}\n`);
  const text = await js.innerText();
  assert(text.includes('const rest = omit(props, "label", "tone");') && text.includes("{...rest}"), `no omit:\n${text}`);
  assert(!text.includes("__rt") && !text.includes("rest()"), "omit is wrapped or called");
  assert((await page.getByTestId("explain").innerText()).includes("omit"), "Explain does not list omit");
});

await check("an effect reads as createEffect, its inputs named $0 and $1", async () => {
  await type(`import { report } from "./io"\nexport default component App() {\n  source count := 0\n  double = count * 2\n  effect (count, double) {\n    report($0, $1)\n    return () => { report("cleanup") }\n  }\n  effect () {\n    report("mounted")\n  }\n  <p>{count}</p>\n}\n`);
  const text = (await js.innerText()).replace(/\s+/g, " ");
  assert(text.includes("() => [count(), double()], ([$0, $1]) => { report($0, $1); return () => { report(\"cleanup\"); }; }"), `no createEffect over two inputs:\n${text}`);
  assert(text.includes("createEffect(() => {}, () => report(\"mounted\"))"), `no createEffect without inputs:\n${text}`);
  assert(!text.includes("__rt") && !text.includes("$p"), `the runtime's effect is still there:\n${text}`);
});

await check("the projection example reads as createProjection, keyed and draft", async () => {
  await page.getByTestId("example").selectOption("projection");
  await js.getByText("createProjection", { exact: false }).first().waitFor({ timeout: 5000 });
  const text = await js.innerText();
  assert(text.includes('const open = createProjection(() => open$answer(), [], { key: "id" });'), `no keyed projection:\n${text}`);
  assert(text.includes("const marks = createProjection((d) => {") && text.includes("d[String(picked())] = true;"), `no draft projection:\n${text}`);
  assert(text.includes("<For each={open}>"), "the projection is called like a signal");
  const notes = await page.getByTestId("note").allInnerTexts();
  assert(notes.some((n) => n.includes("open key id = …")), `notes: ${notes.join(" | ")}`);
  assert(notes.some((n) => n.includes("marks = draft(pre marks -> seed)")), `notes: ${notes.join(" | ")}`);
});

await check("typing updates the compiled output live", async () => {
  await type(`export default component App() {
  source count := 0
  tripled = count * 3
  <button onClick={() => { count := count + 1 }}>{tripled}</button>
}
`);
  const text = await js.innerText();
  assert(text.includes("const tripled = createMemo(() => count() * 3);"), `the new equation is not in the output:\n${text}`);
  assert((await codes()).length === 0, `unexpected diagnostics: ${await codes()}`);
  await type((await editor.inputValue()).replace("count * 3", "count * 4"));
  assert((await js.innerText()).includes("count() * 4"), "the edit did not reach the output");
});

await check("`double := 4` shows WRITE_TO_NON_SOURCE, with its rule and a guide link", async () => {
  await type(`export default component App() {
  source count := 0
  double = count * 2
  <button onClick={() => { double := 4 }}>{double}</button>
}
`);
  const link = page.getByTestId("diag-code").first();
  await link.waitFor();
  assert((await codes()).includes("WRITE_TO_NON_SOURCE"), `codes: ${await codes()}`);
  const href = await link.getAttribute("href");
  assert(href.endsWith("guide/diagnostics.md#write_to_non_source"), `href: ${href}`);
  const row = await page.getByTestId("diagnostics").innerText();
  assert(row.includes("[W-1]") && row.includes("double is an equation"), `row: ${row}`);
  assert(await page.locator(".output.stale").count(), "the output is not marked stale");
});

await check("every example compiles and reads as Solid primitives", async () => {
  const ids = await page.getByTestId("example").locator("option:not([disabled])").evaluateAll((os) => os.map((o) => o.value));
  assert(ids.length >= 5, `only ${ids.length} examples`);
  for (const id of ids) {
    await page.getByTestId("example").selectOption(id);
    await settle();
    assert((await codes()).length === 0, `${id}: ${await codes()}`);
    assert(!(await page.locator(".output.stale").count()), `${id}: output stale`);
    const text = await js.innerText();
    assert(/create(Signal|Store)\(/.test(text) && !text.includes("__rt"), `${id}: not shown as Solid primitives:\n${text}`);
  }
});

await check("an edited program survives a reload through the URL hash", async () => {
  await type(`export default component App() {\n  source shared := 41\n  <p>{shared + 1}</p>\n}\n`);
  await page.waitForTimeout(500);
  assert(page.url().includes("#code="), `url: ${page.url()}`);
  await page.reload();
  await editor.waitFor();
  assert((await editor.inputValue()).includes("source shared := 41"), "the program did not come back");
  await js.getByText("createSignal(41)", { exact: false }).waitFor({ timeout: 5000 });
});

await check("a program of two .rx modules shows both, and adding a file is kept in the URL", async () => {
  await page.getByTestId("example").selectOption("source");
  page.once("dialog", (d) => d.accept("util.rx"));
  await page.getByTitle("Add a file").click();
  await type("export bump = 10\n");
  await page.getByRole("button", { name: "main.rx", exact: true }).click();
  await type(`import { bump } from "./util.rx"\n\nexport default component App() {\n  source n := 0\n  total = n + bump\n  <p>{total}</p>\n}\n`);
  await js.getByText("// /util.rx", { exact: false }).waitFor({ timeout: 5000 });
  const text = await js.innerText();
  assert(text.includes("const total = createMemo("), `entry not shown as primitives:\n${text}`);
  assert(!(await page.getByTestId("solid-error").count()), await page.getByTestId("solid-error").innerText().catch(() => ""));
  await page.waitForTimeout(500);
  assert(page.url().includes("#code="), `the added file is not in the URL: ${page.url()}`);
});

await check("Solid → .rx reads the Solid view back as .rx, lists what it cannot read, and hands the .rx to the editor", async () => {
  await page.getByTestId("example").selectOption("await");
  await js.getByText("label$await", { exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByTestId("mode").click();
  const out = page.getByTestId("rx-out");
  await out.getByText("fetchUser", { exact: false }).first().waitFor({ timeout: 5000 });
  let rx = await out.innerText();
  assert(rx.includes("label = (await fetchUser(id)).name + suffix") && rx.includes("{errored fallback(e) {"), `not the await example:\n${rx}`);
  assert((await page.getByTestId("rx-check").innerText()).includes("The checker accepts it."), "the checker does not accept the .rx");
  const solidEditor = page.getByTestId("solid-editor");
  await solidEditor.fill(`import { createSignal, createRenderEffect } from "solid-js";\nexport default function App() {\n  const [n, setN] = createSignal(0);\n  createRenderEffect(() => n(), (v) => console.log(v));\n  return <p onClick={() => setN(n() + 1)}>{n()}</p>;\n}\n`);
  await page.getByTestId("rx-problems").getByText("render effect", { exact: false }).first().waitFor({ timeout: 5000 });
  assert(await page.getByTestId("use-rx").isDisabled(), "an incomplete result can be opened in the editor");
  await solidEditor.fill(`import { createSignal, createMemo } from "solid-js";\nexport default function Counter() {\n  const [count, setCount] = createSignal(0);\n  const doubled = createMemo(() => count() * 2);\n  return <button onClick={() => setCount(count() + 1)}>{doubled()}</button>;\n}\n`);
  await out.getByText("doubled = count * 2", { exact: false }).first().waitFor({ timeout: 5000 });
  // plain TypeScript beside the component moves to helpers.ts, and comes along into the editor
  await solidEditor.fill(`import { createMemo } from "solid-js";\nconst wait = (ms) => new Promise((r) => setTimeout(r, ms));\nconst load = async () => (await wait(10), ["a"]);\nfunction App() {\n  const items = createMemo(load);\n  return <p>{items().length}</p>;\n}\n`);
  await out.getByText("items = await load()", { exact: false }).first().waitFor({ timeout: 5000 });
  assert((await page.getByTestId("rx-helpers").innerText()).includes("export const load = async"), "no helpers.ts");
  assert((await page.getByTestId("rx-check").innerText()).includes("UNHANDLED_FAILURE"), "the checker does not ask for a boundary");
  await solidEditor.fill(`import { createSignal, createMemo } from "solid-js";\nexport default function Counter() {\n  const [count, setCount] = createSignal(0);\n  const doubled = createMemo(() => count() * 2);\n  return <button onClick={() => setCount(count() + 1)}>{doubled()}</button>;\n}\n`);
  await out.getByText("doubled = count * 2", { exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByTestId("use-rx").click();
  rx = await editor.inputValue();
  assert(rx.includes("source count := 0") && rx.includes("onClick={() => { count := count + 1 }}"), `the editor did not get the .rx:\n${rx}`);
  await js.getByText("const doubled = createMemo", { exact: false }).first().waitFor({ timeout: 5000 });
});

await check("hovering a name shows its type, and an attribute its documentation", async () => {
  await page.getByTestId("example").selectOption("await");
  await js.getByText("label$await", { exact: false }).first().waitFor({ timeout: 5000 });
  // where a name is on screen: the editor's padding and character size, as the page lays them out
  const point = (needle, nth = 0) =>
    page.evaluate(
      ([needle, nth]) => {
        const ta = document.querySelector("[data-testid=editor]");
        const bd = ta.previousElementSibling;
        const cs = getComputedStyle(bd);
        const probe = document.createElement("span");
        probe.textContent = "0".repeat(100);
        probe.style.cssText = "position:absolute;visibility:hidden";
        bd.append(probe);
        const b = probe.getBoundingClientRect();
        probe.remove();
        let i = -1;
        for (let k = 0; k <= nth; k++) i = ta.value.indexOf(needle, i + 1);
        const before = ta.value.slice(0, i);
        const box = ta.getBoundingClientRect();
        return { x: box.left + parseFloat(cs.paddingLeft) + (before.length - before.lastIndexOf("\n") - 1 + 1.5) * (b.width / 100) - ta.scrollLeft, y: box.top + parseFloat(cs.paddingTop) + (before.split("\n").length - 0.5) * b.height - ta.scrollTop };
      },
      [needle, nth],
    );
  // the tooltip for a name, once it says what is expected (the last one stays up until the next arrives)
  const hover = async (needle, nth, ...expected) => {
    const p = await point(needle, nth);
    await page.mouse.move(p.x - 200, p.y + 150);
    await page.mouse.move(p.x, p.y);
    const tip = page.getByTestId("hover");
    await tip.waitFor({ timeout: 30000 });
    const said = () => tip.innerText().then((t) => t.replace(/\s+/g, " "));
    for (let i = 0; i < 40; i++) {
      const t = await said().catch(() => "");
      if (expected.every((e) => t.includes(e))) return t;
      await page.waitForTimeout(150);
    }
    throw new Error(`hovering ${needle}: expected ${expected.join(" and ")}, the tooltip says:\n${await said().catch(() => "(nothing)")}`);
  };
  await hover("label", 0, "label: string");
  await hover("id", 0, "source id: number");
  const fn = await hover("fetchUser", 1, "fetchUser(id: number): any");
  assert(!fn.includes("import"), `a .d.rx function reads as an import:\n${fn}`);
  await hover("class", 0, "class?:", "Class names to apply");
  await page.mouse.move(5, 5);
  await page.getByTestId("hover").waitFor({ state: "detached", timeout: 5000 });
});

await check("typing offers what fits: a store's fields after a dot, names in scope, and a keyword", async () => {
  const program = `export default component App() {\n  source user := { name: "Ada", age: 36 }\n  source count := 0\n  shown = \n  <p>{shown}</p>\n}\n`;
  await type(program);
  await editor.evaluate((el, at) => (el.focus(), el.setSelectionRange(at, at)), program.indexOf("shown = ") + 8);
  const menu = page.getByTestId("complete");
  // the list, once it holds exactly these names (it follows the typing)
  const offers = async (...names) => {
    let seen = [];
    for (let i = 0; i < 100; i++) {
      seen = (await menu.locator("li span").allInnerTexts().catch(() => [])).map((t) => t.trim());
      if (seen.join() === names.join()) return;
      await page.waitForTimeout(150);
    }
    throw new Error(`expected ${names.join(", ")}; the list holds ${seen.join(", ") || "nothing"}`);
  };
  await page.keyboard.type("user.");
  await offers("age", "name");
  await page.keyboard.type("na");
  await offers("name");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" + cou");
  await offers("count");
  await page.keyboard.press("Tab");
  assert((await editor.inputValue()).includes("  shown = user.name + count\n"), `the names were not written:\n${await editor.inputValue()}`);
  await page.keyboard.type(" + so");
  await offers("source");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached", timeout: 5000 });
});

await check("the Solid pane has TypeScript too: an accessor's type on hover, and a store's fields after a dot", async () => {
  await page.getByTestId("mode").click();
  const solidEditor = page.getByTestId("solid-editor");
  const program = `import { createSignal, createStore } from "solid-js";\nexport default function App() {\n  const [count, setCount] = createSignal(0);\n  const [user] = createStore({ name: "Ada", age: 36 });\n  return <p>{count()} </p>;\n}\n`;
  await solidEditor.fill(program);
  const tips = page.getByTestId("hover");
  const menus = page.getByTestId("complete");
  // the pointer over `count` in `{count()}`: the pane's own editor, its own padding
  const p = await solidEditor.evaluate((ta, at) => {
    const bd = ta.previousElementSibling;
    const cs = getComputedStyle(bd);
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden";
    bd.append(probe);
    const b = probe.getBoundingClientRect();
    probe.remove();
    const before = ta.value.slice(0, at);
    const box = ta.getBoundingClientRect();
    return { x: box.left + parseFloat(cs.paddingLeft) + (before.length - before.lastIndexOf("\n") - 1 + 1.5) * (b.width / 100), y: box.top + parseFloat(cs.paddingTop) + (before.split("\n").length - 0.5) * b.height };
  }, program.indexOf("{count()}") + 1);
  await page.mouse.move(p.x - 200, p.y + 150);
  await page.mouse.move(p.x, p.y);
  let said = "";
  for (let i = 0; i < 100 && !said.includes("const count: () => number"); i++) {
    said = (await tips.innerText().catch(() => "")).replace(/\s+/g, " ");
    await page.waitForTimeout(150);
  }
  assert(said.includes("const count: () => number"), `an accessor's type:\n${said || "(no tooltip)"}`);
  await solidEditor.evaluate((el, at) => (el.focus(), el.setSelectionRange(at, at)), program.indexOf("{count()} ") + 10);
  await page.keyboard.type("{user.");
  let seen = [];
  for (let i = 0; i < 100 && seen.join() !== "age,name"; i++) {
    seen = (await menus.locator("li span").allInnerTexts().catch(() => [])).map((t) => t.trim());
    await page.waitForTimeout(150);
  }
  assert(seen.join() === "age,name", `a store's fields: ${seen.join(", ") || "nothing"}`);
  await page.keyboard.press("Enter");
  assert((await solidEditor.inputValue()).includes("{count()} {user.age"), `the field was not written:\n${await solidEditor.inputValue()}`);
  // a Solid primitive the file has not imported is offered, and picking it imports it
  await solidEditor.evaluate((el, at) => (el.focus(), el.setSelectionRange(at, at)), (await solidEditor.inputValue()).indexOf("  return <p>"));
  await page.keyboard.type("const m = createMe");
  seen = [];
  for (let i = 0; i < 100 && !seen.includes("createMemo"); i++) {
    seen = (await menus.locator("li span").allInnerTexts().catch(() => [])).map((t) => t.trim());
    await page.waitForTimeout(150);
  }
  assert(seen[0] === "createMemo", `createMemo is not offered first: ${seen.join(", ") || "nothing"}`);
  await page.keyboard.press("Enter");
  const picked = await solidEditor.inputValue();
  assert(picked.includes('import { createSignal, createStore, createMemo } from "solid-js";') && picked.includes("const m = createMemo  return"), `the import was not added:\n${picked}`);
  await page.getByTestId("mode").click();
});

await check("Open in Solid Playground carries the view as tabs, with what it imports and its scoped styles", async () => {
  // what the link's hash holds, read back the way the Solid playground reads it
  const tabs = async () => {
    const href = await page.getByTestId("open-solid").getAttribute("href");
    assert(href?.startsWith("https://playground.solidjs.com/#"), `no link: ${href}`);
    const { decompressFromURL } = await import("@amoutonbrady/lz-string");
    return JSON.parse(decompressFromURL(href.slice(href.indexOf("#") + 1)));
  };
  await page.getByTestId("example").selectOption("await");
  await js.getByText("label$await", { exact: false }).first().waitFor({ timeout: 5000 });
  await settle();
  let t = await tabs();
  assert(t.map((x) => x.name).join() === "main.tsx,users.jsx", `tabs: ${t.map((x) => x.name)}`);
  assert(t[0].source.startsWith('import { render } from "@solidjs/web";') && t[0].source.includes('render(() => <App />, document.getElementById("app")!);') && !t[0].source.includes("export default"), `main.tsx does not mount the view:\n${t[0].source}`);
  assert(t[0].source.includes("opacity: 0.5") && t[1].source.includes("export async function fetchUser"), "the styles or the imported module are missing");
  // a program that would not run there has no link, and says why
  await type(`import { report } from "./io"\nexport default component App() {\n  source n := 0\n  <p onClick={() => { report(n) }}>{n}</p>\n}\n`);
  await page.locator("span[data-testid=open-solid]").waitFor({ timeout: 5000 });
  const why = await page.getByTestId("open-solid").getAttribute("title");
  assert(why.includes("./io"), `the reason does not name the missing module: ${why}`);
});

await check("log is offered as a built-in, and reads as console.log in the Solid view", async () => {
  const program = `export default component App() {\n  source n := 0\n  <p onClick={() => {  }}>{n}</p>\n}\n`;
  await type(program);
  await editor.evaluate((el, at) => (el.focus(), el.setSelectionRange(at, at)), program.indexOf("{  }") + 2);
  await page.keyboard.type("lo");
  const menu = page.getByTestId("complete");
  let seen = [];
  for (let i = 0; i < 100 && seen[0] !== "log"; i++) {
    seen = (await menu.locator("li span").allInnerTexts().catch(() => [])).map((t) => t.trim());
    await page.waitForTimeout(150);
  }
  assert(seen[0] === "log", `log is not offered first: ${seen.join(", ") || "nothing"}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type('("clicked", n)');
  await js.getByText("console.log", { exact: false }).first().waitFor({ timeout: 5000 });
  const text = (await js.innerText()).replace(/\s+/g, " ");
  assert(text.includes('console.log("clicked", untrack(n));') && !text.includes("__"), `log in the view:\n${text}`);
  await page.locator("a[data-testid=open-solid]").waitFor({ timeout: 5000 });
});

await check("a server fn reads as a \"use server\" function, its awaits and imports as written", async () => {
  await type(`import pure { findUser } from "./db"\n\nserver fn loadUser(id: number) {\n  let row = await findUser(id)\n  return { id, name: row.name }\n}\n\nexport default component App() {\n  source id := 1\n  user = await loadUser(id)\n  {errored fallback(e) { <p>{e.message}</p> } {\n    {loading fallback { <p>Loading</p> } {\n      <p>{user.name}</p>\n    }}\n  }}\n}\n`);
  await js.getByText("use server", { exact: false }).first().waitFor({ timeout: 5000 });
  const text = (await js.innerText()).replace(/\s+/g, " ");
  assert(text.includes('async function loadUser(id) { "use server";') && text.includes("let row = await findUser(id);"), `the server fn:\n${text}`);
  assert(text.includes("createMemo(() => loadUser(id()))") && !text.includes("__rt") && !text.includes("sf$") && !text.includes("setFindUser"), `what is left of the runtime:\n${text}`);
});

await check("a fallback with no error name and a branch with its own names show no placeholders", async () => {
  await type(`import pure { fetchUser } from "./users"\n\nexport default component App() {\n  source show := true\n  source id := 1\n  {errored fallback { <p>Failed</p> } {\n    {if show {\n      user = await fetchUser(id)\n      {loading fallback { <p>Loading</p> } { <p>{user.name}</p> }}\n    }}\n  }}\n}\n`);
  await js.getByText("Failed", { exact: false }).first().waitFor({ timeout: 5000 });
  const text = (await js.innerText()).replace(/\s+/g, " ");
  assert(text.includes("<Errored fallback={<p>Failed</p>}>") && text.includes("{() => {"), `the placeholders:\n${text}`);
  assert(!text.includes("__err") && !text.includes("__item"), `a placeholder is left:\n${text}`);
});

await check("no uncaught page errors", async () => {
  assert(pageErrors.length === 0, pageErrors.join("\n"));
});

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
