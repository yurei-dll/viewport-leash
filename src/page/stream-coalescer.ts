/**
 * ChatGPT's stream updates can invalidate expensive whole-conversation
 * selectors. Coalesce its same-origin POST/SSE response chunks before they
 * reach the app, so it performs fewer state updates without losing bytes or
 * changing SSE framing.
 *
 * This deliberately lives in the page's MAIN world and must not use extension
 * APIs. The page can inspect or replace it, so it stores no sensitive data.
 */

const SETTING_KEY = "viewport-leash-stream-coalescing-ms";
const DEFAULT_INTERVAL_MS = 150;
const MAX_BUFFERED_BYTES = 64 * 1024;
const INSTALL_FLAG = "__viewportLeashStreamCoalescerInstalled";
const DIAGNOSTICS_ATTRIBUTE = "data-viewport-leash-stream-diagnostics";
const DIAGNOSTICS_REQUEST_EVENT = "viewport-leash:request-stream-diagnostics";

export {};

interface StreamCoalescerDiagnostics {
  intervalMs: number;
  eligibleResponses: number;
  chunksReceived: number;
  flushes: number;
  bytesForwarded: number;
  recentSameOriginPosts: StreamResponseSummary[];
}

interface StreamResponseSummary {
  path: string;
  status: number;
  contentType: string | null;
  intercepted: boolean;
}

declare global {
  interface Window {
    __viewportLeashStreamCoalescerInstalled?: boolean;
    __viewportLeashStreamCoalescerDiagnostics?: () => Readonly<StreamCoalescerDiagnostics>;
  }
}

function intervalMs(): number {
  try {
    const configured = Number.parseInt(localStorage.getItem(SETTING_KEY) ?? "", 10);
    if (Number.isFinite(configured)) {
      return Math.max(0, Math.min(configured, 1_000));
    }
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }

  return DEFAULT_INTERVAL_MS;
}

function isSameOriginPost(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method.toUpperCase() !== "POST") {
    return false;
  }

  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function requestPath(input: RequestInfo | URL): string {
  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return "<unparseable>";
  }
}

function coalesce(body: ReadableStream<Uint8Array>, delayMs: number, diagnostics: StreamCoalescerDiagnostics): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let queued: Uint8Array[] = [];
      let queuedBytes = 0;

      const flush = () => {
        timer = null;
        if (queuedBytes === 0 || cancelled) {
          return;
        }

        const output = queued.length === 1 ? queued[0] : join(queued, queuedBytes);
        queued = [];
        queuedBytes = 0;
        diagnostics.flushes += 1;
        diagnostics.bytesForwarded += output.byteLength;
        controller.enqueue(output);
      };

      const pump = async () => {
        try {
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) {
              flush();
              controller.close();
              return;
            }

            queued.push(value);
            queuedBytes += value.byteLength;
            diagnostics.chunksReceived += 1;
            if (queuedBytes >= MAX_BUFFERED_BYTES) {
              if (timer !== null) {
                clearTimeout(timer);
              }
              flush();
            } else if (timer === null) {
              timer = setTimeout(flush, delayMs);
            }
          }
        } catch (error) {
          if (!cancelled) {
            controller.error(error);
          }
        }
      };

      void pump();
    },
    cancel() {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      return reader.cancel();
    },
  });
}

function join(chunks: Uint8Array[], length: number): Uint8Array {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

if (!window[INSTALL_FLAG]) {
  window[INSTALL_FLAG] = true;

  const diagnostics: StreamCoalescerDiagnostics = {
    intervalMs: intervalMs(),
    eligibleResponses: 0,
    chunksReceived: 0,
    flushes: 0,
    bytesForwarded: 0,
    recentSameOriginPosts: [],
  };
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const delayMs = intervalMs();
    diagnostics.intervalMs = delayMs;
    const sameOriginPost = isSameOriginPost(input, init);
    const contentType = response.headers.get("content-type");
    const isStream = contentType?.startsWith("text/event-stream") ?? false;
    const intercepted = delayMs !== 0 && sameOriginPost && Boolean(response.body) && isStream;

    if (sameOriginPost) {
      diagnostics.recentSameOriginPosts.push({
        path: requestPath(input),
        status: response.status,
        contentType,
        intercepted,
      });
      diagnostics.recentSameOriginPosts.splice(0, Math.max(0, diagnostics.recentSameOriginPosts.length - 20));
    }

    if (!intercepted || !response.body) {
      return response;
    }

    diagnostics.eligibleResponses += 1;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(coalesce(response.body, delayMs, diagnostics), {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };

  window.__viewportLeashStreamCoalescerDiagnostics = () => ({
    ...diagnostics,
    recentSameOriginPosts: [...diagnostics.recentSameOriginPosts],
  });

  document.addEventListener(DIAGNOSTICS_REQUEST_EVENT, () => {
    document.documentElement.setAttribute(
      DIAGNOSTICS_ATTRIBUTE,
      JSON.stringify(window.__viewportLeashStreamCoalescerDiagnostics?.() ?? null),
    );
  });
}
