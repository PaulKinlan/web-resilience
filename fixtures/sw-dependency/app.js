// sw-dependency fixture — an app that treats its service worker as permanent
// infrastructure.
//
// SEEDED ISSUES (deliberate; the rubric asserts these are found):
//
//  1. /sw-dependency/api/stock exists ONLY inside the service worker. The
//     origin has no such route, so the request 404s whenever the worker is
//     stopped, unregistered, or bypassed (a first-time visitor).
//  2. The failure is reported to the console but never to the user: the list
//     sits on "Checking stock…" indefinitely.
//  3. No cache versioning and no update path — the worker installs one cache
//     and never revalidates it, so a deployed change never reaches a returning
//     visitor. (Not observable in a single audit; documented here because it
//     is the defect people actually hit.)

(function () {
  "use strict";

  var status = document.getElementById("status");
  var list = document.getElementById("stock");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw-dependency/sw.js").catch(function () {
      // Swallowed: registration failure is invisible to the user.
    });
  }

  function loadStock() {
    // SEEDED ISSUE 1: no origin fallback for this route.
    fetch("/sw-dependency/api/stock")
      .then(function (response) {
        if (!response.ok) throw new Error("stock request failed: " + response.status);
        return response.json();
      })
      .then(function (items) {
        list.innerHTML = "";
        items.forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item.name + " — " + item.count + " in stock";
          list.appendChild(li);
        });
        status.textContent = "Stock up to date.";
      })
      .catch(function (error) {
        // SEEDED ISSUE 2: logged, never surfaced. The user keeps seeing
        // "Checking stock…" and has no idea anything went wrong.
        console.error(error);
      });
  }

  status.textContent = "App loaded.";
  loadStock();
})();
