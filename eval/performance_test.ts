import { assertEquals } from "@std/assert";
import { capturePerf } from "../harness/audit.ts";
import type { NavigationPerfMetrics } from "../harness/types.ts";

const empty = {
  metrics: {},
  nav: { fcp: null, lcp: null, cls: null, dcl: null, load: null },
  fcpMs: null,
  lcpMs: null,
  cls: null,
  domContentLoadedMs: null,
  loadMs: null,
};

Deno.test("performance report retains every raw metric and mirrors nav, including zero", async () => {
  const nav: NavigationPerfMetrics = { fcp: 12, lcp: 24, cls: 0, dcl: 8, load: 9 };
  const perf = await capturePerf((method) =>
    Promise.resolve(
      method === "Performance.getMetrics"
        ? {
          metrics: [{ name: "Timestamp", value: 42 }, { name: "FutureMetric", value: 0 }],
        }
        : { result: { value: nav } },
    )
  );
  assertEquals(perf, {
    metrics: { Timestamp: 42, FutureMetric: 0 },
    nav,
    fcpMs: 12,
    lcpMs: 24,
    cls: 0,
    domContentLoadedMs: 8,
    loadMs: 9,
  });
});

Deno.test("performance capture failure returns a complete null report, never measured zero", async () => {
  for (const failingMethod of ["Performance.getMetrics", "Runtime.evaluate"]) {
    const perf = await capturePerf((method) => {
      if (method === failingMethod) return Promise.reject(new Error("target gone"));
      return Promise.resolve({ metrics: [{ name: "Timestamp", value: 42 }] });
    });
    assertEquals(perf, empty);
  }
});

Deno.test("a page-side exception does not manufacture measured timings", async () => {
  const perf = await capturePerf((method) =>
    Promise.resolve(
      method === "Performance.getMetrics"
        ? { metrics: [] }
        : { result: { type: "object", subtype: "error" }, exceptionDetails: {} },
    )
  );
  assertEquals(perf, empty);
});
