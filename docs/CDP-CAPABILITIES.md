# Chrome DevTools Protocol: resilience surface (57 domains, Chrome 150)

What the browser engine can set / unset / disable / re-enable for failure-state
testing. Full schema: chrome --headless → http://127.0.0.1:PORT/json/protocol.

## Network failure injection
- Network.emulateNetworkConditions — offline, latency, download/uploadThroughput, connectionType
- Network.emulateNetworkConditionsByRule / overrideNetworkState — rule-based emulation
- Network.setBlockedURLs — block URL patterns (*.js, *.css, *.woff2...)
- Network.setCacheDisabled — no cache (cold start)
- Network.setBypassServiceWorker — bypass SW
- Network.setAcceptedEncodings — test gzip-only vs brotli servers
- Fetch.enable + Fetch.failRequest — fail ANY request with a specific errorReason:
  Failed, Aborted, TimedOut, AccessDenied, ConnectionClosed, ConnectionReset,
  ConnectionRefused, ConnectionAborted, ConnectionFailed, **NameNotResolved**,
  **InternetDisconnected**, AddressUnreachable, BlockedByClient, BlockedByResponse
  → NameNotResolved/InternetDisconnected = the Great-Firewall/DNS-interception case.
- Fetch.fulfillRequest / continueRequest / continueResponse — serve stub responses
- Fetch.getResponseBody / Network.getResponseBody — inspect what actually loaded

## Device & performance emulation
- Emulation.setCPUThrottlingRate (1x..20x) — INP/long-task testing
- Emulation.setVirtualTimePolicy — deterministic/fast virtual time
- Emulation.setHardwareConcurrencyOverride — navigator.hardwareConcurrency
- Emulation.setDeviceMetricsOverride — viewport/DPR/deviceScaleFactor
- Emulation.setUserAgentOverride — UA + platform + model
- Emulation.setNavigatorOverrides — platform
- Emulation.setTouchEmulationEnabled / setEmulatedMedia (prefers-reduced-motion) / setEmulatedVisionDeficiency
- Emulation.setIdleOverride — idle state
- Emulation.setDisabledImageTypes — force image decode failures
- Emulation.setDataSaverOverride / setDocumentCookieDisabled / setLocaleOverride / setTimezoneOverride / setSafeAreaInsetsOverride / setAutoDarkModeOverride

## Memory & lifecycle
- Memory.simulatePressureNotification({level:"critical"|"moderate"}) — the low-memory-device case
- Memory.setPressureNotificationsSuppressed
- Memory.prepareForLeakDetection + Memory.getDOMCountersForLeakDetection — leak detection
- Memory.forciblyPurgeJavaScriptMemory
- Page.crash — renderer crash (tab crash recovery)
- Browser.crash / Browser.crashGpuProcess
- Runtime.terminateExecution — runaway script kill
- Page.setWebLifecycleState(frozen/active) — aggressive backgrounding
- Page.setLifecycleEventsEnabled / setPrerenderingAllowed

## Asset-level control
- Page.setFontFamilies / setFontSizes — font metrics (swap testing)
- CSS.getPlatformFontsForNode — what font actually rendered
- CSS.startRuleUsageTracking / takeCoverageDelta — unused-CSS amplification
- Network.replayXHR

## Monitoring & capture
- Network.loadingFailed events — errorText, canceled, blockedReason, corsErrorStatus
- Log.startViolationsReport — long tasks, blocked URLs, layout thrash, etc.
- Performance.getMetrics / Runtime.exceptionThrown / Runtime.consoleAPICalled
- Page.javascriptDialogOpening — blocked dialogs
- Security.certificateError — cert issues
- Storage.overrideQuotaForOrigin — quota exhaustion
- Tracing.start — perf traces
- Audits.getEncodedResponse — image size checks
- SystemInfo.getInfo — device memory/CPU
- Browser.getHistograms / Memory.getDOMCounters — counters
- HeapProfiler (snapshots/retainers) — leak analysis

## Scenario cross-map (which domain powers which test)

| Domain | Scenarios |
|---|---|
| Network | offline, throttled-slow/2g, block-js/css/fonts, no-cache, sw-bypass |
| Fetch | dns-fail (NameNotResolved) |
| Emulation | cpu-6x/20x, hardware-concurrency, mobile, data-saver, cookies-blocked, vision-deficiency, reduced-motion, virtual-time, locale-rtl |
| Memory | memory-critical |
| Page | tab-crash, backgrounded |
| Browser | geolocation-denied, permissions-denied |
| Storage | storage-quota, storage-cleared |
| Security | cert-error |
| Runtime | runaway-script |
| Target | crash detection (all scenarios) |

Full matrix: TEST-MATRIX.md.

## Lifecycle/permission/storage misc
- Storage.clearDataForOrigin / overrideQuotaForOrigin / getUsageAndQuota
- Browser.setPermission / grantPermissions / resetPermissions
- Emulation.setGeolocationOverride / clearGeolocationOverride
- DeviceOrientation overrides / Emulation.setSensorOverride*
- ServiceWorker (start/stop/unregister/update) — SW testing
- Target.createBrowserContext — isolated contexts (multi-profile parallelism)
