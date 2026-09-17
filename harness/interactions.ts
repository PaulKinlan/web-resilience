// interactions.ts — interaction test plans: DOM-derived flows, user-described
// steps, and Chrome DevTools recorder macros.
//
// Loading a page tests a fraction of a site's resilience. The failures that
// matter — a checkout that hangs when a third party dies, a form that loses
// its draft when the tab is frozen — only appear once someone interacts. This
// module turns a flow into steps the harness can drive inside any scenario.
//
// Two deliberate design choices:
//
//  1. Steps run ONE AT A TIME from the harness, not as a single injected
//     script. A single script tells you only "the flow threw"; stepping tells
//     you WHICH step broke, how long it took, and (via the caller) what
//     network/console damage happened during it.
//  2. Clicks dispatch real CDP input events at the element's coordinates,
//     rather than calling el.click(). Under failure conditions the interesting
//     bug is often an invisible overlay, a zero-size button, or an element
//     scrolled out of reach — el.click() sails straight through all three.

export type StepKind =
  | "click"
  | "type"
  | "submit"
  | "navigate"
  | "wait"
  | "wait-for"
  | "press"
  | "scroll"
  | "hover"
  | "assert-text";

export interface InteractionStep {
  kind: StepKind;
  /** CSS, or `text=...` / `aria/...` (recorder-style). */
  selector?: string;
  /** Expected text for assert-text; typed text for `type`. */
  text?: string;
  value?: string;
  url?: string;
  ms?: number;
  /** Key name for `press`, e.g. "Enter", "Tab", "Escape". */
  key?: string;
  /** A failing optional step is recorded but does not abort the plan. */
  optional?: boolean;
  label?: string;
}

export interface InteractionPlan {
  name: string;
  steps: InteractionStep[];
}

export interface StepResult {
  index: number;
  kind: StepKind;
  label: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
  detail?: unknown;
}

export interface PlanResult {
  plan: string;
  completed: boolean;
  steps: StepResult[];
  /** Index of the step that aborted the plan, if any. */
  failedAt: number | null;
}

export type Session = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const DEFAULT_STEP_TIMEOUT_MS = 5000;

/**
 * Page-side selector resolver, shared by every step. Supports the selector
 * flavours the DevTools recorder emits so an exported macro works unmodified.
 */
const RESOLVER = `
  (sel) => {
    if (!sel) return null;
    // "text=" is our format; "text/" is what the DevTools Recorder exports.
    if (sel.startsWith("text=") || sel.startsWith("text/")) {
      const needle = sel.slice(5).trim().toLowerCase();
      const candidates = document.querySelectorAll("button, a, [role=button], input[type=submit], summary, label");
      for (const el of candidates) {
        if ((el.innerText || el.value || "").trim().toLowerCase().includes(needle)) return el;
      }
      return null;
    }
    if (sel.startsWith("aria/")) {
      const needle = sel.slice(5).trim().toLowerCase();
      for (const el of document.querySelectorAll("*")) {
        const name = (el.getAttribute("aria-label") || el.innerText || "").trim().toLowerCase();
        if (name === needle) return el;
      }
      return null;
    }
    if (sel.startsWith("xpath/")) {
      const r = document.evaluate(sel.slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue;
    }
    if (sel.startsWith("pierce/")) sel = sel.slice(7);
    // An unparseable selector should read as "not found", not throw.
    try { return document.querySelector(sel); } catch { return null; }
  }
`;

/** Run a plan step by step against an attached page session. */
export async function runPlan(
  sess: Session,
  plan: InteractionPlan,
  options: {
    stepTimeoutMs?: number;
    /**
     * Called after each step. Lets the caller attribute network failures and
     * console errors to the step that provoked them, which is the difference
     * between "the flow broke" and "clicking Checkout killed the payment SDK".
     */
    onStepComplete?: (result: StepResult) => void;
  } = {},
): Promise<PlanResult> {
  const steps: StepResult[] = [];
  let failedAt: number | null = null;

  for (const [index, step] of plan.steps.entries()) {
    const startedAt = performance.now();
    let ok = true;
    let error: string | null = null;
    let detail: unknown;

    try {
      detail = await runStep(sess, step, options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);
    } catch (thrown) {
      ok = false;
      error = String(thrown instanceof Error ? thrown.message : thrown);
    }

    const result: StepResult = {
      index,
      kind: step.kind,
      label: step.label ?? describe(step),
      ok,
      durationMs: Math.round(performance.now() - startedAt),
      error,
      detail,
    };
    steps.push(result);
    options.onStepComplete?.(result);

    if (!ok && !step.optional) {
      failedAt = index;
      break;
    }
  }

  return { plan: plan.name, completed: failedAt === null, steps, failedAt };
}


function describe(step: InteractionStep): string {
  switch (step.kind) {
    case "navigate":
      return `navigate ${step.url}`;
    case "wait":
      return `wait ${step.ms ?? 800}ms`;
    case "press":
      return `press ${step.key}`;
    case "assert-text":
      return `assert text "${step.text}"`;
    default:
      return `${step.kind} ${step.selector ?? ""}`.trim();
  }
}

async function runStep(
  sess: Session,
  step: InteractionStep,
  timeoutMs: number,
): Promise<unknown> {
  switch (step.kind) {
    case "wait":
      await sleep(step.ms ?? 800);
      return null;

    case "navigate": {
      await sess("Page.navigate", { url: step.url });
      await waitFor(sess, `document.readyState === "complete"`, timeoutMs);
      return null;
    }

    case "wait-for":
      await waitFor(
        sess,
        `!!(${RESOLVER})(${JSON.stringify(step.selector ?? "")})`,
        step.ms ?? timeoutMs,
      );
      return null;

    case "assert-text": {
      const needle = step.text ?? "";
      const found = await evaluateBoolean(
        sess,
        `document.body ? document.body.innerText.includes(${JSON.stringify(needle)}) : false`,
      );
      if (!found) throw new Error(`text not found: ${needle}`);
      return { found: true };
    }

    case "type": {
      const value = step.value ?? step.text ?? "";
      return await evaluateJson(
        sess,
        `(() => {
          const el = (${RESOLVER})(${JSON.stringify(step.selector ?? "")});
          if (!el) throw new Error("no element for ${escapeForMessage(step.selector)}");
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
          // React and friends subscribe to the native setter; assigning the
          // property directly leaves their state stale and the step lies.
          setter ? setter.call(el, ${JSON.stringify(value)}) : (el.value = ${JSON.stringify(value)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { value: el.value };
        })()`,
      );
    }

    case "submit":
      return await evaluateJson(
        sess,
        `(() => {
          const el = (${RESOLVER})(${JSON.stringify(step.selector ?? "form")});
          if (!el) throw new Error("no element for ${escapeForMessage(step.selector)}");
          const form = el.tagName === "FORM" ? el : el.closest("form");
          if (!form) throw new Error("element is not inside a form");
          form.requestSubmit ? form.requestSubmit() : form.submit();
          return { submitted: true };
        })()`,
      );

    case "scroll":
      return await evaluateJson(
        sess,
        step.selector
          ? `(() => {
              const el = (${RESOLVER})(${JSON.stringify(step.selector)});
              if (!el) throw new Error("no element for ${escapeForMessage(step.selector)}");
              el.scrollIntoView({ block: "center" });
              return { scrolled: true };
            })()`
          : `(() => { window.scrollBy(0, ${step.ms ?? 500}); return { scrolled: true }; })()`,
      );

    case "press": {
      const key = step.key ?? "Enter";
      // Real key events, so handlers bound to keydown/keypress actually fire.
      for (const type of ["keyDown", "keyUp"]) {
        await sess("Input.dispatchKeyEvent", {
          type,
          key,
          code: key,
          windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Tab" ? 9 : 0,
          text: key === "Enter" ? "\r" : undefined,
        });
      }
      return { key };
    }

    case "hover":
    case "click": {
      const box = await elementBox(sess, step.selector ?? "");
      if (step.kind === "hover") {
        await sess("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: box.x,
          y: box.y,
          button: "none",
        });
        return box;
      }
      // Real input events: a transparent overlay, a zero-size target or an
      // off-screen element all fail here, and all are invisible to el.click().
      await sess("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: box.x,
        y: box.y,
        button: "none",
      });
      for (const type of ["mousePressed", "mouseReleased"]) {
        await sess("Input.dispatchMouseEvent", {
          type,
          x: box.x,
          y: box.y,
          button: "left",
          clickCount: 1,
        });
      }
      await sleep(200);
      return box;
    }
  }
}

/**
 * Resolve an element to click coordinates, scrolling it into view first.
 * Throws with a specific reason — "not rendered", "zero size", "covered by
 * another element" are three different findings, not one generic failure.
 */
async function elementBox(
  sess: Session,
  selector: string,
): Promise<{ x: number; y: number; covered: boolean }> {
  const result = await evaluateJson(
    sess,
    `(() => {
      const el = (${RESOLVER})(${JSON.stringify(selector)});
      if (!el) throw new Error("no element for ${escapeForMessage(selector)}");
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) throw new Error("element has zero size (hidden or unstyled)");
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) throw new Error("element is outside the viewport after scrolling");
      const atPoint = document.elementFromPoint(x, y);
      const covered = !!atPoint && atPoint !== el && !el.contains(atPoint);
      return { x, y, covered, coveredBy: covered ? (atPoint.tagName + (atPoint.className ? "." + String(atPoint.className).split(" ")[0] : "")) : null };
    })()`,
  ) as { x: number; y: number; covered: boolean; coveredBy: string | null };

  if (result.covered) {
    throw new Error(
      `element is covered by ${result.coveredBy ?? "another element"} — the click would not reach it`,
    );
  }
  return result;
}

async function evaluateJson(sess: Session, expression: string): Promise<unknown> {
  const response = await sess("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const thrown = response.exceptionDetails as
    | { exception?: { description?: string }; text?: string }
    | undefined;
  if (thrown) {
    throw new Error(
      thrown.exception?.description?.split("\n")[0] ?? thrown.text ?? "evaluation failed",
    );
  }
  return (response.result as { value?: unknown })?.value;
}

async function evaluateBoolean(sess: Session, expression: string): Promise<boolean> {
  return Boolean(await evaluateJson(sess, expression));
}

async function waitFor(sess: Session, expression: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluateBoolean(sess, expression)) return;
    } catch {
      // Target mid-navigation; keep polling until the deadline.
    }
    await sleep(150);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${expression.slice(0, 80)}`);
}

function escapeForMessage(selector: string | undefined): string {
  return (selector ?? "").replace(/["\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Chrome DevTools Recorder import
// ---------------------------------------------------------------------------

interface RecorderStep {
  type: string;
  url?: string;
  value?: string;
  key?: string;
  selectors?: Array<string | string[]>;
  timeout?: number;
  count?: number;
  expression?: string;
}

/**
 * Convert a DevTools Recorder export into a plan.
 *
 * Recorder selectors come as a ranked array (aria/, CSS, xpath/, pierce/). We
 * keep the recorder's own ordering preference but skip xpath, which is the
 * most brittle under the DOM changes a failure scenario provokes.
 */
export function importRecorderMacro(
  raw: string | { title?: string; steps?: RecorderStep[] },
): InteractionPlan {
  const macro = typeof raw === "string" ? JSON.parse(raw) : raw;
  const steps: InteractionStep[] = [];

  for (const step of macro.steps ?? []) {
    const selector = pickSelector(step.selectors);
    switch (step.type) {
      case "navigate":
        steps.push({ kind: "navigate", url: step.url });
        break;
      case "click":
      case "doubleClick":
        if (selector) steps.push({ kind: "click", selector });
        break;
      case "hover":
        if (selector) steps.push({ kind: "hover", selector, optional: true });
        break;
      case "change":
        if (selector) steps.push({ kind: "type", selector, value: step.value ?? "" });
        break;
      case "keyDown":
        // keyUp is the mirror of keyDown; emitting both would double-press.
        if (step.key && MEANINGFUL_KEYS.has(step.key)) {
          steps.push({ kind: "press", key: step.key });
        }
        break;
      case "scroll":
        steps.push({ kind: "scroll", selector });
        break;
      case "waitForElement":
        if (selector) {
          steps.push({ kind: "wait-for", selector, ms: step.timeout ?? 5000 });
        }
        break;
      case "setViewport":
      case "close":
      case "waitForExpression":
        // setViewport is the harness's job (scenarios own emulation); close
        // and waitForExpression have no meaning inside a scenario run.
        break;
    }
  }

  return { name: macro.title ?? "recorder-macro", steps };
}

/** Keys worth replaying; modifiers and character keys are covered by `change`. */
const MEANINGFUL_KEYS = new Set(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"]);

function pickSelector(
  selectors: Array<string | string[]> | undefined,
): string | undefined {
  if (!selectors?.length) return undefined;
  // Each entry is a string, or an array describing a shadow-DOM path; we take
  // the deepest segment, which is the element itself.
  const flat = selectors
    .map((s) => (Array.isArray(s) ? s[s.length - 1] : s))
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  return flat.find((s) => !s.startsWith("xpath/")) ?? flat[0];
}

// ---------------------------------------------------------------------------
// DOM-derived flows
// ---------------------------------------------------------------------------

/** Page-side survey of the interactive surface. */
export const DERIVE_DOM_FLOW = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (testId) return "[data-testid=" + JSON.stringify(testId) + "]";
    const text = (el.innerText || el.value || "").trim().slice(0, 40);
    return text ? "text=" + text : el.tagName.toLowerCase();
  };
  const forms = [...document.querySelectorAll("form")].filter(visible).slice(0, 3).map((f) => ({
    selector: describe(f),
    fields: [...f.querySelectorAll("input, textarea, select")]
      .filter((i) => !["hidden", "submit", "button"].includes(i.type))
      .slice(0, 6)
      .map((i) => ({ selector: describe(i), type: i.type || "text", name: i.name || null })),
    submit: (() => {
      const b = f.querySelector("button[type=submit], input[type=submit], button:not([type])");
      return b ? describe(b) : null;
    })(),
  }));
  const buttons = [...document.querySelectorAll("button, [role=button]")]
    .filter(visible)
    .filter((b) => b.type !== "submit")
    .slice(0, 8)
    .map((b) => ({ selector: describe(b), text: (b.innerText || "").trim().slice(0, 40) }));
  const links = [...document.querySelectorAll("a[href]")]
    .filter(visible)
    .filter((a) => { const h = a.getAttribute("href"); return h && !h.startsWith("#") && !h.startsWith("mailto:"); })
    .slice(0, 8)
    .map((a) => ({ selector: describe(a), href: a.getAttribute("href"), text: (a.innerText || "").trim().slice(0, 40) }));
  return { forms, buttons, links };
})()`;

export interface DomSurvey {
  forms: Array<{
    selector: string;
    fields: Array<{ selector: string; type: string; name: string | null }>;
    submit: string | null;
  }>;
  buttons: Array<{ selector: string; text: string }>;
  links: Array<{ selector: string; href: string; text: string }>;
}

/** Survey the live DOM for interactive affordances. */
export async function surveyDom(sess: Session): Promise<DomSurvey> {
  const survey = await evaluateJson(sess, DERIVE_DOM_FLOW) as DomSurvey;
  return survey ?? { forms: [], buttons: [], links: [] };
}

/**
 * Build a plausible flow from the DOM when the user has not described one.
 *
 * This is a starting point, not a substitute for a real flow: it fills forms
 * with type-appropriate dummy data and exercises the first few controls. The
 * value is coverage beyond page load with zero configuration; a user-described
 * or recorded plan will always be better.
 */
export function derivePlan(survey: DomSurvey, name = "derived-dom-flow"): InteractionPlan {
  const steps: InteractionStep[] = [];

  for (const form of survey.forms.slice(0, 1)) {
    for (const field of form.fields) {
      steps.push({
        kind: "type",
        selector: field.selector,
        value: sampleValue(field.type, field.name),
        optional: true,
        label: `fill ${field.name ?? field.selector}`,
      });
    }
    if (form.submit) {
      steps.push({ kind: "click", selector: form.submit, label: "submit the form" });
      steps.push({ kind: "wait", ms: 1000 });
    }
  }

  for (const button of survey.buttons.slice(0, 3)) {
    steps.push({
      kind: "click",
      selector: button.selector,
      optional: true,
      label: `click "${button.text || button.selector}"`,
    });
    steps.push({ kind: "wait", ms: 400 });
  }

  return { name, steps };
}

function sampleValue(type: string, name: string | null): string {
  const hint = `${type} ${name ?? ""}`.toLowerCase();
  if (hint.includes("email")) return "resilience-probe@example.com";
  if (hint.includes("tel") || hint.includes("phone")) return "+441234567890";
  if (hint.includes("url")) return "https://example.com";
  if (hint.includes("number")) return "1";
  if (hint.includes("date")) return "2026-01-01";
  if (hint.includes("password")) return "Probe-Passw0rd!";
  if (hint.includes("search") || hint.includes("query")) return "test";
  return "resilience probe";
}

/** Load a plan file, accepting either our format or a recorder export. */
export function parsePlan(contents: string): InteractionPlan {
  const parsed = JSON.parse(contents);
  // Recorder exports have `steps[].type`; ours have `steps[].kind`.
  const looksLikeRecorder = Array.isArray(parsed.steps) &&
    parsed.steps.some((s: Record<string, unknown>) => typeof s.type === "string");
  return looksLikeRecorder ? importRecorderMacro(parsed) : parsed as InteractionPlan;
}
