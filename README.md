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

The extension holds same-origin `POST` Server-Sent Event responses until they
complete, then delivers one byte-identical response to ChatGPT. This prevents
ChatGPT from entering its expensive streaming reaction loop for every partial
update. A small progress overlay shows received update and byte counts without
inspecting response text.

Finish-first is the default. For a temporary fallback in the page console, set
`localStorage.viewport-leash-stream-mode` to `"coalesce"` (150ms delivery) or
`"disabled"`; remove that key to restore finish-first. Inspect page-world
counters with:

```js
window.__viewportLeashStreamCoalescerDiagnostics?.()
```

`recentSameOriginPosts` records only request paths, HTTP status, and response
MIME types—never request or response contents—to diagnose a stream format that
does not match the interceptor.

This is intentionally an experimental feature: if ChatGPT changes away
from same-origin POST/SSE streaming, the interceptor passes the response
through unchanged.

Finish-first temporarily buffers raw response bytes in memory until completion.

## Toolbar diagnostics

Click the Viewport Leash toolbar icon while a ChatGPT tab is active to see the
same aggregate stream and viewport counters in a small popup. Use **Refresh**
after starting or finishing a reply. The popup reads only counters and response
metadata; it never reads message content. **Export JSON** downloads a
timestamped snapshot of those counters for profile comparisons.
