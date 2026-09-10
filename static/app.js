const socket = io();
const store = {
  you: JSON.parse(localStorage.getItem("fallenlore-you") || "null"),
  chronicle: [],
  chapterId: null,
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

function paintBook(list, stayOnId) {
  store.chronicle = list || [];
  const toc = $("book-toc");
  toc.innerHTML = "";
  if (!store.chronicle.length) {
    $("book-title").textContent = "Empty binding";
    $("book-meta").textContent = "";
    $("book-body").textContent = "No pages yet. Play a scene, then write last session into the book.";
    return;
  }
  store.chronicle.forEach((ch, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = ch.title || `Leaf ${i + 1}`;
    b.addEventListener("click", () => showChapter(ch.id));
    toc.appendChild(b);
  });
  const pick = stayOnId && store.chronicle.find((c) => c.id === stayOnId)
    ? stayOnId
    : store.chronicle[store.chronicle.length - 1].id;
  showChapter(pick);
}

function showChapter(id) {
  const ch = store.chronicle.find((c) => c.id === id) || store.chronicle[0];
  if (!ch) return;
  store.chapterId = ch.id;
  $("book-title").textContent = ch.title || "Untitled leaf";
  $("book-meta").textContent = ch.ts ? ch.ts.replace("T", " ").replace("+00:00", " UTC") : "";
  $("book-body").textContent = ch.body || "";
  [...$("book-toc").children].forEach((btn) => {
    btn.classList.toggle("on", btn.textContent === ch.title);
  });
}

socket.on("state", (state) => {
  paintState(state);
  if (state.messages) paintLog(state.messages);
  if (state.chronicle) paintBook(state.chronicle, store.chapterId);
});

socket.on("chronicle", (list) => paintBook(list, store.chapterId));

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

$("open-book").addEventListener("click", () => {
  $("book").classList.remove("hidden");
  if (store.chronicle.length) showChapter(store.chapterId || store.chronicle.at(-1).id);
});
$("close-book").addEventListener("click", () => $("book").classList.add("hidden"));

function writeChapter(focus) {
  if (!store.you) return;
  $("book").classList.add("hidden");
  socket.emit("write_chapter", { ...store.you, focus });
}
$("write-session").addEventListener("click", () => writeChapter("last session"));
$("write-campaign").addEventListener("click", () => writeChapter("the whole campaign so far"));

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
