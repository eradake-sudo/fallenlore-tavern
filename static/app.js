const socket = io({
  transports: ["polling", "websocket"],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionAttempts: 20,
});
const store = {
  you: JSON.parse(localStorage.getItem("fallenlore-you") || "null"),
  chronicle: [],
  chapterId: null,
  messages: [],
  plot: "forest",
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

const ROOMS = [
  { id: "chapel", flicker: true, match: /chapel|cathedral|church|abbey|sanctum|blackveil/i },
  { id: "tavern", flicker: true, match: /tavern|inn|bar|pub|hearth/i },
  { id: "dungeon", flicker: true, match: /dungeon|crypt|cellar|cave|prison|under/i },
  { id: "camp", flicker: true, match: /camp|firelight|watch/i },
  { id: "road", flicker: false, match: /road|path|vale|ashford|forest|wood|march|trail/i },
];

function setRoom(location) {
  const app = $("app");
  const hit = ROOMS.find((r) => r.match.test(location || "")) || { id: "road", flicker: false };
  app.classList.remove("room-tavern", "room-chapel", "room-road", "room-camp", "room-dungeon", "flicker");
  app.classList.add("room-" + hit.id);
  if (hit.flicker) app.classList.add("flicker");
}

function paintState(state) {
  if (state.needs_code) $("code-row").classList.remove("hidden");
  $("camp-title").textContent = state.campaign.title || "Fallenlore";
  $("loc").textContent = state.campaign.location || "—";
  setRoom(state.campaign.location || "");
  $("when").textContent = state.campaign.time || "—";
  $("weather").textContent = state.campaign.weather || "—";
  $("recap").textContent = state.campaign.recap || "";
  $("api-hint").textContent = state.has_api_key
    ? "Grok is seated as DM."
    : "No API key yet — chat and dice work; DM replies will ask for a key.";
  const players = state.players || [];
  const paintPeople = (ul) => {
    if (!ul) return;
    ul.innerHTML = "";
    if (!players.length) {
      const li = document.createElement("li");
      li.textContent = "Empty benches.";
      ul.appendChild(li);
      return;
    }
    [...players]
      .sort((a, b) => Number(b.online) - Number(a.online))
      .forEach((p) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="dot ${p.online ? "on" : ""}"></span><strong>${escapeHtml(p.character)}</strong> <span style="color:var(--muted)">(${escapeHtml(p.name)}${p.cls ? " · " + escapeHtml(p.cls) : ""})</span> <em>${p.online ? "live" : "away"}</em>`;
        ul.appendChild(li);
      });
  };
  paintPeople($("party"));
  paintPeople($("seated-list"));
}

function parseRoll(text) {
  const total = (text.match(/=\s*\*\*(\d+)\*\*/) || text.match(/=\s*(\d+)/) || [])[1];
  const expr = (text.match(/(\d+d\d+(?:[+-]\d+)?)/i) || [])[1] || "dice";
  return { total: total || "?", expr };
}

function paintRolls(messages) {
  const ul = $("rolls-list");
  if (!ul) return;
  const rolls = (messages || []).filter((m) => m.kind === "roll");
  ul.innerHTML = "";
  if (!rolls.length) {
    const li = document.createElement("li");
    li.textContent = "No rolls yet.";
    ul.appendChild(li);
    return;
  }
  rolls.slice().reverse().forEach((m) => {
    const { total, expr } = parseRoll(m.text);
    const li = document.createElement("li");
    li.innerHTML = `<span class="roll-total">${escapeHtml(total)}</span><div><strong>${escapeHtml(m.character || m.name)}</strong> ${escapeHtml(expr)}<div class="roll-when">${escapeHtml((m.ts || "").replace("T", " ").slice(0, 19))}</div></div>`;
    ul.appendChild(li);
  });
}

function flashDice(m) {
  const { total, expr } = parseRoll(m.text || "");
  const flash = $("dice-flash");
  const wrap = $("die-wrap");
  const result = $("die-face");
  $("dice-who").textContent = m.character || m.name || "Dice";
  $("dice-expr").textContent = expr;
  result.textContent = "";
  result.classList.remove("show");
  wrap.classList.remove("roll-in");
  void wrap.offsetWidth;
  flash.classList.remove("hidden");
  wrap.classList.add("roll-in");
  setTimeout(() => {
    result.textContent = total;
    result.classList.add("show");
  }, 1150);
  clearTimeout(flash._hide);
  flash._hide = setTimeout(() => flash.classList.add("hidden"), 2800);
}

function paintLog(messages) {
  store.messages = messages || [];
  logEl.innerHTML = "";
  store.messages.filter((m) => m.kind !== "roll").forEach((m) => logEl.appendChild(renderMessage(m)));
  logEl.scrollTop = logEl.scrollHeight;
  paintRolls(store.messages);
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

function paintWorks(works) {
  store.works = works || store.works || {};
  const w = store.works;
  const pid = store.plot || "forest";
  const plot = (w.plots || {})[pid] || {};
  if ($("plot-art") && plot.image) $("plot-art").src = plot.image;
  if ($("plot-status")) {
    $("plot-status").textContent = plot.spent
      ? `${plot.name} is cut out until dawn.`
      : `Tap the stand. ${plot.taken || 0} / ${plot.cap || 0} ${plot.mat || ""} today · ${plot.per_click || 1} per swing`;
  }
  ["forest", "mine", "quarry", "ruin"].forEach((id) => {
    const tab = $("tab-" + id);
    if (tab) tab.classList.toggle("on", id === pid);
  });
  const slots = $("yard-slots");
  if (slots) {
    slots.innerHTML = "";
    (w.built || []).forEach((id) => {
      const img = document.createElement("img");
      img.src = `/static/works/${id}.jpg`;
      img.alt = id;
      slots.appendChild(img);
    });
    if (!(w.built || []).length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Nothing raised yet.";
      slots.appendChild(p);
    }
  }
  const crate = $("works-crate");
  if (crate) {
    const mats = w.materials || {};
    crate.innerHTML = "";
    ["oak", "iron", "stone", "cloth", "cinder", "relic"].forEach((k) => {
      const d = document.createElement("div");
      d.innerHTML = `<strong>${mats[k] || 0}</strong><span>${k}</span>`;
      crate.appendChild(d);
    });
  }
  const tools = $("works-tools");
  if (tools) {
    tools.innerHTML = "";
    Object.entries(w.tools || {}).forEach(([id, t]) => {
      const b = document.createElement("button");
      b.type = "button";
      if (!t.next) {
        b.textContent = `${t.name} tier ${t.level} · ${t.per_click}/click · maxed`;
        b.disabled = true;
      } else {
        const cost = Object.entries(t.next).map(([k, n]) => `${n} ${k}`).join(", ");
        b.textContent = `Upgrade ${t.name} to tier ${t.level + 1} (${cost})`;
        b.addEventListener("click", () => {
          if (!store.you) return;
          socket.emit("works_upgrade", { ...store.you, tool: id });
        });
      }
      tools.appendChild(b);
    });
  }
  const builds = $("works-builds");
  if (builds) {
    builds.innerHTML = "";
    Object.entries(w.builds || {}).forEach(([id, spec]) => {
      const b = document.createElement("button");
      b.type = "button";
      const need = Object.entries(spec.need || {}).map(([k, n]) => `${n} ${k}`).join(", ");
      const up = (w.built || []).includes(id);
      b.textContent = up ? `${spec.name} stands` : `${spec.name} — ${need}`;
      b.disabled = up;
      if (!up) {
        b.addEventListener("click", () => {
          if (!store.you) return;
          socket.emit("works_build", { ...store.you, id });
        });
      }
      builds.appendChild(b);
    });
  }
}

socket.on("hello", (d) => {
  if (d && d.needs_code) $("code-row").classList.remove("hidden");
});

socket.on("state", (state) => {
  paintState(state);
  if (state.messages) paintLog(state.messages);
  if (state.chronicle) paintBook(state.chronicle, store.chapterId);
  if (state.works) paintWorks(state.works);
});

socket.on("works", (w) => paintWorks(w));

socket.on("works_toast", ({ text }) => {
  const flo = $("plot-float");
  if (flo && text && text.startsWith("+")) {
    flo.textContent = text;
    flo.classList.remove("hidden");
    clearTimeout(flo._hide);
    flo._hide = setTimeout(() => flo.classList.add("hidden"), 500);
  }
  const el = $("works-toast");
  el.textContent = text || "";
  el.classList.remove("hidden");
  clearTimeout(el._hide);
  el._hide = setTimeout(() => el.classList.add("hidden"), 1800);
});

socket.on("chronicle", (list) => paintBook(list, store.chapterId));

socket.on("message", (m) => {
  store.messages.push(m);
  if (m.kind === "roll") {
    flashDice(m);
    paintRolls(store.messages);
    return;
  }
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
  const codeEl = $("code");
  socket.emit("join", {
    name: $("name").value.trim(),
    character: $("character").value.trim() || $("name").value.trim(),
    cls: $("cls").value.trim(),
    code: codeEl ? codeEl.value.trim() : "",
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

$("open-works").addEventListener("click", () => $("works").classList.remove("hidden"));
$("close-works").addEventListener("click", () => $("works").classList.add("hidden"));
["forest", "mine", "quarry", "ruin"].forEach((id) => {
  $("tab-" + id).addEventListener("click", () => {
    store.plot = id;
    paintWorks(store.works);
  });
});
$("plot-hit").addEventListener("click", () => {
  if (!store.you) return;
  socket.emit("works_chop", { ...store.you, plot: store.plot || "forest" });
});
$("open-seated").addEventListener("click", () => $("seated").classList.remove("hidden"));
$("close-seated").addEventListener("click", () => $("seated").classList.add("hidden"));
$("open-rolls").addEventListener("click", () => $("rolls").classList.remove("hidden"));
$("close-rolls").addEventListener("click", () => $("rolls").classList.add("hidden"));

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
