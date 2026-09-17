// SPA hydration fixture — the client-rendered app.
//
// SEEDED ISSUES (deliberate; the rubric asserts these are found):
//
//  1. Content exists only if this file runs. There is no server-rendered HTML
//     and no <noscript>, so block-js / offline / dns-fail all leave the user on
//     the spinner with no explanation.
//  2. The route data is fetched with no timeout, no retry and no error branch
//     that reaches the UI. A failed fetch leaves the spinner up permanently —
//     the failure is indistinguishable from slowness.
//  3. There is no service worker, so nothing survives a lost connection.

(function () {
  "use strict";

  var ROUTES = {
    "/spa-hydration/": { title: "Your ledger", body: "Balance: 412.80 GBP across 3 accounts." },
    "/spa-hydration/item/42": { title: "Entry 42", body: "Coffee subscription — 9.00 GBP, monthly." },
    "/spa-hydration/settings": { title: "Settings", body: "Statements are delivered monthly." },
  };

  function render(route) {
    var root = document.getElementById("root");
    root.innerHTML = "";

    var heading = document.createElement("h1");
    heading.textContent = route.title;

    var body = document.createElement("p");
    body.id = "entry-body";
    body.textContent = route.body;

    var nav = document.createElement("nav");
    Object.keys(ROUTES).forEach(function (path) {
      var link = document.createElement("a");
      link.href = path;
      link.textContent = ROUTES[path].title;
      link.addEventListener("click", function (event) {
        event.preventDefault();
        history.pushState({}, "", path);
        render(ROUTES[path]);
      });
      nav.appendChild(link);
    });

    root.appendChild(heading);
    root.appendChild(body);
    root.appendChild(nav);
  }

  function start() {
    var route = ROUTES[location.pathname] || ROUTES["/spa-hydration/"];

    // SEEDED ISSUE 2: no timeout, no retry, and the catch never tells the user
    // anything. Offline, the spinner simply stays up.
    fetch("/spa-hydration/session.json")
      .then(function (response) { return response.json(); })
      .then(function () { render(route); })
      .catch(function () {
        // Swallowed. The user sees the spinner forever.
      });
  }

  addEventListener("popstate", function () {
    render(ROUTES[location.pathname] || ROUTES["/spa-hydration/"]);
  });

  start();
})();
