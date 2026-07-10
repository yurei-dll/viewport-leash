import { LeashEngine } from "./content/leash-engine";

const engine = new LeashEngine();
const DIAGNOSTICS_ATTRIBUTE = "data-viewport-leash-stream-diagnostics";
const DIAGNOSTICS_REQUEST_EVENT = "viewport-leash:request-stream-diagnostics";

declare const browser: {
  runtime: {
    onMessage: {
      addListener(listener: (message: unknown) => unknown): void;
    };
  };
};

declare global {
  interface Window {
    /** Local profiling aid: inspect this from the page's DevTools console. */
    __viewportLeashDiagnostics?: () => ReturnType<typeof engine.getDiagnostics>;
  }
}

window.__viewportLeashDiagnostics = () => engine.getDiagnostics();

browser.runtime.onMessage.addListener(async (message) => {
  if (message !== "viewport-leash:get-diagnostics") {
    return undefined;
  }

  document.dispatchEvent(new Event(DIAGNOSTICS_REQUEST_EVENT));
  const streamDiagnostics = document.documentElement.getAttribute(DIAGNOSTICS_ATTRIBUTE);
  return {
    leash: engine.getDiagnostics(),
    stream: streamDiagnostics ? JSON.parse(streamDiagnostics) : null,
  };
});

engine.start();
