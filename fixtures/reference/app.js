// FIXED 3: progressive enhancement — every enhancement is feature-detected and
// isolated; a failure here never kills the core experience.
(function () {
  "use strict";
  const join = document.getElementById("join");
  const status = document.getElementById("status");
  if (!join || !status) return; // core works without JS
  try {
    join.addEventListener("click", () => {
      status.textContent = "Welcome!";
      if (!navigator.onLine) {
        status.textContent = "You're offline — we'll sync when you're back.";
        return;
      }
      void fetch("/api/join", { method: "POST", body: "{}" }).catch(() => {
        status.textContent = "Could not reach the server — try again later.";
      });
    });
    window.addEventListener("online", () => { status.textContent = "Back online."; });
    window.addEventListener("offline", () => { status.textContent = "You're offline — core features still work."; });
  } catch (err) {
    console.warn("enhancement failed:", err);
  }
  // Initialize the connectivity state at startup (not only on the event) so
  // the UI reflects it immediately, even when offline began pre-load.
  status.textContent = navigator.onLine ? "App loaded." : "You're offline — core features still work.";

  // Ask the network for something that is deliberately NOT precached. Under a
  // working connection this returns mode:"live"; when the network is gone the
  // service worker answers mode:"cached" instead. Without a probe like this an
  // offline load of an app-shell site is byte-identical to an online one, so
  // nothing can confirm the offline path was ever exercised.
  //
  // Note this does NOT use navigator.onLine, which is unreliable under CDP
  // network emulation — it reports the real host's connectivity, not the
  // emulated tab's. Reachability is the only trustworthy test.
  const connectivity = document.getElementById("connectivity");
  if (connectivity) {
    fetch("./api/live.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { mode: "cached" }))
      .then((d) => {
        connectivity.textContent = d.mode === "live"
          ? "Live data."
          : "Showing cached data.";
      })
      .catch(() => { connectivity.textContent = "Showing cached data."; });
  }

  // Permission-aware feature (guide: permission-denial-handling): pre-check
  // state, degrade on denial, never an unhandled rejection.
  const camera = document.getElementById("camera");
  if (camera) {
    (async () => {
      try {
        const st = await navigator.permissions.query({ name: "camera" });
        camera.textContent = st.state === "denied"
          ? "Camera unavailable (denied)"
          : st.state === "prompt" ? "Use camera (asks first)" : "Use camera";
        st.onchange = () => { camera.textContent = st.state === "denied" ? "Camera unavailable (denied)" : "Use camera"; };
      } catch {
        camera.textContent = "Use camera";
      }
      camera.addEventListener("click", async () => {
        if (!navigator.mediaDevices) { status.textContent = "Camera unsupported here."; return; }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          status.textContent = "Camera on.";
          stream.getTracks().forEach((t) => t.stop());
        } catch (err) {
          status.textContent = err.name === "NotAllowedError"
            ? "Camera denied — that's fine, everything else works."
            : "Camera unavailable.";
        }
      });
    })();
  }
})();
