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
  constructor(url: string, WebSocketImpl: typeof WebSocket = WebSocket) {
    this.#socket = new WebSocketImpl(url);
    this.#socket.onmessage = (event) => {
      const value = JSON.parse(String(event.data));
      if (!value.id) {
        if (typeof value.method === "string") {
          for (const listener of this.#listeners.get(value.method) ?? []) {
            try {
              listener(value.params ?? {}, value.sessionId);
            } catch {
              /* listener isolation */
            }
          }
        }
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
  }
  async ready(timeoutMs = 5_000): Promise<void> {
    if (this.#socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP socket timeout")), timeoutMs);
      this.#socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.#socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP socket error"));
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
      this.#socket.send(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
      );
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
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("CDP closed"));
    }
    this.#pending.clear();
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
