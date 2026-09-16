import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

function activeSubscription(data) {
  return (
    data.subscriptionStatus === "active" &&
    data.subscriptionExpiry &&
    new Date(data.subscriptionExpiry).getTime() > Date.now()
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const decoded = await requireUser(req);
    const db = getDb();
    const userRef = db.collection("users").doc(decoded.uid);
    const snap = await userRef.get();

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
        subscriptionStatus: "free",
        subscriptionStart: null,
        subscriptionExpiry: null,
        createdAt: timestamp(),
        updatedAt: timestamp()
      });
    }

    const fresh = await userRef.get();
    const data = fresh.data();

    // Expire an old subscription lazily.
    if (
      data.subscriptionStatus === "active" &&
      data.subscriptionExpiry &&
      new Date(data.subscriptionExpiry).getTime() <= Date.now()
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

    const isActive = activeSubscription(data);

    return res.status(200).json({
      uid: decoded.uid,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL,
      freeTweetsUsed: data.freeTweetsUsed || 0,
      totalTweetsSubmitted: data.totalTweetsSubmitted || 0,
      totalRepliesGenerated: data.totalRepliesGenerated || 0,
      plan: data.plan || "free",
      planLabel: data.planLabel || "Free",
      subscriptionStatus: isActive ? "active" : data.subscriptionStatus || "free",
      subscriptionStart: data.subscriptionStart || null,
      subscriptionExpiry: data.subscriptionExpiry || null,
      pendingPayment
    });
  } catch (error) {
    console.error("Me API error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Could not load account.",
      code: error.code || "ME_ERROR"
    });
  }
}
