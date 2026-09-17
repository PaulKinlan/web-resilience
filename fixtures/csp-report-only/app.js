// csp-report-only fixture — the external script, which the policy permits.
//
// Its job is to make the contrast visible: everything in this file is
// 'self' and compliant, so when the policy is enforced THIS keeps working
// while the inline script in index.html stops. The page will look alive and
// be subtly broken.
(function () {
  "use strict";
  var status = document.getElementById("status");
  if (status) status.textContent = "Ready. (external script ran)";
})();
