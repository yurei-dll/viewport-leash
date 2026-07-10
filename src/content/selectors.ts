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
 * Whether a mutation node adds or removes a message in the rendered thread.
 *
 * A route/hydration update can insert a wrapper that contains every turn, so
 * checking the added subtree is necessary for the cached list to stay correct.
 * Streamed-token and hover updates only add descendants within an existing
 * turn, and therefore do not match this selector or trigger a full rescan.
 */
export function containsMessageNode(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  return node.matches(ANY_MESSAGE_SELECTOR) || Boolean(node.querySelector(ANY_MESSAGE_SELECTOR));
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
