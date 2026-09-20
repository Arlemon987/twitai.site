# Twit AI: 30-Day Usage + OpenAI Token Analytics

This update adds:

1. Per-user daily tweet count.
2. Per-user daily reply count.
3. Individual tweet generation logs for the last 30 days.
4. OpenAI input, cached input, actual non-cached input, output and total tokens.
5. User-side Usage & History.
6. Admin-side 30-day analytics.
7. Admin user filtering.
8. Firebase server-only access.
9. Firestore TTL support for automatic cleanup.

## STEP 1: Backup

Before changing anything:

```bash
git pull origin main
git checkout -b usage-analytics-30-days
```

Keep the current production deployment available while testing.

## STEP 2: Copy the new backend files

Replace/add:

```text
api/generate.js
api/admin.js
api/stats.js
api/prompt.js
firestore.rules
```

Do not delete your existing:

```text
api/_firebase.js
api/config.js
api/me.js
api/subscribe.js
```

## STEP 3: Add the user UI

Copy:

```text
usage.js
```

to the same folder as `index.html`.

Then add this one line immediately before `</body>` in `index.html`:

```html
<script type="module" src="/usage.js"></script>
```

No other existing index.html code needs to be removed.

## STEP 4: Replace admin.html

Replace the existing root `admin.html` with the supplied updated `admin.html`.

The new admin page keeps:

- Google admin login
- payment approval/rejection
- user list
- subscription information

and adds:

- 30-day usage analytics
- user selector
- per-day tweets
- per-day replies
- input tokens
- cached tokens
- actual non-cached input tokens
- output tokens
- total tokens
- per-user 30-day totals
- View button for each user

## STEP 5: Deploy the Firestore rules

Firebase Console:

Firestore Database
→ Rules

Replace the rules with the supplied `firestore.rules`.

The browser remains blocked from direct access to:

```text
users
subscriptionRequests
usageDaily
generationLogs
```

All writes happen through the Vercel API using Firebase Admin.

## STEP 6: Enable TTL for generation logs

Firebase Console:

Firestore Database
→ Time-to-live / TTL

Create a TTL policy for:

```text
Collection group: generationLogs
Field: expiresAt
```

The backend sets `expiresAt` to 30 days after each successful generation.

Recommended second policy:

```text
Collection group: usageDaily
Field: expiresAt
```

This keeps daily aggregates to approximately the same 30-day retention window.

TTL deletion is asynchronous, so a record can remain briefly after its expiration time.

## STEP 7: Deploy

Commit:

```bash
git add .
git commit -m "Add 30-day usage and OpenAI token analytics"
git push origin main
```

Vercel will deploy automatically if GitHub integration is enabled.

Or deploy with Vercel CLI.

## STEP 8: Test a normal generation

Sign in as a normal user.

Generate one tweet with 5 replies.

The response is recorded in:

```text
users/{uid}
usageDaily/{uid}_YYYY-MM-DD
generationLogs/{auto-id}
```

Example daily document:

```json
{
  "uid": "...",
  "email": "user@gmail.com",
  "date": "2026-09-18",
  "tweets": 1,
  "replies": 5,
  "requestCount": 1,
  "inputTokens": 1500,
  "cachedInputTokens": 1100,
  "actualInputTokens": 400,
  "outputTokens": 180,
  "totalTokens": 1680
}
```

## STEP 9: Test regeneration

Regenerate the same tweet.

It counts as another tweet submission because the existing Twit AI generation endpoint reserves one submission for every successful generation request.

Therefore:

```text
2 generation requests
2 tweets
10 replies
```

if both requests produce 5 replies.

## STEP 10: Check user analytics

Open the Account modal.

Click:

```text
Usage & History
```

You should see today's totals.

Click a date.

You should see the tweets submitted on that date and the individual token usage.

## STEP 11: Check admin analytics

Open:

```text
/admin.html
```

Sign in using the email configured in:

```text
ADMIN_EMAIL
```

The dashboard should show:

```text
Tweets
Replies
Input
Cached
Actual Input
Output
Total
```

for the last 30 days.

## STEP 12: Check individual user

In the Users table:

```text
View
```

selects that user's UID and loads only that user's last 30 days.

## STEP 13: Important token definitions

The dashboard uses:

```text
Input tokens
    = OpenAI input_tokens

Cached tokens
    = OpenAI input_tokens_details.cached_tokens

Actual input
    = input_tokens - cached_tokens

Output tokens
    = OpenAI output_tokens

Total tokens
    = OpenAI total_tokens
```

Cached tokens are a subset of input tokens. They must not be added again to total tokens.

## STEP 14: Privacy

The new `generationLogs` collection stores the submitted tweet text for 30-day user history.

The normal user can only access their own logs through:

```text
/api/stats
```

The admin analytics endpoint exposes aggregate usage, not tweet text.

Firestore rules prevent direct browser reads/writes.

## STEP 15: Firestore indexes

The new `/api/stats` query uses:

```text
generationLogs
where uid == current user
where createdAt >= start
orderBy createdAt desc
```

If Firebase asks you to create a composite index, follow the generated Firebase Console link and create it.

The daily aggregate queries use deterministic document IDs and do not require a daily analytics query index.

## STEP 16: Production checklist

Test:

```text
[ ] Google login
[ ] First generation
[ ] Today's tweet count
[ ] Today's reply count
[ ] OpenAI input tokens
[ ] Cached tokens
[ ] Actual input tokens
[ ] Output tokens
[ ] Total tokens
[ ] Regenerate
[ ] Multiple generations
[ ] 30-day date table
[ ] User date details
[ ] Admin dashboard
[ ] Admin user filter
[ ] Admin View user
[ ] Non-admin blocked from /api/admin
[ ] User cannot access another user's /api/stats
[ ] 100 free tweet limit still works
[ ] Subscription still works
[ ] Payment approval still works
[ ] Firestore direct access remains blocked
[ ] TTL policy configured
```

## Important

Do not put Firebase Admin credentials in frontend files.

Keep these in Vercel environment variables:

```text
OPENAI_API_KEY
OPENAI_MODEL
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
ADMIN_EMAIL
```

The Firebase Web configuration in `index.html`, `usage.js`, and `admin.html` is client configuration and is not the Firebase Admin private key.
