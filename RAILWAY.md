# Deploy Fallenlore Tavern on Railway

You cannot deploy from this chat into your Railway account. Do these steps once on a computer. After that, phones only open the link.

## 1. Account

1. Go to https://railway.app and sign up (GitHub login is easiest).
2. Pick the **Hobby** plan ($5/month). That keeps the tavern awake.

## 2. New project from these files

**Option A — GitHub (best)**  
1. Create a GitHub repo and upload everything in this folder (do **not** upload `.env`).  
2. Railway → **New Project** → **Deploy from GitHub repo** → pick that repo.

**Option B — Railway CLI**

```bash
npm i -g @railway/cli
cd fallenlore-tavern
railway login
railway init
railway up
```

## 3. Variables

Railway project → your service → **Variables**. Add:

| Name | Value |
|---|---|
| `XAI_API_KEY` | your key from https://console.x.ai/ |
| `GROK_MODEL` | `grok-4` (or `grok-4.6` if your console lists it) |
| `ROOM_CODE` | a private door mark friends must type |
| `SECRET_KEY` | any long random string |

Do not put the API key in GitHub.

## 4. Public URL

Service → **Settings** → **Networking** → **Generate domain**.  
You get something like `https://fallenlore-tavern-production.up.railway.app`.

## 5. Keep the campaign when Railway redeploys

Service canvas → right-click → **Volume**.

- Mount path: `/data`
- Size: 1 GB is plenty

The app writes `campaign.json` to that volume automatically.

## 6. Phones

Send friends the Railway https link plus the room code.  
iPhone: Safari → Share → **Add to Home Screen**.

If the first deploy fails, open **Deployments → View logs**. The usual miss is a missing `XAI_API_KEY` (chat still works) or no public domain yet.
