/**
 * Raised when the transport itself is gone, as opposed to a CDP command
 * failing. Callers use this to tell "the browser died" apart from "this
 * scenario's injection was rejected", which are very different findings.
 */
export class CdpSocketClosed extends Error {
  constructor(readonly detail: string) {
    super(`CDP socket closed: ${detail}`);
    this.name = "CdpSocketClosed";
  }
}

export class CdpClient {
  #socket: WebSocket;
  #next = 1;
  #pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: number }
  >();
  #listeners = new Map<
    string,
    Set<(params: Record<string, unknown>, sessionId?: string) => void>
  >();
  /**
   * Why the socket went away, once it has. Without this, a close mid-run
   * surfaced only as a 5s "CDP socket timeout" from a wait for an `open` event
   * that could never arrive — true, but useless for diagnosis.
   */
  #closedReason: string | null = null;
  /** Set by close(); distinguishes our teardown from Chrome vanishing. */
  #closedByUs = false;

  constructor(url: string, WebSocketImpl: typeof WebSocket = WebSocket) {
    this.#socket = new WebSocketImpl(url);
    this.#socket.onmessage = (event) => {
      const value = JSON.parse(String(event.data));
      if (!value.id) {
        if (typeof value.method === "string") this.#dispatch(value);
        return;
      }
      const pending = this.#pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(value.id);
      value.error
        ? pending.reject(new Error(value.error.message ?? "CDP error"))
        : pending.resolve(value.result);
    };
    this.#socket.onclose = (event) => {
      const code = (event as CloseEvent).code;
      const reason = (event as CloseEvent).reason;
      this.#fail(
        this.#closedByUs
          ? "closed by the harness"
          : `code ${code}${reason ? ` (${reason})` : ""}` +
            (code === 1006 ? " — Chrome exited or was killed" : ""),
      );
    };
    this.#socket.onerror = () => {
      // Deno gives us no detail here; onclose usually follows with a code.
      if (!this.#closedReason) this.#fail("transport error");
    };
  }

  /** Event delivery. Listeners may be async; a rejected listener promise used
   * to escape the synchronous try/catch and take the whole process down. */
  #dispatch(value: { method: string; params?: Record<string, unknown>; sessionId?: string }) {
    for (const listener of this.#listeners.get(value.method) ?? []) {
      try {
        const result = listener(value.params ?? {}, value.sessionId) as unknown;
        if (result instanceof Promise) result.catch(() => {});
      } catch {
        /* listener isolation */
      }
    }
  }

  /** Record the close reason and settle everything still in flight. */
  #fail(reason: string) {
    this.#closedReason = reason;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new CdpSocketClosed(reason));
    }
    this.#pending.clear();
  }

  get closed(): boolean {
    return this.#closedReason !== null;
  }

  async ready(timeoutMs = 5_000): Promise<void> {
    if (this.#socket.readyState === WebSocket.OPEN) return;
    // Fail fast rather than waiting for an `open` that cannot arrive.
    if (this.#closedReason !== null) throw new CdpSocketClosed(this.#closedReason);
    if (
      this.#socket.readyState === WebSocket.CLOSING ||
      this.#socket.readyState === WebSocket.CLOSED
    ) {
      throw new CdpSocketClosed("socket already closed");
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CdpSocketClosed(`no handshake within ${timeoutMs}ms`)),
        timeoutMs,
      );
      this.#socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.#socket.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new CdpSocketClosed(this.#closedReason ?? "closed during handshake"));
      }, { once: true });
      this.#socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpSocketClosed("transport error during handshake"));
      }, { once: true });
    });
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 5_000,
  ): Promise<Record<string, unknown>> {
    await this.ready(timeoutMs);
    const id = this.#next++;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, timeoutMs) as unknown as number;
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#socket.send(
          JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
        );
      } catch (error) {
        // Socket died between ready() and send(); settle now, don't wait out
        // the timeout.
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new CdpSocketClosed(String(error)));
      }
    });
  }

  on(
    method: string,
    listener: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void {
    const listeners = this.#listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close(): void {
    this.#closedByUs = true;
    this.#fail("closed by the harness");
    this.#socket.close();
  }
}
export async function browserWebSocketUrl(
  port: number,
  expectedBrowserPath: string,
): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { redirect: "error" });
  if (!response.ok) throw new Error("CDP version endpoint denied");
  const value = await response.json();
  if (typeof value.webSocketDebuggerUrl !== "string") throw new Error("CDP websocket missing");
  const url = new URL(value.webSocketDebuggerUrl);
  if (
    url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port ||
    url.pathname !== expectedBrowserPath || url.search || url.hash
  ) {
    throw new Error("CDP websocket identity mismatch");
  }
  return url.href;
}
