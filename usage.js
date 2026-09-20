import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAgPi6rbLwIRNWHzNB1u_P82rBEVEmKTlY",
  authDomain: "auth.twitai.app",
  projectId: "twit-ai",
  storageBucket: "twit-ai.firebasestorage.app",
  messagingSenderId: "444927859336",
  appId: "1:444927859336:web:c51fd0a476d9b32bc79d3d"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const esc = value => {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
};
const fmt = n => Number(n || 0).toLocaleString();
const dateLabel = s => new Date(`${s}T12:00:00+06:00`).toLocaleDateString(undefined, {
  day: "2-digit", month: "short", year: "numeric"
});
const timeLabel = s => s ? new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

async function api(url) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in first.");
  const token = await user.getIdToken();
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Could not load usage.");
  return data;
}

function tokenCard(title, value, sub = "") {
  return `<div class="rounded-xl bg-slate-900/80 border border-slate-800 p-3">
    <div class="text-[9px] text-slate-500 uppercase">${title}</div>
    <div class="text-lg font-bold text-white mt-1">${fmt(value)}</div>
    ${sub ? `<div class="text-[9px] text-slate-600 mt-1">${sub}</div>` : ""}
  </div>`;
}

function inject() {
  const accountModal = document.getElementById("accountModal");
  if (!accountModal || document.getElementById("usageDetailsBtn")) return;

  const box = accountModal.querySelector("#subscribeFromAccount");
  if (!box) return;

  const button = document.createElement("button");
  button.id = "usageDetailsBtn";
  button.className = "w-full mt-3 py-3 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-200 font-semibold text-sm hover:bg-slate-700 transition";
  button.innerHTML = '<i class="fa-solid fa-chart-line mr-2 text-sky-400"></i> Usage & History';
  box.parentNode.insertBefore(button, box);

  const modal = document.createElement("div");
  modal.id = "usageDetailsModal";
  modal.className = "fixed inset-0 modal-backdrop z-[150] hidden items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass w-full max-w-2xl rounded-3xl p-5 sm:p-6 relative max-h-[92dvh] overflow-y-auto custom-scrollbar">
      <button id="usageClose" class="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-slate-800 text-slate-500 hover:text-white flex items-center justify-center">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="pr-10">
        <h2 class="text-lg font-bold text-white">Usage & History</h2>
        <p class="text-xs text-slate-500 mt-1">Last 30 days · Asia/Dhaka</p>
      </div>
      <div id="usageToday" class="mt-5"></div>
      <div class="mt-5">
        <h3 class="text-sm font-bold text-white mb-2">Daily usage</h3>
        <div class="overflow-x-auto rounded-xl border border-slate-800">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950/70 text-slate-500">
              <tr><th class="p-3">Date</th><th class="p-3">Tweets</th><th class="p-3">Replies</th><th class="p-3">Tokens</th></tr>
            </thead>
            <tbody id="usageDailyBody"></tbody>
          </table>
        </div>
      </div>
      <div id="usageDateDetails" class="mt-5"></div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  };
  const open = () => {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    load();
  };
  button.addEventListener("click", open);
  document.getElementById("usageClose").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  async function load() {
    const todayBox = document.getElementById("usageToday");
    todayBox.innerHTML = `<div class="text-xs text-slate-500">Loading usage...</div>`;
    try {
      const data = await api("/api/stats");
      const today = data.daily.find(x => x.date === data.today) || {};
      todayBox.innerHTML = `
        <div class="text-[10px] text-slate-500 uppercase mb-2">Today · ${dateLabel(data.today)}</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          ${tokenCard("Tweets", today.tweets)}
          ${tokenCard("Replies", today.replies)}
          ${tokenCard("Cached tokens", today.cachedInputTokens)}
          ${tokenCard("Actual input", today.actualInputTokens)}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
          ${tokenCard("Input tokens", today.inputTokens)}
          ${tokenCard("Output tokens", today.outputTokens)}
          ${tokenCard("Total tokens", today.totalTokens)}
        </div>`;

      const body = document.getElementById("usageDailyBody");
      body.innerHTML = data.daily.slice().reverse().map(row => `
        <tr class="border-t border-slate-800/70 cursor-pointer hover:bg-slate-800/40" data-usage-date="${row.date}">
          <td class="p-3 text-slate-300">${dateLabel(row.date)}</td>
          <td class="p-3 text-white">${fmt(row.tweets)}</td>
          <td class="p-3 text-white">${fmt(row.replies)}</td>
          <td class="p-3 text-slate-400">${fmt(row.totalTokens)}</td>
        </tr>`).join("");

      body.querySelectorAll("[data-usage-date]").forEach(row => {
        row.addEventListener("click", () => showDate(row.dataset.usageDate, data));
      });

      showDate(data.today, data);
    } catch (e) {
      todayBox.innerHTML = `<div class="text-xs text-rose-300">${esc(e.message)}</div>`;
    }
  }

  function showDate(date, data) {
    const row = data.daily.find(x => x.date === date) || {
      tweets: 0, replies: 0, inputTokens: 0, cachedInputTokens: 0,
      actualInputTokens: 0, outputTokens: 0, totalTokens: 0
    };
    const logs = data.logs.filter(x => x.date === date);
    document.getElementById("usageDateDetails").innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-2">
        <h3 class="text-sm font-bold text-white">${dateLabel(date)}</h3>
        <span class="text-[9px] text-slate-600">${logs.length} generation request${logs.length === 1 ? "" : "s"}</span>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        ${tokenCard("Tweets", row.tweets)}
        ${tokenCard("Replies", row.replies)}
        ${tokenCard("Cached", row.cachedInputTokens)}
        ${tokenCard("Actual input", row.actualInputTokens)}
      </div>
      <div class="mt-3 space-y-2">
        ${logs.length ? logs.map(log => `
          <div class="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
            <div class="flex justify-between gap-3 text-[9px] text-slate-500">
              <span>${timeLabel(log.createdAt)}</span>
              <span>${fmt(log.totalTokens)} total · ${fmt(log.cachedInputTokens)} cached</span>
            </div>
            <div class="text-xs text-slate-200 mt-2 whitespace-pre-wrap break-words">${esc(log.tweetText)}</div>
            <div class="text-[9px] text-slate-600 mt-2">${log.replies} replies · ${fmt(log.actualInputTokens)} actual input · ${fmt(log.outputTokens)} output</div>
          </div>`).join("")
        : `<div class="text-xs text-slate-600 py-4 text-center">No tweets submitted on this date.</div>`}
      </div>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", inject);
} else {
  inject();
}
onAuthStateChanged(auth, () => inject());
