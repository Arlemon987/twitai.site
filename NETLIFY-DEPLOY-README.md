# Twit AI — Netlify backup migration

This is a prepared Netlify-compatible copy of the `NETLIFY-BACKUP` branch.
The original Vercel API handlers in `/api` are retained and wrapped by Netlify Functions.
The public website files are copied into `/public` so source files, Firebase rules,
and backend modules are not deployed as public static assets.

## Netlify settings

- Branch: `NETLIFY-BACKUP`
- Base directory: leave blank
- Build command: leave blank
- Publish directory: `public`
- Functions directory: `netlify/functions`

`netlify.toml` also configures these API routes:
- `/api/generate`
- `/api/me`
- `/api/subscribe`
- `/api/admin`
- `/api/stats`
- `/api/config`

## Environment variables

Configure these in Netlify Project configuration → Environment variables,
with Functions scope:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `ADMIN_EMAIL`

Use the same values as the existing Vercel deployment. Do not commit secrets.

## Important

- This backup uses the same Firebase project and existing database.
- Do not change the Vercel project or the `main` branch.
- Test Google sign-in, generation, free usage, subscriptions, admin actions,
  and usage analytics on the Netlify URL before using it as a production fallback.
- Netlify's function adapter converts the existing Vercel-style `(req, res)`
  handlers to Netlify's function event format.
- The adapter adds permissive CORS response headers for browser-extension calls.
  The API still requires Firebase authentication where the original handlers do.
- The `public` directory contains only the website-facing files. The backend
  source remains outside the published directory.

## Netlify function runtime

The current API uses `firebase-admin` and `openai`, both installed from the
root package.json and bundled into Netlify Functions. The functions run in
Netlify's Node.js runtime, not an Edge runtime.
