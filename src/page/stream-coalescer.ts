/**
 * ChatGPT's stream updates can invalidate expensive whole-conversation
 * selectors. Coalesce its same-origin POST/SSE response chunks before they
 * reach the app, so it performs fewer state updates without losing bytes or
 * changing SSE framing.
 *
 * This deliberately lives in the page's MAIN world and must not use extension
 * APIs. The page can inspect or replace it, so it stores no sensitive data.
 */

const MODE_SETTING_KEY = "viewport-leash-stream-mode";
const DEFAULT_INTERVAL_MS = 150;
const MAX_BUFFERED_BYTES = 64 * 1024;
const INSTALL_FLAG = "__viewportLeashStreamCoalescerInstalled";
const DIAGNOSTICS_ATTRIBUTE = "data-viewport-leash-stream-diagnostics";
const DIAGNOSTICS_REQUEST_EVENT = "viewport-leash:request-stream-diagnostics";

export {};

interface StreamCoalescerDiagnostics {
  mode: StreamMode;
  intervalMs: number;
  eligibleResponses: number;
  chunksReceived: number;
  flushes: number;
  bytesForwarded: number;
  recentSameOriginPosts: StreamResponseSummary[];
}

type StreamMode = "coalesce" | "finish-first";

interface StreamSettings {
  mode: StreamMode;
  intervalMs: number;
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

function streamSettings(): StreamSettings {
  try {
    const configuredMode = localStorage.getItem(MODE_SETTING_KEY);
    if (configuredMode === "coalesce") {
      return { mode: "coalesce", intervalMs: DEFAULT_INTERVAL_MS };
    }
    if (configuredMode === "disabled") {
      return { mode: "coalesce", intervalMs: 0 };
    }
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }

  return { mode: "finish-first", intervalMs: -1 };
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

function coalesce(body: ReadableStream<Uint8Array>, settings: StreamSettings, diagnostics: StreamCoalescerDiagnostics): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const overlay = settings.mode === "finish-first" ? createProgressOverlay() : null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let queued: Uint8Array[] = [];
      let queuedBytes = 0;
      let streamChunks = 0;
      let streamBytes = 0;

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
              if (overlay) {
                overlay.setApplying();
                await nextFrame();
              }
              flush();
              controller.close();
              overlay?.removeSoon();
              return;
            }

            queued.push(value);
            queuedBytes += value.byteLength;
            diagnostics.chunksReceived += 1;
            streamChunks += 1;
            streamBytes += value.byteLength;
            overlay?.update(streamChunks, streamBytes);
            if (queuedBytes >= MAX_BUFFERED_BYTES) {
              if (timer !== null) {
                clearTimeout(timer);
              }
              flush();
            } else if (settings.mode === "coalesce" && timer === null) {
              timer = setTimeout(flush, settings.intervalMs);
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
      overlay?.removeSoon();
      return reader.cancel();
    },
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createProgressOverlay(): {
  update(chunks: number, bytes: number): void;
  setApplying(): void;
  removeSoon(): void;
} {
  let element: HTMLDivElement | null = null;
  let lastUpdate = 0;

  const ensure = () => {
    if (element) {
      return element;
    }

    element = document.createElement("div");
    element.id = "viewport-leash-stream-progress";
    element.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 11px;border-radius:8px;background:#202123;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 3px 12px #0006;pointer-events:none";
    (document.body ?? document.documentElement).append(element);
    return element;
  };

  return {
    update(chunks, bytes) {
      const now = performance.now();
      if (now - lastUpdate < 200) {
        return;
      }
      lastUpdate = now;
      ensure().textContent = `Generating… ${chunks} updates received · ${Math.ceil(bytes / 1024)} KB`;
    },
    setApplying() {
      ensure().textContent = "Applying completed response…";
    },
    removeSoon() {
      setTimeout(() => element?.remove(), 1_500);
    },
  };
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

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return join(chunks, bytes);
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
}

if (!window[INSTALL_FLAG]) {
  window[INSTALL_FLAG] = true;

  const diagnostics: StreamCoalescerDiagnostics = {
    ...streamSettings(),
    eligibleResponses: 0,
    chunksReceived: 0,
    flushes: 0,
    bytesForwarded: 0,
    recentSameOriginPosts: [],
  };
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const settings = streamSettings();
    diagnostics.mode = settings.mode;
    diagnostics.intervalMs = settings.intervalMs;
    const sameOriginPost = isSameOriginPost(input, init);
    const contentType = response.headers.get("content-type");
    const isStream = contentType?.startsWith("text/event-stream") ?? false;
    const intercepted = settings.intervalMs !== 0 && sameOriginPost && Boolean(response.body) && isStream;

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
    const transformedBody = coalesce(response.body, settings, diagnostics);

    // Letting fetch resolve immediately still lets ChatGPT enter its streaming
    // reaction loop, even when its body receives no chunks. Finish-first must
    // therefore hold the fetch promise itself until the response is complete.
    if (settings.mode === "finish-first") {
      performance.mark("viewport-leash:finish-first-buffering");
      const completed = await readAll(transformedBody);
      performance.mark("viewport-leash:finish-first-applying");
      const completedResponse = new Response(completed.buffer as ArrayBuffer, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
      performance.mark("viewport-leash:finish-first-delivered");
      return completedResponse;
    }

    return new Response(transformedBody, {
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
