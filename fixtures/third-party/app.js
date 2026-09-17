// third-party fixture — the first-party glue.
//
// SEEDED ISSUES (deliberate; the rubric asserts these are found):
//
//  1. No capability check before use. `confetti` comes from a CDN script; if
//     that script did not load, this throws an uncaught ReferenceError on
//     click rather than degrading.
//  2. No fallback and no messaging. The button stays enabled and looks
//     functional whether or not its dependency arrived.
(function () {
  "use strict";
  var status = document.getElementById("status");

  document.getElementById("celebrate").addEventListener("click", function () {
    // SEEDED ISSUE 1: `typeof confetti === "function"` is the check that is
    // missing. Blocked CDN -> uncaught ReferenceError, dead button.
    confetti({ particleCount: 80, spread: 60 });
    status.textContent = "Hooray!";
  });

  status.textContent = "App loaded.";
})();
