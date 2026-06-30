import { findMessageNodes, isStreamingMessage } from "./selectors";

const DEFAULT_WINDOW_SIZE = 50;

export class LeashEngine {
  private readonly originalDisplay = new WeakMap<HTMLElement, string>();
  private observer: MutationObserver | null = null;
  private updateFrame: number | null = null;

  constructor(private readonly windowSize = DEFAULT_WINDOW_SIZE) {}

  start(): void {
    if (this.observer) {
      return;
    }

    this.update();
    this.observer = new MutationObserver(() => this.scheduleUpdate());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-is-streaming", "class"],
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;

    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame);
      this.updateFrame = null;
    }

    for (const message of findMessageNodes()) {
      this.show(message);
    }
  }

  private scheduleUpdate(): void {
    if (this.updateFrame !== null) {
      return;
    }

    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null;
      this.update();
    });
  }

  private update(): void {
    const messages = findMessageNodes();
    const windowStart = Math.max(0, messages.length - this.windowSize);

    messages.forEach((message, index) => {
      if (index >= windowStart || isStreamingMessage(message)) {
        this.show(message);
      } else {
        this.hide(message);
      }
    });
  }

  private hide(message: HTMLElement): void {
    if (!this.originalDisplay.has(message)) {
      this.originalDisplay.set(message, message.style.display);
    }

    message.style.display = "none";
  }

  private show(message: HTMLElement): void {
    const originalDisplay = this.originalDisplay.get(message);
    if (originalDisplay === undefined) {
      return;
    }

    message.style.display = originalDisplay;
    this.originalDisplay.delete(message);
  }
}
