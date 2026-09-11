#!/usr/bin/env python3
"""Fallenlore Tavern — shared chat-room D&D with Grok as DM."""

from __future__ import annotations

import eventlet

eventlet.monkey_patch()

import json
import os
import random
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

# Railway volume mount (set in dashboard to /data) wins over local ./data
_volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH") or os.getenv("DATA_DIR")
DATA_DIR = Path(_volume) if _volume else ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SAVE_PATH = DATA_DIR / "campaign.json"
WORLD_PATH = ROOT / "campaign" / "WORLD.md"

XAI_API_KEY = os.getenv("XAI_API_KEY", "").strip()
GROK_MODEL = os.getenv("GROK_MODEL", "grok-4").strip() or "grok-4"
ROOM_CODE = os.getenv("ROOM_CODE", "").strip()
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "5000"))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "fallenlore-keep-this-local")
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_interval=20,
    ping_timeout=60,
    logger=False,
    engineio_logger=False,
)

SAVE_LOCK = threading.Lock()
DICE_RE = re.compile(
    r"/roll\s+(\d{1,3})d(\d{1,3})([+-]\d{1,3})?",
    re.IGNORECASE,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_world() -> str:
    if WORLD_PATH.exists():
        return WORLD_PATH.read_text(encoding="utf-8")
    return "Fallenlore. Infernal threat. D&D 5e."


def default_state() -> dict:
    return {
        "campaign": {
            "title": "Asmodeus: Demonic Threat in Fallenlore",
            "location": "Ashford Vale — the road to Blackveil",
            "time": "Dusk, late autumn",
            "weather": "A dry wind that smells faintly of cinders",
            "recap": (
                "The veil over Fallenlore is thinning. Contracts, cults, and "
                "polite devils have begun to surface. The party stands at the "
                "edge of that story."
            ),
        },
        "players": {},
        "chronicle": [
            {
                "id": "opening",
                "ts": now_iso(),
                "title": "The veil thins",
                "body": (
                    "The veil over Fallenlore is thinning. Contracts, cults, and "
                    "polite devils have begun to surface. The party stands on the "
                    "road through Ashford Vale toward Blackveil."
                ),
            }
        ],
        "messages": [
            {
                "id": "welcome",
                "ts": now_iso(),
                "kind": "system",
                "name": "Tavern",
                "character": "",
                "text": (
                    "The oak door of the Fallenlore Tavern closes behind you. "
                    "A fire burns low. The DM is in the high-backed chair by "
                    "the map. Join with your name and character, then take an action."
                ),
            }
        ],
        "works": {
            "materials": {"oak": 0, "stone": 0, "iron": 0, "cloth": 0, "cinder": 0, "relic": 0},
            "built": [],
            "stamina": 6,
            "stamina_day": "",
            "log": [],
        },
    }


def load_state() -> dict:
    if SAVE_PATH.exists():
        try:
            data = json.loads(SAVE_PATH.read_text(encoding="utf-8"))
            base = default_state()
            base.update(data)
            base.setdefault("campaign", default_state()["campaign"])
            base.setdefault("players", {})
            base.setdefault("messages", [])
            base.setdefault("chronicle", default_state()["chronicle"])
            base.setdefault("works", default_state()["works"])
            return base
        except Exception:
            pass
    return default_state()


def save_state(state: dict) -> None:
    tmp = SAVE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SAVE_PATH)


STATE = load_state()

WORKS_SITES = {
    "copse": {"name": "Ashford copse", "give": "oak", "lo": 2, "hi": 4},
    "quarry": {"name": "Cut quarry", "give": "stone", "lo": 2, "hi": 4},
    "slag": {"name": "Slag pit", "give": "iron", "lo": 1, "hi": 3},
    "hamlet": {"name": "Burned hamlet", "give": "cloth", "lo": 1, "hi": 3},
    "cellar": {"name": "Chapel cellar", "give": "cinder", "lo": 1, "hi": 2},
}
WORKS_BUILDS = {
    "palisade": {"name": "Palisade", "need": {"oak": 8, "stone": 4}},
    "watchpost": {"name": "Watchpost", "need": {"oak": 6, "iron": 4}},
    "bunkhouse": {"name": "Bunkhouse", "need": {"oak": 10, "cloth": 4}},
    "shrine": {"name": "Wayside shrine", "need": {"stone": 6, "cinder": 3}},
    "workshop": {"name": "Workshop", "need": {"oak": 6, "iron": 8}},
}


def _works_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def ensure_works() -> dict:
    w = STATE.setdefault("works", default_state()["works"])
    w.setdefault("materials", default_state()["works"]["materials"])
    w.setdefault("built", [])
    w.setdefault("log", [])
    if w.get("stamina_day") != _works_day():
        w["stamina"] = 6
        w["stamina_day"] = _works_day()
    return w


def public_works() -> dict:
    with SAVE_LOCK:
        w = ensure_works()
        return {
            "materials": dict(w["materials"]),
            "built": list(w["built"]),
            "stamina": w["stamina"],
            "stamina_max": 6,
            "log": list(w["log"][-12:]),
            "sites": {k: {"name": v["name"]} for k, v in WORKS_SITES.items()},
            "builds": WORKS_BUILDS,
        }


def public_state() -> dict:
    with SAVE_LOCK:
        return {
            "campaign": STATE["campaign"],
            "players": list(STATE["players"].values()),
            "messages": STATE["messages"][-200:],
            "chronicle": STATE.get("chronicle", []),
            "works": public_works(),
            "has_api_key": bool(XAI_API_KEY),
            "needs_code": bool(ROOM_CODE),
        }


def add_message(kind: str, name: str, text: str, character: str = "") -> dict:
    msg = {
        "id": f"{int(datetime.now().timestamp() * 1000)}-{random.randint(100,999)}",
        "ts": now_iso(),
        "kind": kind,
        "name": name,
        "character": character,
        "text": text,
    }
    with SAVE_LOCK:
        STATE["messages"].append(msg)
        if len(STATE["messages"]) > 800:
            STATE["messages"] = STATE["messages"][-500:]
        save_state(STATE)
    return msg


def add_chapter(title: str, body: str) -> dict:
    chapter = {
        "id": f"ch-{int(datetime.now().timestamp())}",
        "ts": now_iso(),
        "title": (title or "Untitled leaf").strip()[:80],
        "body": (body or "").strip()[:4000],
    }
    with SAVE_LOCK:
        STATE.setdefault("chronicle", [])
        STATE["chronicle"].append(chapter)
        if len(STATE["chronicle"]) > 80:
            STATE["chronicle"] = STATE["chronicle"][-80:]
        recap = chapter["body"].split("\n")[0][:400]
        STATE["campaign"]["recap"] = recap
        save_state(STATE)
    return chapter


def apply_status_line(text: str) -> None:
    m = re.search(r"(?im)^STATUS:\s*(.+)$", text)
    if not m:
        return
    parts = [p.strip() for p in re.split(r"—|–|-", m.group(1)) if p.strip()]
    with SAVE_LOCK:
        if parts:
            STATE["campaign"]["location"] = parts[0][:120]
        if len(parts) > 1:
            STATE["campaign"]["time"] = parts[1][:80]
        if len(parts) > 2:
            STATE["campaign"]["recap"] = parts[2][:400]
        save_state(STATE)


def parse_chapter(text: str, fallback_title: str) -> tuple[str, str]:
    title = fallback_title
    body = text.strip()
    m = re.search(r"(?im)^TITLE:\s*(.+)$", text)
    if m:
        title = m.group(1).strip()
        body = re.sub(r"(?im)^TITLE:\s*.+$", "", text, count=1)
        body = re.sub(r"(?im)^BODY:\s*", "", body, count=1).strip()
    return title[:80], body[:4000]


def roll_dice(expr: str) -> str | None:
    m = DICE_RE.search(expr)
    if not m:
        return None
    n, sides, mod = int(m.group(1)), int(m.group(2)), m.group(3)
    n = max(1, min(n, 40))
    sides = max(2, min(sides, 100))
    rolls = [random.randint(1, sides) for _ in range(n)]
    total = sum(rolls)
    bonus = 0
    if mod:
        bonus = int(mod)
        total += bonus
    shown = ", ".join(str(r) for r in rolls)
    bonus_txt = f" {mod}" if mod else ""
    return f"🎲 {n}d{sides}{bonus_txt} → [{shown}] = **{total}**"


def build_dm_messages(trigger: str) -> list[dict]:
    world = load_world()
    with SAVE_LOCK:
        campaign = json.dumps(STATE["campaign"], indent=2)
        players = json.dumps(list(STATE["players"].values()), indent=2)
        history = STATE["messages"][-28:]

    system = (
        "You are the Dungeon Master seated in the Fallenlore Tavern chat room. "
        "Several human players drop in through the day. Stay in voice.\n\n"
        "Hard rules:\n"
        "- Never break character. Out-of-character table talk is hidden from you.\n"
        "- Do not play the player characters. Prompt them. Offer the world.\n"
        "- Treat posted dice results as the only official rolls.\n"
        "- Keep replies tight enough for mobile chat: 1–4 short paragraphs, plus "
        "NPC dialogue when it matters. End with a clear question or two choices "
        "when the scene needs a decision.\n"
        "- If multiple players acted, resolve in the order they spoke.\n"
        "- Update the living world: name NPCs, mark consequences, advance time "
        "when a scene closes.\n"
        "- After a major beat, include a one-line STATUS: Location — Time — open hook.\n"
        "- If the chat log already has a scene in progress, CONTINUE that scene. "
        "Never open a new road, farmer, or town unless the log closed the last scene.\n"
        "- The website welcome line is flavor, not a new adventure.\n\n"
        f"CAMPAIGN STATE:\n{campaign}\n\n"
        f"PARTY AT THE TABLE:\n{players}\n\n"
        f"WORLD BIBLE:\n{world}"
    )
    msgs = [{"role": "system", "content": system}]
    for m in history:
        if m["kind"] in {"system", "ooc", "join"}:
            continue
        role = "assistant" if m["kind"] == "dm" else "user"
        who = m.get("character") or m.get("name") or "Player"
        prefix = {
            "dm": "DM",
            "action": f"{who} (ACTION)",
            "say": f"{who} (says)",
            "ooc": f"{who} (OOC)",
            "roll": f"{who} (ROLL)",
            "join": "TABLE",
        }.get(m["kind"], who)
        msgs.append({"role": role, "content": f"{prefix}: {m['text']}"})
    msgs.append(
        {
            "role": "user",
            "content": (
                "Resolve the latest table activity now. "
                f"Latest trigger: {trigger}"
            ),
        }
    )
    return msgs


def call_grok(trigger: str) -> str:
    if not XAI_API_KEY:
        return (
            "The high-backed chair is empty until an xAI API key is placed in "
            "the tavern's `.env` file. Chat and dice still work. Add "
            "`XAI_API_KEY=xai-...` then restart, and the DM will sit down."
        )
    payload = {
        "model": GROK_MODEL,
        "messages": build_dm_messages(trigger),
        "temperature": 0.85,
        "max_tokens": 1200,
    }
    try:
        r = requests.post(
            "https://api.x.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=90,
        )
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        return f"The DM's voice snags on the veil. (API error: {exc})"


def dm_reply(trigger: str, save_chapter: bool = False, chapter_title: str = "") -> None:
    """Run the API call on a real thread so chat is not frozen while Grok thinks."""
    socketio.emit("dm_thinking", {"thinking": True})

    def work() -> None:
        try:
            local_trigger = trigger
            if save_chapter:
                local_trigger = (
                    "Write a chronicle chapter for the campaign bible. "
                    "This will be read later like a book, not played as a live scene. "
                    "Do not ask 'what do you do?'. Do not start a new adventure. "
                    "First line exactly: TITLE: <short chapter title>\n"
                    "Then BODY: and 2–6 short paragraphs covering what happened, "
                    "who is angry, where the party is, and the open hook.\n"
                    f"Focus: {trigger}"
                )
            text = call_grok(local_trigger)
            apply_status_line(text)
            msg = add_message("dm", "DM", text, character="Dungeon Master")
            socketio.emit("message", msg)
            socketio.emit("state", public_state())
            if save_chapter:
                title, body = parse_chapter(text, chapter_title or "Session leaf")
                chapter = add_chapter(title, body)
                socketio.emit("chronicle", public_state()["chronicle"])
                note = add_message(
                    "system",
                    "Tavern",
                    f"A page is bound into the chronicle: {chapter['title']}",
                )
                socketio.emit("message", note)
                socketio.emit("state", public_state())
        finally:
            socketio.emit("dm_thinking", {"thinking": False})

    threading.Thread(target=work, daemon=True).start()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True, "save": str(SAVE_PATH)})


@socketio.on("connect")
def on_connect():
    emit("state", public_state())


@socketio.on("join")
def on_join(data):
    data = data or {}
    code = str(data.get("code") or "").strip()
    if ROOM_CODE and code != ROOM_CODE:
        emit("join_error", {"error": "Wrong tavern mark. Check the room code."})
        return
    name = str(data.get("name") or "").strip()[:32]
    character = str(data.get("character") or name).strip()[:40]
    if not name:
        emit("join_error", {"error": "The tavern needs a name."})
        return
    player = {
        "sid": request.sid,
        "name": name,
        "character": character,
        "cls": str(data.get("cls") or "").strip()[:24],
        "joined": now_iso(),
        "online": True,
    }
    with SAVE_LOCK:
        STATE["players"][name] = player
        save_state(STATE)
    emit("joined", {"ok": True, "you": player})
    msg = add_message(
        "join",
        name,
        f"{character} takes a seat at the table.",
        character=character,
    )
    socketio.emit("message", msg)
    socketio.emit("state", public_state())


@socketio.on("leave_notice")
def on_leave(data):
    data = data or {}
    name = str(data.get("name") or "").strip()
    with SAVE_LOCK:
        if name in STATE["players"]:
            STATE["players"][name]["online"] = False
            save_state(STATE)
    socketio.emit("state", public_state())


@socketio.on("chat")
def on_chat(data):
    data = data or {}
    name = str(data.get("name") or "Unknown").strip()[:32]
    character = str(data.get("character") or name).strip()[:40]
    raw = str(data.get("text") or "").strip()
    kind = str(data.get("kind") or "action").strip()
    if not raw:
        return
    if raw.lower().startswith("/ooc"):
        kind = "ooc"
        raw = raw[4:].strip() or raw
    elif raw.lower().startswith("/meta"):
        kind = "ooc"
    elif raw.lower().startswith("/roll") or DICE_RE.search(raw):
        rolled = roll_dice(raw)
        if rolled:
            msg = add_message("roll", name, f"{raw}\n{rolled}", character)
            socketio.emit("message", msg)
            if kind == "action" or raw.lower().startswith("/roll"):
                socketio.start_background_task(
                    dm_reply, f"{character} rolled: {raw} → {rolled}"
                )
            return
    msg = add_message(kind, name, raw, character)
    socketio.emit("message", msg)
    if kind == "ooc":
        return

    low = raw.lower()
    if low.startswith("/chronicle") or low.startswith("/book"):
        focus = raw.split(" ", 1)[1].strip() if " " in raw else "last session"
        socketio.start_background_task(
            dm_reply, focus, True, focus[:80]
        )
        return
    auto = kind in {"action", "say"} or low.startswith(("/look", "/recap", "/help"))
    if auto:
        socketio.start_background_task(dm_reply, f"{character} ({kind}): {raw}")


@socketio.on("summon_dm")
def on_summon(data):
    data = data or {}
    who = str(data.get("character") or data.get("name") or "The table")
    socketio.start_background_task(dm_reply, f"{who} asks the DM to continue the scene.")


@socketio.on("write_chapter")
def on_write_chapter(data):
    data = data or {}
    focus = str(data.get("focus") or "last session").strip()[:80]
    socketio.start_background_task(dm_reply, focus, True, focus)


@socketio.on("update_campaign")
def on_update_campaign(data):
    data = data or {}
    with SAVE_LOCK:
        camp = STATE["campaign"]
        for key in ("location", "time", "weather", "recap", "title"):
            if key in data and str(data[key]).strip():
                camp[key] = str(data[key]).strip()[:400]
        save_state(STATE)
    socketio.emit("state", public_state())


@socketio.on("works_gather")
def on_works_gather(data):
    data = data or {}
    site_id = str(data.get("site") or "")
    who = str(data.get("character") or data.get("name") or "Someone").strip()[:40]
    site = WORKS_SITES.get(site_id)
    if not site:
        emit("works_toast", {"ok": False, "text": "That site is not on the map."})
        return
    with SAVE_LOCK:
        w = ensure_works()
        if w["stamina"] <= 0:
            emit("works_toast", {"ok": False, "text": "Hands are done for the day. Come back tomorrow."})
            return
        w["stamina"] -= 1
        amt = random.randint(site["lo"], site["hi"])
        mat = site["give"]
        w["materials"][mat] = w["materials"].get(mat, 0) + amt
        extra = ""
        roll = random.randint(1, 100)
        if roll <= 6:
            w["materials"]["relic"] = w["materials"].get("relic", 0) + 1
            extra = " Relic spark!"
        line = f"{who} pulled +{amt} {mat} at the {site['name']}.{extra}"
        w["log"].append(line)
        w["log"] = w["log"][-30:]
        save_state(STATE)
    socketio.emit("works_toast", {"ok": True, "text": line})
    socketio.emit("state", public_state())


@socketio.on("works_build")
def on_works_build(data):
    data = data or {}
    build_id = str(data.get("id") or "")
    who = str(data.get("character") or data.get("name") or "Someone").strip()[:40]
    spec = WORKS_BUILDS.get(build_id)
    if not spec:
        emit("works_toast", {"ok": False, "text": "No such plan."})
        return
    with SAVE_LOCK:
        w = ensure_works()
        if build_id in w["built"]:
            emit("works_toast", {"ok": False, "text": f"The {spec['name']} already stands."})
            return
        for mat, need in spec["need"].items():
            if w["materials"].get(mat, 0) < need:
                emit("works_toast", {"ok": False, "text": f"Not enough {mat} for the {spec['name']}."})
                return
        for mat, need in spec["need"].items():
            w["materials"][mat] -= need
        w["built"].append(build_id)
        line = f"{who} raised the {spec['name']}."
        w["log"].append(line)
        w["log"] = w["log"][-30:]
        save_state(STATE)
    socketio.emit("works_toast", {"ok": True, "text": line})
    socketio.emit("state", public_state())


if __name__ == "__main__":
    print(f"Fallenlore Tavern at http://127.0.0.1:{PORT}")
    print("Share that address on your Wi-Fi, or tunnel it for distant friends.")
    if not XAI_API_KEY:
        print("No XAI_API_KEY yet — chat and dice work, DM replies will prompt for a key.")
    socketio.run(app, host=HOST, port=PORT, allow_unsafe_werkzeug=True)
