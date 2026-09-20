import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const TIME_ZONE = "Asia/Dhaka";
const DAY_COUNT = 30;

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && value._seconds !== undefined) {
    return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
  }
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function timestampToISO(value) {
  const date = timestampToDate(value);
  return date ? date.toISOString() : null;
}
function requireAdmin(decoded) {
  if (!ADMIN_EMAIL || (decoded.email || "").toLowerCase() !== ADMIN_EMAIL) {
    const error = new Error("Admin access denied.");
    error.statusCode = 403;
    error.code = "ADMIN_FORBIDDEN";
    throw error;
  }
}
function dhakaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
function subtractDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function addMonths(date, months) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== originalDay) result.setDate(0);
  return result;
}
const PLAN_MONTHS = { month: 1, three_months: 3, six_months: 6, year: 12 };

async function listUsers(db) {
  const snap = await db.collection("users").orderBy("createdAt", "desc").get();
  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      uid: data.uid || doc.id,
      email: data.email || "",
      displayName: data.displayName || "",
      photoURL: data.photoURL || "",
      plan: data.plan || "free",
      planLabel: data.planLabel || "Free",
      subscriptionStatus: data.subscriptionStatus || "free",
      subscriptionStart: timestampToISO(data.subscriptionStart),
      subscriptionExpiry: timestampToISO(data.subscriptionExpiry),
      freeTweetsUsed: Number(data.freeTweetsUsed || 0),
      totalTweetsSubmitted: Number(data.totalTweetsSubmitted || 0),
      totalRepliesGenerated: Number(data.totalRepliesGenerated || 0),
      createdAt: timestampToISO(data.createdAt)
    };
  });
}
async function listRequests(db) {
  const snap = await db.collection("subscriptionRequests")
    .orderBy("submittedAt", "desc").limit(200).get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
function dailyEmpty(date, uid, email = "") {
  return {
    uid, email, date, tweets: 0, replies: 0, requestCount: 0,
    inputTokens: 0, cachedInputTokens: 0, actualInputTokens: 0,
    outputTokens: 0, totalTokens: 0
  };
}
function normalizeDaily(data, date, uid, email = "") {
  return {
    uid: data?.uid || uid,
    email: data?.email || email,
    date,
    tweets: Number(data?.tweets || 0),
    replies: Number(data?.replies || 0),
    requestCount: Number(data?.requestCount || 0),
    inputTokens: Number(data?.inputTokens || 0),
    cachedInputTokens: Number(data?.cachedInputTokens || 0),
    actualInputTokens: Number(data?.actualInputTokens || 0),
    outputTokens: Number(data?.outputTokens || 0),
    totalTokens: Number(data?.totalTokens || 0)
  };
}
async function getUserDaily(db, user, dates) {
  const refs = dates.map(date => db.collection("usageDaily").doc(`${user.uid}_${date}`));
  const snaps = await Promise.all(refs.map(ref => ref.get()));
  return snaps.map((snap, i) =>
    normalizeDaily(snap.exists ? snap.data() : null, dates[i], user.uid, user.email)
  );
}
async function analytics(db, userFilter = null) {
  const today = dhakaDate();
  const dates = Array.from({ length: DAY_COUNT }, (_, i) => subtractDays(today, i)).reverse();
  const users = await listUsers(db);
  const selectedUsers = userFilter ? users.filter(u => u.uid === userFilter) : users;

  const dailyByDate = new Map();
  for (const date of dates) dailyByDate.set(date, dailyEmpty(date, "", ""));
  const byUser = [];

  for (const user of selectedUsers) {
    const rows = await getUserDaily(db, user, dates);
    const userTotal = dailyEmpty("TOTAL", user.uid, user.email);
    for (const row of rows) {
      const d = dailyByDate.get(row.date);
      d.tweets += row.tweets;
      d.replies += row.replies;
      d.requestCount += row.requestCount;
      d.inputTokens += row.inputTokens;
      d.cachedInputTokens += row.cachedInputTokens;
      d.actualInputTokens += row.actualInputTokens;
      d.outputTokens += row.outputTokens;
      d.totalTokens += row.totalTokens;

      userTotal.tweets += row.tweets;
      userTotal.replies += row.replies;
      userTotal.requestCount += row.requestCount;
      userTotal.inputTokens += row.inputTokens;
      userTotal.cachedInputTokens += row.cachedInputTokens;
      userTotal.actualInputTokens += row.actualInputTokens;
      userTotal.outputTokens += row.outputTokens;
      userTotal.totalTokens += row.totalTokens;
    }
    byUser.push({
      ...userTotal,
      displayName: user.displayName,
      photoURL: user.photoURL,
      plan: user.planLabel,
      subscriptionStatus: user.subscriptionStatus
    });
  }

  const grand = Array.from(dailyByDate.values()).reduce((a, d) => ({
    tweets: a.tweets + d.tweets, replies: a.replies + d.replies,
    requestCount: a.requestCount + d.requestCount,
    inputTokens: a.inputTokens + d.inputTokens,
    cachedInputTokens: a.cachedInputTokens + d.cachedInputTokens,
    actualInputTokens: a.actualInputTokens + d.actualInputTokens,
    outputTokens: a.outputTokens + d.outputTokens,
    totalTokens: a.totalTokens + d.totalTokens
  }), { tweets: 0, replies: 0, requestCount: 0, inputTokens: 0,
        cachedInputTokens: 0, actualInputTokens: 0, outputTokens: 0, totalTokens: 0 });

  return {
    timeZone: TIME_ZONE,
    today,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    daily: Array.from(dailyByDate.values()),
    users: byUser,
    totals: grand
  };
}

export default async function handler(req, res) {
  try {
    const decoded = await requireUser(req);
    requireAdmin(decoded);
    const db = getDb();
    const admin = getFirebaseAdmin();

    if (req.method === "GET") {
      const action = req.query?.action || "overview";

      if (action === "users") return res.status(200).json({ users: await listUsers(db) });
      if (action === "requests") return res.status(200).json({ requests: await listRequests(db) });

      if (action === "analytics") {
        return res.status(200).json({
          analytics: await analytics(db, req.query?.uid || null)
        });
      }

      if (action === "userAnalytics") {
        const uid = req.query?.uid;
        if (!uid) return res.status(400).json({ error: "uid is required." });
        return res.status(200).json({ analytics: await analytics(db, uid) });
      }

      const [users, requests] = await Promise.all([listUsers(db), listRequests(db)]);
      const pending = requests.filter(r => r.status === "pending");
      return res.status(200).json({
        stats: {
          totalUsers: users.length,
          freeUsers: users.filter(u => u.subscriptionStatus !== "active").length,
          activeSubscribers: users.filter(u => u.subscriptionStatus === "active").length,
          pendingPayments: pending.length,
          totalTweetsSubmitted: users.reduce((n, u) => n + u.totalTweetsSubmitted, 0),
          totalRepliesGenerated: users.reduce((n, u) => n + u.totalRepliesGenerated, 0)
        },
        users, requests
      });
    }

    if (req.method === "POST") {
      const { action, requestId } = req.body || {};
      if (!requestId) return res.status(400).json({ error: "requestId is required." });

      const requestRef = db.collection("subscriptionRequests").doc(requestId);
      const requestSnap = await requestRef.get();
      if (!requestSnap.exists) return res.status(404).json({ error: "Payment request not found." });

      const request = requestSnap.data();
      if (request.status !== "pending") {
        return res.status(409).json({ error: `This request is already ${request.status}.` });
      }

      if (action === "reject") {
        await requestRef.update({
          status: "rejected", reviewedAt: timestamp(), reviewedBy: decoded.email || ""
        });
        return res.status(200).json({ success: true });
      }

      if (action !== "approve") return res.status(400).json({ error: "Invalid admin action." });

      const months = PLAN_MONTHS[request.plan];
      if (!months) return res.status(400).json({ error: "Invalid plan duration." });

      const userRef = db.collection("users").doc(request.uid);
      await db.runTransaction(async transaction => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists) throw new Error("User profile not found.");

        const user = userSnap.data();
        const now = new Date();
        let start = now;
        const currentExpiry = timestampToDate(user.subscriptionExpiry);
        if (user.subscriptionStatus === "active" && currentExpiry &&
            currentExpiry.getTime() > now.getTime()) start = currentExpiry;

        const expiry = addMonths(start, months);
        transaction.update(userRef, {
          plan: request.plan,
          planLabel: request.planLabel,
          subscriptionStatus: "active",
          subscriptionStart: admin.firestore.Timestamp.fromDate(start),
          subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiry),
          updatedAt: timestamp()
        });
        transaction.update(requestRef, {
          status: "approved", reviewedAt: timestamp(), reviewedBy: decoded.email || ""
        });
      });

      return res.status(200).json({ success: true, message: "Subscription approved." });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("Admin API error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Admin request failed.",
      code: error.code || "ADMIN_ERROR"
    });
  }
}
