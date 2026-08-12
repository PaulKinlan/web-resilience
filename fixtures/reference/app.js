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
  if (document.readyState === "complete") status.textContent = "App loaded.";
})();
