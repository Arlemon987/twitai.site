import { getDb, requireUser, timestamp } from "./_firebase.js";
import { PAYMENT_CONFIG } from "./config.js";

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{20,200}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const decoded = await requireUser(req);
    const { plan, txHash } = req.body || {};

    if (!PAYMENT_CONFIG.plans[plan]) {
      return res.status(400).json({ error: "Invalid subscription plan." });
    }

    if (!txHash || !TX_HASH_REGEX.test(txHash.trim())) {
      return res.status(400).json({
        error: "Enter a valid transaction hash."
      });
    }

    const db = getDb();
    const userRef = db.collection("users").doc(decoded.uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(403).json({ error: "User profile not found." });
    }

    const pendingSnap = await db
      .collection("subscriptionRequests")
      .where("uid", "==", decoded.uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!pendingSnap.empty) {
      return res.status(409).json({
        error: "You already have a payment waiting for manual verification."
      });
    }

    const planData = PAYMENT_CONFIG.plans[plan];

    const ref = await db.collection("subscriptionRequests").add({
      uid: decoded.uid,
      email: decoded.email || "",
      plan,
      planLabel: planData.label,
      durationMonths: planData.months,
      amount: planData.amount,
      network: PAYMENT_CONFIG.network,
      paymentWallet: PAYMENT_CONFIG.wallet,
      transactionHash: txHash.trim(),
      status: "pending",
      submittedAt: timestamp(),
      reviewedAt: null,
      reviewedBy: null
    });

    return res.status(200).json({
      success: true,
      requestId: ref.id
    });
  } catch (error) {
    console.error("Subscribe API error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Could not submit payment.",
      code: error.code || "SUBSCRIBE_ERROR"
    });
  }
}
