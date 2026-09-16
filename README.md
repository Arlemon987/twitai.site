# Twit AI + Firebase Google Login + Manual Crypto Subscription

## Features

- Google Login through Firebase Authentication
- Every Google user gets 100 free tweet submissions
- Free usage is tracked by Firebase UID
- Total tweet submissions and total generated replies are tracked
- After 100 free submissions, a subscription is required
- User selects 1, 3, 6, or 12 months
- User sends crypto manually to your wallet
- User submits the transaction hash
- Admin signs in with the configured admin Gmail
- Admin manually verifies the transaction
- Admin approves or rejects the payment
- Approval activates the subscription for the selected duration
- Subscription renewal extends from the current expiry when appropriate
- Admin dashboard shows user usage and payment requests

## Important

The payment transaction is NOT verified automatically by this code.

The admin must manually verify the transaction on the correct blockchain explorer before clicking Approve.

## Files

- index.html: main Twit AI frontend
- admin.html: admin dashboard
- api/generate.js: authenticated OpenAI generation endpoint
- api/me.js: authenticated user/account endpoint
- api/subscribe.js: payment request endpoint
- api/admin.js: admin dashboard API
- api/_firebase.js: Firebase Admin initialization
- api/config.js: public subscription/payment display settings
- firestore.rules: locks Firestore from direct browser access
- package.json: server dependencies

## Firebase setup

1. Create a Firebase project.
2. Add a Web App.
3. Enable Authentication.
4. Enable Google as a sign-in provider.
5. Add `twitai.app` to Authorized Domains.
6. Create a Firestore database.
7. Set Firestore rules from `firestore.rules`.
8. Create a service account:
   Firebase Console -> Project settings -> Service accounts -> Generate new private key.
9. Copy the service account values into Vercel environment variables.
10. Set ADMIN_EMAIL to your admin Gmail.
11. Copy your Firebase Web App config into both `index.html` and `admin.html`.
12. Configure payment network, wallet, and plan amounts in `api/config.js`.

## Vercel environment variables

Set these in Vercel:

OPENAI_API_KEY
OPENAI_MODEL
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
ADMIN_EMAIL

Do not put the Firebase Admin service account private key into the frontend.

## Firebase Web config

Replace:

YOUR_FIREBASE_API_KEY
YOUR_PROJECT_ID
YOUR_MESSAGING_SENDER_ID
YOUR_FIREBASE_APP_ID

in:

- index.html
- admin.html

The Firebase Web config is client configuration. Firebase Admin credentials are server secrets.

## Payment configuration

Edit `api/config.js`:

export const PAYMENT_CONFIG = {
  network: "Base",
  wallet: "0xYOUR_WALLET",
  plans: {
    month: { label: "1 Month", months: 1, amount: "10 USDC" },
    three_months: { label: "3 Months", months: 3, amount: "25 USDC" },
    six_months: { label: "6 Months", months: 6, amount: "45 USDC" },
    year: { label: "1 Year", months: 12, amount: "80 USDC" }
  }
};

Use your actual network, wallet, and prices.

## Install

npm install

## Deploy

Push the project to GitHub and import it into Vercel.

Or deploy with the Vercel CLI.

## Admin

Open:

https://your-domain.com/admin.html

Sign in with the Gmail address configured in ADMIN_EMAIL.

The backend checks the authenticated Firebase email against ADMIN_EMAIL before returning admin data.

## Firestore collections

### users/{uid}

Example:

{
  "uid": "...",
  "email": "user@gmail.com",
  "displayName": "User",
  "photoURL": "...",
  "freeTweetsUsed": 37,
  "totalTweetsSubmitted": 37,
  "totalRepliesGenerated": 185,
  "plan": "free",
  "planLabel": "Free",
  "subscriptionStatus": "free",
  "subscriptionStart": null,
  "subscriptionExpiry": null
}

### subscriptionRequests/{requestId}

Example:

{
  "uid": "...",
  "email": "user@gmail.com",
  "plan": "three_months",
  "planLabel": "3 Months",
  "durationMonths": 3,
  "amount": "YOUR_3_MONTH_PRICE",
  "network": "Base",
  "paymentWallet": "0x...",
  "transactionHash": "0x...",
  "status": "pending"
}

## Security model

The browser sends the Firebase ID token in:

Authorization: Bearer <token>

The backend verifies the token with Firebase Admin SDK.

The backend is the only component allowed to change:

- freeTweetsUsed
- totalTweetsSubmitted
- totalRepliesGenerated
- subscriptionStatus
- subscriptionStart
- subscriptionExpiry

The browser cannot directly write these fields.

## Before production

- Set real plan prices.
- Set the correct payment network.
- Set your payment wallet.
- Set your admin Gmail.
- Test Google login.
- Test exactly 100 free submissions.
- Test the 101st submission.
- Test payment request submission.
- Verify a real transaction manually.
- Approve a 1-month test subscription.
- Confirm expiry enforcement.
- Test renewal before expiry.
- Test admin access with a non-admin Gmail.
