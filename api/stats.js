import { getDb, requireUser } from "./_firebase.js";

const TIME_ZONE = "Asia/Dhaka";
const DAY_COUNT = 30;

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

function toISO(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate().toISOString();
  if (value._seconds !== undefined) return new Date(value._seconds * 1000).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeDaily(data, date) {
  return {
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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const decoded = await requireUser(req);
    const db = getDb();
    const today = dhakaDate();
    const start = subtractDays(today, DAY_COUNT - 1);

    const dates = Array.from({ length: DAY_COUNT }, (_, i) => subtractDays(today, i));
    const refs = dates.map(date => db.collection("usageDaily").doc(`${decoded.uid}_${date}`));
    const snaps = await Promise.all(refs.map(ref => ref.get()));

    const dailyMap = new Map();
    snaps.forEach((snap, i) => {
      dailyMap.set(dates[i], normalizeDaily(snap.exists ? snap.data() : null, dates[i]));
    });

    const daily = dates
      .slice()
      .reverse()
      .map(date => dailyMap.get(date));

    const startTimestamp = new Date(`${start}T00:00:00+06:00`);
    const logsSnap = await db.collection("generationLogs")
      .where("uid", "==", decoded.uid)
      .where("createdAt", ">=", startTimestamp)
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();

    const logs = logsSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        date: d.date || "",
        createdAt: toISO(d.createdAt),
        tweetText: d.tweetText || "",
        tweets: Number(d.tweets || 1),
        replies: Number(d.replies || 0),
        model: d.model || "",
        inputTokens: Number(d.inputTokens || 0),
        cachedInputTokens: Number(d.cachedInputTokens || 0),
        actualInputTokens: Number(d.actualInputTokens || 0),
        outputTokens: Number(d.outputTokens || 0),
        totalTokens: Number(d.totalTokens || 0)
      };
    });

    const todayLogs = logs.filter(log => log.date === today);

    const totals = daily.reduce((a, d) => ({
      tweets: a.tweets + d.tweets,
      replies: a.replies + d.replies,
      inputTokens: a.inputTokens + d.inputTokens,
      cachedInputTokens: a.cachedInputTokens + d.cachedInputTokens,
      actualInputTokens: a.actualInputTokens + d.actualInputTokens,
      outputTokens: a.outputTokens + d.outputTokens,
      totalTokens: a.totalTokens + d.totalTokens
    }), {
      tweets: 0, replies: 0, inputTokens: 0, cachedInputTokens: 0,
      actualInputTokens: 0, outputTokens: 0, totalTokens: 0
    });

    return res.status(200).json({
      timeZone: TIME_ZONE,
      today,
      startDate: start,
      daily,
      todayLogs,
      logs,
      totals
    });
  } catch (error) {
    console.error("Stats API error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Could not load usage statistics.",
      code: error.code || "STATS_ERROR"
    });
  }
}
