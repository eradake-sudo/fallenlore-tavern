const socket = io();
const store = {
  you: JSON.parse(localStorage.getItem("fallenlore-you") || "null"),
};

const $ = (id) => document.getElementById(id);
const gate = $("gate");
const appEl = $("app");
const logEl = $("log");

function showApp() {
  gate.classList.add("hidden");
  appEl.classList.remove("hidden");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatBody(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderMessage(m) {
  const el = document.createElement("article");
  el.className = `msg ${m.kind}`;
  const label =
    m.kind === "dm"
      ? "Dungeon Master"
      : m.kind === "system"
        ? "Tavern"
        : `${m.character || m.name}${m.kind === "ooc" ? " · OOC" : m.kind === "roll" ? " · roll" : ""}`;
  el.innerHTML = `<div class="who">${escapeHtml(label)}</div><div class="body">${formatBody(m.text)}</div>`;
  return el;
}

function paintState(state) {
  if (state.needs_code) $("code-row").classList.remove("hidden");
  $("camp-title").textContent = state.campaign.title || "Fallenlore";
  $("loc").textContent = state.campaign.location || "—";
  $("when").textContent = state.campaign.time || "—";
  $("weather").textContent = state.campaign.weather || "—";
  $("recap").textContent = state.campaign.recap || "";
  $("api-hint").textContent = state.has_api_key
    ? "Grok is seated as DM."
    : "No API key yet — chat and dice work; DM replies will ask for a key.";
  const ul = $("party");
  ul.innerHTML = "";
  (state.players || []).forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dot ${p.online ? "on" : ""}"></span><strong>${escapeHtml(p.character)}</strong> <span style="color:var(--muted)">(${escapeHtml(p.name)}${p.cls ? " · " + escapeHtml(p.cls) : ""})</span>`;
    ul.appendChild(li);
  });
}

function paintLog(messages) {
  logEl.innerHTML = "";
  (messages || []).forEach((m) => logEl.appendChild(renderMessage(m)));
  logEl.scrollTop = logEl.scrollHeight;
}

socket.on("state", (state) => {
  paintState(state);
  if (state.messages) paintLog(state.messages);
});

socket.on("message", (m) => {
  logEl.appendChild(renderMessage(m));
  logEl.scrollTop = logEl.scrollHeight;
});

socket.on("dm_thinking", ({ thinking }) => {
  $("thinking").classList.toggle("hidden", !thinking);
  if (thinking) logEl.scrollTop = logEl.scrollHeight;
});

socket.on("join_error", ({ error }) => {
  $("join-error").textContent = error;
});

socket.on("joined", ({ you }) => {
  store.you = you;
  localStorage.setItem("fallenlore-you", JSON.stringify(you));
  showApp();
});

$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  socket.emit("join", {
    name: $("name").value.trim(),
    character: $("character").value.trim() || $("name").value.trim(),
    cls: $("cls").value.trim(),
    code: $("code").value.trim(),
  });
});

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!store.you) return;
  const text = $("text").value.trim();
  if (!text) return;
  const kind = document.querySelector('input[name="kind"]:checked').value;
  socket.emit("chat", { ...store.you, text, kind });
  $("text").value = "";
});

$("quick-roll").addEventListener("click", () => {
  if (!store.you) return;
  socket.emit("chat", { ...store.you, text: "/roll 1d20", kind: "roll" });
});

$("summon").addEventListener("click", () => {
  if (!store.you) return;
  socket.emit("summon_dm", store.you);
});

$("toggle-panel").addEventListener("click", () => {
  $("panel").classList.toggle("open");
});

$("text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

window.addEventListener("beforeunload", () => {
  if (store.you) socket.emit("leave_notice", store.you);
});

if (store.you) {
  $("name").value = store.you.name || "";
  $("character").value = store.you.character || "";
  $("cls").value = store.you.cls || "";
}
