# GoldComfort — PostgreSQL test version

This is a **test deployment** of GoldComfort using PostgreSQL instead of
SQLite. It is separate from the live GoldComfort site — nothing here affects
real customers or real data.

## Render setup

**Build Command:**
```
npm install
```

**Start Command:**
```
node server.js
```

## Required Environment Variables

Before this will start successfully, add these under Render → your Web
Service → Environment:

| Key | Where to find it |
|---|---|
| `PG_HOST` | Render → your PostgreSQL database → Info tab → "Hostname" |
| `PG_PORT` | Usually `5432` |
| `PG_USER` | Render → your PostgreSQL database → Info tab → "Username" |
| `PG_PASSWORD` | Render → your PostgreSQL database → Info tab → "Password" |
| `PG_DATABASE` | Render → your PostgreSQL database → Info tab → "Database" |

**Important:** if your Web Service and PostgreSQL database are both on
Render, use the **Internal Database URL** connection details (faster, free
of data-transfer charges) — Render's database Info tab shows both an
"Internal" and "External" hostname; use the Internal one when the values
above are filled in as separate host/user/password/database fields.

Also add the same other variables the SQLite version needs (`ADMIN_EMAIL`,
`FLUTTERWAVE_PUBLIC_KEY`, etc.) — see `.env.example` from the main project.

## If the service won't go live

Check the **Logs** tab on Render. The most common cause at this stage is a
missing or incorrect `PG_*` environment variable, which makes the app hang
or crash while trying to connect to the database on startup. The exact error
message in the logs will say what's wrong.
