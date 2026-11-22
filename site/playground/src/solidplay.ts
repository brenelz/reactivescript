// The Solid view as a program playground.solidjs.com can run: its tabs, in the URL hash it imports from.
import { compressToURL } from "@amoutonbrady/lz-string";

export const SOLID_PLAYGROUND = "https://playground.solidjs.com/";

export type Tab = { name: string; source: string };

/** A `.d.rx` with no module beside it: its names, so the program loads, each saying why it cannot run. */
function stub(name: string, rx: string) {
  const why = (id: string) => `${id} is declared in ${name} and has no implementation in this program`;
  const fns = [...rx.matchAll(/^export\s+(?:pure\s+)?fn\s+([A-Za-z_$][\w$]*)/gm)].map(([, id]) => `export function ${id}(...args: any[]): any {\n  throw new Error(${JSON.stringify(why(id))});\n}`);
  const errors = [...rx.matchAll(/^export\s+error\s+([A-Za-z_$][\w$]*)/gm)].map(([, id]) => `export class ${id} extends Error {}`);
  return [`// ${name} declares these; write their bodies here.`, ...fns, ...errors].join("\n") + "\n";
}

/**
 * The tabs for a program's Solid view, or why there are none. The view is a reading aid: it runs as Solid only once
 * nothing in it still needs the compiler's runtime.
 */
export function solidTabs(modules: { path: string; code: string }[], files: Record<string, string>, css = ""): { tabs?: Tab[]; why?: string } {
  const entry = modules.find((m) => m.path === "/main.rx");
  if (!entry) return { why: "nothing has compiled yet" };
  if (modules.some((m) => /\b__rt\b|\b__B\b/.test(m.code))) return { why: "this program uses a form the Solid view cannot write without the compiler's runtime" };
  const mounted = /^export default ([A-Za-z_$][\w$]*);\s*$/m.exec(entry.code);
  if (!mounted) return { why: "the Solid view has no default component to mount" };
  // the <style> blocks are not in the view: the compiler's scoped CSS goes in beside it, or the classes mean nothing
  const styles = css.trim() ? `\n// the program's <style> blocks, as the compiler scoped them\ndocument.head.append(Object.assign(document.createElement("style"), { textContent: ${JSON.stringify(css.trim())} }));\n` : "";
  const main = `import { render } from "@solidjs/web";\n${entry.code.replace(mounted[0], "").trimEnd()}\n${styles}\nrender(() => <${mounted[1]} />, document.getElementById("app")!);\n`;
  const tabs: Tab[] = [{ name: "main.tsx", source: main }];
  for (const m of modules) if (m !== entry) tabs.push({ name: m.path.replace(/^\//, "").replace(/\.rx$/, ".tsx"), source: m.code });
  // an import without an extension finds a tab named .tsx or .jsx, and no other
  const plain = Object.keys(files).filter((f) => !f.endsWith(".rx"));
  for (const f of plain) tabs.push({ name: f.replace(/\.m?js$/, ".jsx").replace(/\.ts$/, ".tsx"), source: files[f] });
  for (const f of Object.keys(files).filter((x) => x.endsWith(".d.rx"))) {
    const base = f.slice(0, -5);
    if (!plain.some((p) => p.replace(/\.(m?js|tsx?)$/, "") === base)) tabs.push({ name: `${base}.tsx`, source: stub(f, files[f]) });
  }
  // a relative import with no tab behind it would fail there, where nothing says which program it came from
  const have = new Set(tabs.map((t) => t.name.replace(/\.(m?jsx?|tsx?)$/, "")));
  for (const t of tabs)
    for (const [, from] of t.source.matchAll(/\bfrom\s+["']\.\/([^"']+)["']/g))
      if (!have.has(from.replace(/\.(m?jsx?|tsx?)$/, ""))) return { why: `it imports ./${from}, and this program has no module of that name` };
  return { tabs };
}

export const solidPlaygroundUrl = (tabs: Tab[]) => `${SOLID_PLAYGROUND}#${compressToURL(JSON.stringify(tabs))}`;
