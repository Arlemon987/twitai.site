# Twit AI usage analytics integration

The existing `index.html` already owns Firebase auth and the account modal. To avoid rewriting the 1,497-line UI, the new `usage.js` self-injects the Usage & History button and modal.

## 1. Copy `usage.js` to the project root

Place:

```text
usage.js
```

beside `index.html`.

## 2. Add one script tag to `index.html`

Immediately before the existing closing `</body>` tag, add:

```html
<script type="module" src="/usage.js"></script>
```

Do not remove the existing main module script.

## 3. What the new user UI does

The existing Account modal gets:

```text
Usage & History
```

The user can see:

- today's tweets
- today's replies
- today's OpenAI input tokens
- today's cached input tokens
- today's actual non-cached input tokens
- today's output tokens
- today's total tokens
- last 30 days by date
- the tweets submitted on each date
- replies generated for each request
- request time
- per-request cached, actual input, output and total tokens

The server remains authoritative. The browser never writes usage data directly to Firestore.
