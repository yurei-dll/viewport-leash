export const MESSAGE_SELECTOR = '[data-testid^="conversation-turn-"]';
const MESSAGE_CONTENT_SELECTOR = "[data-message-author-role]";
const ANY_MESSAGE_SELECTOR = `${MESSAGE_SELECTOR},${MESSAGE_CONTENT_SELECTOR}`;

const STREAMING_SELECTORS = [
  '[data-is-streaming="true"]',
  ".result-streaming",
].join(",");

export function findMessageNodes(root: ParentNode = document): HTMLElement[] {
  const turns = Array.from(root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
  if (turns.length > 0) {
    return turns;
  }

  return Array.from(root.querySelectorAll<HTMLElement>(MESSAGE_CONTENT_SELECTOR));
}

/**
 * Whether a mutation node is a message in the rendered thread.
 *
 * Deliberately do not query descendants here. ChatGPT mutates descendants of
 * existing messages while streaming and while hover controls animate; those
 * mutations must stay cheap and do not require a document-wide message query.
 */
export function containsMessageNode(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  return node.matches(ANY_MESSAGE_SELECTOR);
}

export function findContainingMessage(node: Node): HTMLElement | null {
  if (!(node instanceof Element)) {
    return null;
  }

  return node.closest<HTMLElement>(MESSAGE_SELECTOR) ?? node.closest<HTMLElement>(MESSAGE_CONTENT_SELECTOR);
}

export function isStreamingMessage(message: HTMLElement): boolean {
  return message.matches(STREAMING_SELECTORS) || Boolean(message.querySelector(STREAMING_SELECTORS));
}
