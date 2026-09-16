function timestampToDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (
    typeof value === "object" &&
    value._seconds !== undefined
  ) {
    return new Date(
      value._seconds * 1000 +
      Math.floor((value._nanoseconds || 0) / 1000000)
    );
  }

  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function timestampToISO(value) {
  const date = timestampToDate(value);
  return date ? date.toISOString() : null;
}



import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

function requireAdmin(decoded) {
  if (!ADMIN_EMAIL || (decoded.email || "").toLowerCase() !== ADMIN_EMAIL) {
    const error = new Error("Admin access denied.");
    error.statusCode = 403;
    error.code = "ADMIN_FORBIDDEN";
    throw error;
  }
}

const PLAN_MONTHS = {
  month: 1,
  three_months: 3,
  six_months: 6,
  year: 12
};

function addMonths(date, months) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setMonth(result.getMonth() + months);

  // Handle month-end rollover.
  if (result.getDate() !== originalDay) {
    result.setDate(0);
  }

  return result;
}

async function listUsers(db) {
  const snap = await db.collection("users").orderBy("createdAt", "desc").get();

  return snap.docs.map((doc) => {
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
      freeTweetsUsed: data.freeTweetsUsed || 0,
      totalTweetsSubmitted: data.totalTweetsSubmitted || 0,
      totalRepliesGenerated: data.totalRepliesGenerated || 0,
     createdAt: timestampToISO(data.createdAt)
    };
  });
}

async function listRequests(db) {
  const snap = await db
    .collection("subscriptionRequests")
    .orderBy("submittedAt", "desc")
    .limit(200)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

export default async function handler(req, res) {
  try {
    const decoded = await requireUser(req);
    requireAdmin(decoded);

    const db = getDb();
    const admin = getFirebaseAdmin();

    if (req.method === "GET") {
      const action = req.query?.action || "overview";

      if (action === "users") {
        return res.status(200).json({
          users: await listUsers(db)
        });
      }

      if (action === "requests") {
        return res.status(200).json({
          requests: await listRequests(db)
        });
      }

      const [users, requests] = await Promise.all([
        listUsers(db),
        listRequests(db)
      ]);

      const pending = requests.filter((r) => r.status === "pending");

      return res.status(200).json({
        stats: {
          totalUsers: users.length,
          freeUsers: users.filter((u) => u.subscriptionStatus !== "active").length,
          activeSubscribers: users.filter((u) => u.subscriptionStatus === "active").length,
          pendingPayments: pending.length,
          totalTweetsSubmitted: users.reduce((n, u) => n + (u.totalTweetsSubmitted || 0), 0),
          totalRepliesGenerated: users.reduce((n, u) => n + (u.totalRepliesGenerated || 0), 0)
        },
        users,
        requests
      });
    }

    if (req.method === "POST") {
      const { action, requestId } = req.body || {};

      if (!requestId) {
        return res.status(400).json({ error: "requestId is required." });
      }

      const requestRef = db.collection("subscriptionRequests").doc(requestId);
      const requestSnap = await requestRef.get();

      if (!requestSnap.exists) {
        return res.status(404).json({ error: "Payment request not found." });
      }

      const request = requestSnap.data();

      if (request.status !== "pending") {
        return res.status(409).json({
          error: `This request is already ${request.status}.`
        });
      }

      if (action === "reject") {
        await requestRef.update({
          status: "rejected",
          reviewedAt: timestamp(),
          reviewedBy: decoded.email || ""
        });

        return res.status(200).json({ success: true });
      }

      if (action !== "approve") {
        return res.status(400).json({ error: "Invalid admin action." });
      }

      const months = PLAN_MONTHS[request.plan];
      if (!months) {
        return res.status(400).json({ error: "Invalid plan duration." });
      }

      const userRef = db.collection("users").doc(request.uid);

      await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);

        if (!userSnap.exists) {
          throw new Error("User profile not found.");
        }

        const user = userSnap.data();
        const now = new Date();

        let start = now;
      const currentExpiry = timestampToDate(
  user.subscriptionExpiry
);

if (
  user.subscriptionStatus === "active" &&
  currentExpiry &&
  currentExpiry.getTime() > now.getTime()
) {
  start = currentExpiry;
}

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
          status: "approved",
          reviewedAt: timestamp(),
          reviewedBy: decoded.email || ""
        });
      });

      return res.status(200).json({
        success: true,
        message: "Subscription approved."
      });
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
