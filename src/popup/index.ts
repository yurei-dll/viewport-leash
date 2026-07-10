interface LeashDiagnostics {
  updates: number;
  messageTreeScans: number;
  ignoredMutations: number;
  maxMessageCount: number;
  maxUpdateDurationMs: number;
}

interface StreamDiagnostics {
  intervalMs: number;
  eligibleResponses: number;
  chunksReceived: number;
  flushes: number;
  bytesForwarded: number;
}

interface DiagnosticsResponse {
  leash: LeashDiagnostics;
  stream: StreamDiagnostics | null;
}

declare const browser: {
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string }>>;
    sendMessage(tabId: number, message: unknown): Promise<DiagnosticsResponse>;
  };
};

const statusElement = document.querySelector<HTMLElement>("#status")!;
const metrics = document.querySelector<HTMLElement>("#metrics")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
let currentDiagnostics: DiagnosticsResponse | null = null;

function metric(label: string, value: string | number): string {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function render(data: DiagnosticsResponse): void {
  currentDiagnostics = data;
  exportButton.disabled = false;
  const stream = data.stream;
  metrics.innerHTML = [
    `<h2>Stream coalescing</h2>`,
    stream
      ? [
          metric("Interval", `${stream.intervalMs} ms`),
          metric("Matched streams", stream.eligibleResponses),
          metric("Chunks → flushes", `${stream.chunksReceived} → ${stream.flushes}`),
          metric("Bytes forwarded", stream.bytesForwarded.toLocaleString()),
        ].join("")
      : `<p class="muted">No page-world stream metrics yet.</p>`,
    `<h2>Viewport leash</h2>`,
    metric("Message scans", data.leash.messageTreeScans),
    metric("Visibility updates", data.leash.updates),
    metric("Largest thread", data.leash.maxMessageCount),
    metric("Max update", `${data.leash.maxUpdateDurationMs.toFixed(1)} ms`),
    metric("Ignored mutations", data.leash.ignoredMutations),
  ].join("");
}

async function load(): Promise<void> {
  refresh.disabled = true;
  statusElement.textContent = "Reading active ChatGPT tab…";

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/") && !tab.url?.startsWith("https://chat.openai.com/")) {
      throw new Error("Open a ChatGPT tab first.");
    }

    const diagnostics = await browser.tabs.sendMessage(tab.id, "viewport-leash:get-diagnostics");
    if (!diagnostics?.leash) {
      throw new Error("The ChatGPT tab has not loaded Viewport Leash yet. Reload the page and try again.");
    }

    render(diagnostics);
    statusElement.textContent = "Live counters from this tab";
  } catch (error) {
    metrics.innerHTML = "";
    statusElement.textContent = error instanceof Error ? error.message : "Could not read this tab.";
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", () => void load());
exportButton.addEventListener("click", () => {
  if (!currentDiagnostics) {
    return;
  }

  const payload = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    diagnostics: currentDiagnostics,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `viewport-leash-metrics-${payload.capturedAt.replaceAll(":", "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
void load();
