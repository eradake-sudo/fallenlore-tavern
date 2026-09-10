# Fallenlore Tavern

A private chat-room table for your group. Grok sits as Dungeon Master. Friends drop in through the day, post actions when they can, and the world keeps moving.

Built for the **Asmodeus: Demonic Threat in Fallenlore** campaign. Edit `campaign/WORLD.md` to drop in your real lore, maps notes, and character truths.

## What it does

- Shared tavern chat (Act / Speak / OOC)
- Persistent campaign log saved to `data/campaign.json`
- Real dice (`/roll 1d20+5` or the d20 button)
- Grok replies as DM after actions, rolls, `/look`, `/recap`, or the **Summon the DM** button
- Party list and a living board (location, time, weather, recap)
- Mobile-friendly so people can play from a phone between work and dinner

## Requirements

- Python 3.10+
- An [xAI API key](https://console.x.ai/) so Grok can speak
- One always-on machine if you want the table open all day (a home PC, Pi, or a $5 VPS)

Chat and dice work without a key. DM narration needs the key.

## Setup

```bash
cd fallenlore-tavern
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

```
XAI_API_KEY=xai-your-key-here
GROK_MODEL=grok-4
ROOM_CODE=your-private-mark
```

Paste campaign notes into `campaign/WORLD.md`.

Start the tavern:

```bash
python app.py
```

Open http://127.0.0.1:5000 on the host machine.

## Railway (always-on)

Full click-path: **[RAILWAY.md](RAILWAY.md)**

Railway Hobby ($5/mo) → deploy this folder → set `XAI_API_KEY` and `ROOM_CODE` → Generate domain → attach a volume at `/data`. Friends open the https link on their phones. This chat cannot log into your Railway account for you.

## Phones

Everyone **plays** on a phone. Only **one** person (or a cheap always-on box) **runs** the server.

iPhone and Android cannot each host a shared Python tavern reliably. Four copies of `app.py` are four separate campaigns.

On iPhone (Safari): open the host’s link → Share → **Add to Home Screen**. It opens like an app.

On Android Chrome: menu → **Add to Home screen**.

Phones are seats. The host machine is the tavern.

## Playing with friends through the day

**Same house / same Wi-Fi**  
Friends open `http://YOUR-LAN-IP:5000` on phone or laptop. Find the LAN IP with `ipconfig` (Windows) or `ip addr` / Settings → Wi-Fi (Mac/Linux/phone).

**Friends not on your network**  
Leave the tavern running and expose it with a tunnel:

```bash
# Cloudflare (free)
cloudflared tunnel --url http://127.0.0.1:5000

# or ngrok
ngrok http 5000
```

Send them the https link plus the room code. Anyone with the link can sit at the table, so keep `ROOM_CODE` set.

**All-day play**  
Do not close the terminal. The JSON save file is the campaign memory. When someone acts hours later, the DM reads the recent log plus `WORLD.md`.

## Table habits that work asynchronously

- Act in first person as your character.
- Roll when the DM or the uncertainty asks: `/roll 1d20+4`
- `/look` if you just sat down and need the room.
- `/recap` after a gap.
- `/ooc` for real-world talk.
- Hit **Summon the DM** if the last human message was chatter and the scene should move.

## Honest limits

This is a self-hosted tavern, not a hosted MMO.

- I cannot keep a public server running for you from this chat. You (or a $5 host) keep `app.py` alive.
- Grok API usage is billed to the key in `.env`. A talky day is usually cents to a couple of dollars depending on model and length.
- The DM is only as faithful as the bible you keep in `WORLD.md` and the recap on the board. After big sessions, paste a recap into that file.
- True simultaneous combat with a grid still wants Foundry / Roll20. This is the "play by post, but the DM never sleeps" table.

## If you want to play *right now* without hosting

Stay in this Grok conversation. I will DM Fallenlore here. You relay your friends' actions, or they sit beside you. The tavern app is for when the group wants a shared room that lives outside one phone.
