import { LeashEngine } from "./content/leash-engine";

const engine = new LeashEngine();

declare global {
  interface Window {
    /** Local profiling aid: inspect this from the page's DevTools console. */
    __viewportLeashDiagnostics?: () => ReturnType<typeof engine.getDiagnostics>;
  }
}

window.__viewportLeashDiagnostics = () => engine.getDiagnostics();

engine.start();
