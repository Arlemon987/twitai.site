import { getDb, requireUser, timestamp } from "./_firebase.js";

function timestampToDate(value) {
  if (!value) return null;

  // Firestore Timestamp
  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  // Firestore serialized timestamp
  if (typeof value === "object" && value._seconds !== undefined) {
    return new Date(
      value._seconds * 1000 +
      Math.floor((value._nanoseconds || 0) / 1000000)
    );
  }

  // Normal Date
  if (value instanceof Date) {
    return value;
  }

  // String / number
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampToISO(value) {
  const date = timestampToDate(value);
  return date ? date.toISOString() : null;
}

function activeSubscription(data) {
  const expiry = timestampToDate(data.subscriptionExpiry);

  return (
    data.subscriptionStatus === "active" &&
    expiry &&
    expiry.getTime() > Date.now()
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const decoded = await requireUser(req);

    const db = getDb();

    const userRef = db.collection("users").doc(decoded.uid);

    let snap = await userRef.get();

    // Create user profile automatically after Google login.
    if (!snap.exists) {
      await userRef.set({
        uid: decoded.uid,
        email: decoded.email || "",
        displayName: decoded.name || "",
        photoURL: decoded.picture || "",

        freeTweetsUsed: 0,

        totalTweetsSubmitted: 0,
        totalRepliesGenerated: 0,

        plan: "free",
        planLabel: "Free",

        subscriptionStatus: "free",
        subscriptionStart: null,
        subscriptionExpiry: null,

        createdAt: timestamp(),
        updatedAt: timestamp()
      });

      snap = await userRef.get();
    }

    const data = snap.data();

    const expiryDate = timestampToDate(
      data.subscriptionExpiry
    );

    const isCurrentlyActive =
      data.subscriptionStatus === "active" &&
      expiryDate &&
      expiryDate.getTime() > Date.now();

    // Lazily expire subscriptions.
    if (
      data.subscriptionStatus === "active" &&
      expiryDate &&
      expiryDate.getTime() <= Date.now()
    ) {
      await userRef.update({
        subscriptionStatus: "expired",
        updatedAt: timestamp()
      });

      data.subscriptionStatus = "expired";
    }

    const pendingSnap = await db
      .collection("subscriptionRequests")
      .where("uid", "==", decoded.uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    const pendingPayment = !pendingSnap.empty;

    let subscriptionStatus;

    if (isCurrentlyActive) {
      subscriptionStatus = "active";
    } else if (data.subscriptionStatus === "expired") {
      subscriptionStatus = "expired";
    } else if (pendingPayment) {
      subscriptionStatus = "pending";
    } else {
      subscriptionStatus = data.subscriptionStatus || "free";
    }

    return res.status(200).json({
      uid: decoded.uid,

      email: data.email || decoded.email || "",

      displayName:
        data.displayName ||
        decoded.name ||
        "",

      photoURL:
        data.photoURL ||
        decoded.picture ||
        "",

      freeTweetsUsed:
        Number(data.freeTweetsUsed || 0),

      totalTweetsSubmitted:
        Number(data.totalTweetsSubmitted || 0),

      totalRepliesGenerated:
        Number(data.totalRepliesGenerated || 0),

      plan:
        data.plan || "free",

      planLabel:
        data.planLabel || "Free",

      subscriptionStatus,

      subscriptionStart:
        timestampToISO(data.subscriptionStart),

      subscriptionExpiry:
        timestampToISO(data.subscriptionExpiry),

      pendingPayment
    });

  } catch (error) {
    console.error("Me API error:", error);

    return res.status(error.statusCode || 500).json({
      error:
        error.message ||
        "Could not load account.",

      code:
        error.code ||
        "ME_ERROR"
    });
  }
}
