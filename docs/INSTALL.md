# Install

The harness needs two things: **Deno** (to run the TypeScript) and **a Chrome
binary that will expose a DevTools port**. Everything else is resolved for you.

```bash
git clone https://github.com/PaulKinlan/web-resilience
cd web-resilience
./bin/wr doctor
```

`doctor` is the contract. It checks Deno, locates Chrome, and then actually
launches it and completes a CDP handshake — because "Chrome is installed" and
"Chrome will let you drive it" are different questions on a managed machine.

```
web-resilience doctor

✓ deno: 2.9.0 (aarch64-apple-darwin)
✓ harness home: /Users/you/Code/web-resilience
✓ chrome: ~/.cache/puppeteer/chrome/mac_arm-149.0.7827.22/... (via chrome-for-testing)
✓ cdp handshake: Chrome/149.0.7827.22

Ready to audit.
```

## Antigravity / Jetski

```bash
./antigravity/install.sh
```

This symlinks `~/.gemini/config/plugins/web-resilience-plugin` at the checkout,
then runs `doctor` to prove the harness works before claiming success. Restart
Antigravity (or start a new conversation) and both skills are discoverable:

- `web-resilience-audit` — run the failure matrix, produce findings
- `web-resilience-fix` — remediate, re-audit, report the delta

Because it is a symlink, `git pull` updates the installed plugin. There is one
copy of every `SKILL.md` in the repo; `antigravity/skills` is a relative
symlink to `../skills`.

If your machine policies symlinks inside the config directory:

```bash
./antigravity/install.sh --copy
```

Copy mode duplicates the plugin metadata and skills, but deliberately does
**not** copy the harness — it installs a launcher shim that execs the harness
from your checkout. A copied harness would silently go stale.

Uninstall with `./antigravity/install.sh --uninstall`.

### Other agent harnesses

The skills are plain markdown with YAML frontmatter, so they also drop into
Claude Code (`~/.claude/skills/`) or any tool that reads the same convention.
Point `WEB_RESILIENCE_HOME` at the checkout and the documented `wr` path
resolves correctly regardless of where the skill file lives.

## Corporate / managed machines

This is the environment the install path was designed around.

### Deno

`bin/wr` finds Deno even when it is not on a non-interactive shell's `PATH` —
the official installer appends to `.zshrc`, which agent shells never read. It
checks `$DENO`, `PATH`, `~/.deno/bin`, Homebrew, `/usr/local/bin`,
`~/.local/bin` and `/usr/bin`, in that order.

If Deno cannot be installed system-wide, a user-local install is enough:

```bash
curl -fsSL https://deno.land/install.sh | sh     # installs to ~/.deno
export DENO=/path/to/deno                        # or point at any binary
```

### Chrome, and the policy that breaks CDP

> [!IMPORTANT]
> Managed Chrome can be configured with `RemoteDebuggingAllowed=false`. Under
> that policy Chrome starts normally but never opens a DevTools port, so the
> harness cannot drive it. No amount of flags will work around it — the policy
> is attached to the branded browser.

The mitigation is to use a **Chrome for Testing** build, which is a separate
binary and therefore outside the managed browser's policy scope:

```bash
npx @puppeteer/browsers install chrome@stable
export WR_CHROME="$(pwd)/chrome/<platform>-<version>/.../Google Chrome for Testing"
```

`env.ts` already prefers Chrome for Testing when it finds one in a puppeteer
cache, so if you have ever run Puppeteer or `chrome-devtools-mcp` on the
machine, the harness will likely pick it up with no configuration at all.

Chrome resolution order:

| Order | Source | Policy managed? |
|---|---|---|
| 1 | `WR_CHROME` | depends on what you point at |
| 2 | `CHROME_PATH` | depends on what you point at |
| 3 | Chrome for Testing / headless-shell in the puppeteer cache | no |
| 4 | Installed Chrome / Chromium / Edge | yes |

### Other things that bite on locked-down machines

- **Sandbox**: the harness passes `--no-sandbox`. If an EDR agent objects,
  the audit will fail at launch and `doctor` will show the Chrome output.
- **Network egress**: auditing an external URL needs egress to that host.
  Local fixtures (`wr serve`) need none — a good first smoke test.
- **Temp directories**: reports default to `/tmp`; pass `--out` to redirect if
  `/tmp` is noexec or monitored.

## Verify the install

```bash
wr serve 8080 &                                          # local fixtures
./bin/wr audit http://127.0.0.1:8080/reference/ --scenario offline --prime
./bin/wr eval http://127.0.0.1:8080/reference/ eval/rubrics/reference.json
```

The reference fixture is resilient by construction, so `offline` should still
navigate (its service worker shell serves the page) and the eval should report
no false positives.
