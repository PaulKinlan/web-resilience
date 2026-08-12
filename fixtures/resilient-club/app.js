// SEEDED ISSUE 3: the whole app lives in one bundle and it throws at the top
// level — if this fails to load (offline, blocked, DNS fail), the button is dead
// AND nothing else initializes (no progressive enhancement).
(function () {
  "use strict";
  if (!window.fetch) throw new Error("no fetch");
  const join = document.getElementById("join");
  const status = document.getElementById("status");
  join.addEventListener("click", () => {
    status.textContent = "Welcome!";
    // would POST membership server-side — a network call that must not crash the UI
    void fetch("/api/join", { method: "POST", body: "{}" }).catch(() => {
      status.textContent = "Could not reach the server — try again later.";
    });
  });
  status.textContent = "App loaded.";
})();
