// interactions.ts — interaction test plans: DOM-derived flows, user-described
// steps, and Chrome DevTools recorder macros (a subset of the exported JSON).
//
// The audit skill can auto-derive a flow (analyze the DOM: forms, buttons,
// links, app-shell navigation) or accept a user-described plan. Each step is a
// {kind, selector|text, optional} entry driven via Runtime.evaluate.

export interface InteractionStep {
  kind: "click" | "type" | "submit" | "navigate" | "wait" | "assert-text";
  selector?: string; // CSS selector for click/type/submit/assert-text
  text?: string; // text to type, or expected text for assert-text
  value?: string; // value for type
  url?: string; // for navigate
  ms?: number; // for wait
}

export interface InteractionPlan {
  name: string;
  steps: InteractionStep[];
}

/** Auto-derive a likely-user-flow plan from the DOM (run on the page session). */
export const DERIVE_DOM_FLOW = `(() => {
  const out = { forms: [], buttons: [], links: [], appShell: null };
  out.forms = [...document.querySelectorAll("form")].map((f) => f.id || f.action || "form").slice(0, 5);
  out.buttons = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 10);
  out.links = [...document.querySelectorAll("a[href]")].map((a) => ({ text: a.textContent.trim().slice(0, 40), href: a.getAttribute("href") })).slice(0, 10);
  return out;
})()`;

/** Convert a plan to a script that runs in the page (returns findings). */
export function planToScript(plan: InteractionPlan): string {
  const steps = plan.steps.map((s, i) => {
    switch (s.kind) {
      case "click":
        return `await click("${esc(s.selector ?? "")}");`;
      case "type":
        return `await typeInto("${esc(s.selector ?? "")}", ${JSON.stringify(s.value ?? "")});`;
      case "submit":
        return `await submit("${esc(s.selector ?? "")}");`;
      case "navigate":
        return `location.href = ${JSON.stringify(s.url ?? "/")}; await sleep(1500);`;
      case "wait":
        return `await sleep(${s.ms ?? 800});`;
      case "assert-text":
        return `findings.push({ step: ${i}, kind: "assert-text", ok: document.body.innerText.includes(${JSON.stringify(s.text ?? "")}), target: ${JSON.stringify(s.text ?? "")} });`;
    }
  });
  return `(async () => {
    const findings = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = (sel) => { const e = document.querySelector(sel); if (!e) throw new Error("missing " + sel); return e; };
    const click = async (sel) => { el(sel).click(); await sleep(200); };
    const typeInto = async (sel, v) => { const e = el(sel); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150); };
    const submit = async (sel) => { el(sel).closest("form").requestSubmit(); await sleep(600); };
    ${steps.join("\n    ")}
    return findings;
  })()`;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
