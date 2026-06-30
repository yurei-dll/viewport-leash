export const MESSAGE_SELECTOR = '[data-testid^="conversation-turn-"]';
const MESSAGE_CONTENT_SELECTOR = "[data-message-author-role]";

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

export function isStreamingMessage(message: HTMLElement): boolean {
  return message.matches(STREAMING_SELECTORS) || Boolean(message.querySelector(STREAMING_SELECTORS));
}
