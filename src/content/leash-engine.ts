import {
  containsMessageNode,
  findContainingMessage,
  findMessageNodes,
  isStreamingMessage,
} from "./selectors";

const DEFAULT_WINDOW_SIZE = 50;

export interface LeashDiagnostics {
  updates: number;
  messageTreeScans: number;
  observedMutations: number;
  ignoredMutations: number;
  maxMessageCount: number;
  maxUpdateDurationMs: number;
  lastMessageCount: number;
  lastUpdateDurationMs: number;
}

export class LeashEngine {
  private readonly originalDisplay = new WeakMap<HTMLElement, string>();
  private readonly hiddenMessages = new Set<HTMLElement>();
  private messageNodes: HTMLElement[] = [];
  private readonly streamingMessages = new Set<HTMLElement>();
  private messageListDirty = true;
  private readonly diagnostics: LeashDiagnostics = {
    updates: 0,
    messageTreeScans: 0,
    observedMutations: 0,
    ignoredMutations: 0,
    maxMessageCount: 0,
    maxUpdateDurationMs: 0,
    lastMessageCount: 0,
    lastUpdateDurationMs: 0,
  };
  private observer: MutationObserver | null = null;
  private updateFrame: number | null = null;

  constructor(private readonly windowSize = DEFAULT_WINDOW_SIZE) {}

  start(): void {
    if (this.observer) {
      return;
    }

    this.update();
    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Observing class changes made every hover animation turn into a full
      // document query. data-is-streaming is the only attribute we need.
      attributeFilter: ["data-is-streaming"],
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;

    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame);
      this.updateFrame = null;
    }

    for (const message of [...this.hiddenMessages]) {
      this.show(message);
    }
  }

  getDiagnostics(): Readonly<LeashDiagnostics> {
    return { ...this.diagnostics };
  }

  private handleMutations(mutations: MutationRecord[]): void {
    let shouldUpdate = false;

    for (const mutation of mutations) {
      this.diagnostics.observedMutations += 1;

      if (mutation.type === "attributes") {
        const message = findContainingMessage(mutation.target);
        if (message) {
          if (isStreamingMessage(message)) {
            this.streamingMessages.add(message);
          } else {
            this.streamingMessages.delete(message);
          }
          shouldUpdate = true;
        } else {
          this.diagnostics.ignoredMutations += 1;
        }
        continue;
      }

      if (this.mutationChangesMessageList(mutation)) {
        this.messageListDirty = true;
        shouldUpdate = true;
      } else {
        this.diagnostics.ignoredMutations += 1;
      }
    }

    if (shouldUpdate) {
      this.scheduleUpdate();
    }
  }

  private mutationChangesMessageList(mutation: MutationRecord): boolean {
    for (const node of mutation.addedNodes) {
      if (containsMessageNode(node)) {
        return true;
      }
    }

    for (const node of mutation.removedNodes) {
      if (containsMessageNode(node)) {
        return true;
      }
    }

    return false;
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
    const startedAt = performance.now();
    if (this.messageListDirty) {
      this.messageNodes = findMessageNodes();
      this.messageListDirty = false;
      this.diagnostics.messageTreeScans += 1;

      const currentMessages = new Set(this.messageNodes);
      for (const message of this.hiddenMessages) {
        if (!currentMessages.has(message)) {
          this.hiddenMessages.delete(message);
          this.originalDisplay.delete(message);
        }
      }

      this.streamingMessages.clear();
      for (const message of this.messageNodes) {
        if (isStreamingMessage(message)) {
          this.streamingMessages.add(message);
        }
      }
    }

    const messages = this.messageNodes;
    const windowStart = Math.max(0, messages.length - this.windowSize);

    messages.forEach((message, index) => {
      if (index >= windowStart || this.streamingMessages.has(message)) {
        this.show(message);
      } else {
        this.hide(message);
      }
    });

    const duration = performance.now() - startedAt;
    this.diagnostics.updates += 1;
    this.diagnostics.lastMessageCount = messages.length;
    this.diagnostics.maxMessageCount = Math.max(this.diagnostics.maxMessageCount, messages.length);
    this.diagnostics.lastUpdateDurationMs = duration;
    this.diagnostics.maxUpdateDurationMs = Math.max(this.diagnostics.maxUpdateDurationMs, duration);
  }

  private hide(message: HTMLElement): void {
    if (!this.originalDisplay.has(message)) {
      this.originalDisplay.set(message, message.style.display);
    }

    message.style.display = "none";
    this.hiddenMessages.add(message);
  }

  private show(message: HTMLElement): void {
    const originalDisplay = this.originalDisplay.get(message);
    if (originalDisplay === undefined) {
      return;
    }

    message.style.display = originalDisplay;
    this.originalDisplay.delete(message);
    this.hiddenMessages.delete(message);
  }
}
