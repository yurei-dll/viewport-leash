# viewport-leash

Keeps only the most recent ChatGPT turns rendered, reducing the DOM, style,
and layout work imposed by very long conversations.

## Performance behavior

The content script caches the current message-node list. It re-queries the
document only when a mutation adds or removes a message; it deliberately
ignores descendant churn such as streamed-token updates and hover-class
animations. Visibility writes are also idempotent, so an update does not write
`display` for a turn that is already in the requested state.

For local profiling, run this in the ChatGPT page's DevTools console:

```js
window.__viewportLeashDiagnostics?.()
```

The returned counters include `messageTreeScans`, `updates`, observed/ignored
mutations, message count, and update timings. During hover/scroll activity,
`observedMutations` may rise but `messageTreeScans` should remain unchanged.

This extension cannot change ChatGPT's internal React message-tree selectors
or its CSS. It avoids adding its own full-thread DOM scans to those interaction
paths while limiting the rendered thread surface.

## Streaming coalescing experiment

The extension also coalesces same-origin `POST` Server-Sent Event responses for
150ms before delivering them to ChatGPT. This reduces how often streaming chunks
can trigger ChatGPT's expensive conversation-wide selectors. It preserves every
byte and SSE frame, but makes the visible reply update in small bursts.

Set `localStorage.viewport-leash-stream-coalescing-ms` to a value between `0`
and `1000`. `0` disables coalescing for the next stream; `150` is the default.
Inspect its page-world counters with:

```js
window.__viewportLeashStreamCoalescerDiagnostics?.()
```

`recentSameOriginPosts` records only request paths, HTTP status, and response
MIME types—never request or response contents—to diagnose a stream format that
does not match the interceptor.

This is intentionally an experimental feature: if ChatGPT changes away
from same-origin POST/SSE streaming, the interceptor passes the response
through unchanged.

## Toolbar diagnostics

Click the Viewport Leash toolbar icon while a ChatGPT tab is active to see the
same aggregate stream and viewport counters in a small popup. Use **Refresh**
after starting or finishing a reply. The popup reads only counters and response
metadata; it never reads message content. **Export JSON** downloads a
timestamped snapshot of those counters for profile comparisons.
