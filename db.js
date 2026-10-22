// db.js — PostgreSQL database layer for GoldComfort, using `pg`.
//
// ⚠️ NOT YET TESTED against a real PostgreSQL server (no network access in
// this development sandbox to install `pg` or run a real Postgres instance).
// Written carefully and reviewed, but real testing against an actual
// database is still required before this is trusted with real data.
//
// HOW QUERIES WORK:
//  - Every query string in server.js uses `?` placeholders for values.
//    prepare() below converts each `?` to Postgres's numbered `$1, $2, ...`
//    style automatically, so server.js's query strings never need `$1`-style
//    placeholders written by hand.
//  - Getting a newly-inserted row's id back requires the SQL itself to say
//    `RETURNING id` — server.js's INSERT statements that need the new row's
//    id already include this.
//  - Table identifiers that need quoting (like the `settings` table's `key`
//    column, a reserved word) use double quotes: "key".
//
// REQUIRES: npm install pg
// REQUIRES: a running PostgreSQL server, and these env vars in .env:
//   PG_HOST, PG_PORT (default 5432), PG_USER, PG_PASSWORD, PG_DATABASE

const { Pool } = require('pg');

// Render's managed PostgreSQL (and most cloud Postgres providers) require an
// SSL connection — without this, connecting from a Render Web Service to a
// Render PostgreSQL database fails outright. `rejectUnauthorized: false` is
// what Render's own docs recommend, since their internal certificate chain
// isn't set up for full verification from a client app.
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: 10,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: process.env.PG_PORT || 5432,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        database: process.env.PG_DATABASE,
        max: 10,
        ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false }
      }
);

// Converts '?' placeholders (used throughout server.js's query strings)
// into Postgres's numbered '$1, $2, ...' style. A '?' inside a quoted SQL
// string literal would break this, but none of this app's queries embed a
// literal '?' character inside a string — all real values are passed as
// bound parameters, never inlined — so this simple scan is safe here.
function toPgPlaceholders(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function prepare(sql) {
  const pgSql = toPgPlaceholders(sql);
  return {
    async get(...params) {
      const result = await pool.query(pgSql, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await pool.query(pgSql, params);
      return result.rows;
    },
    async run(...params) {
      const result = await pool.query(pgSql, params);
      // Only meaningful when the SQL includes `RETURNING id` (server.js adds
      // this to every INSERT statement that needs the new row's id back).
      const lastInsertRowid = result.rows[0] ? result.rows[0].id : undefined;
      return { lastInsertRowid, changes: result.rowCount };
    }
  };
}

async function exec(sql) {
  // Schema setup — a plain multi-statement query works fine with pg's
  // simple query protocol, no special configuration needed for this.
  await pool.query(sql);
}

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_admin SMALLINT NOT NULL DEFAULT 0,
    banned SMALLINT NOT NULL DEFAULT 0,
    available_balance INTEGER NOT NULL DEFAULT 0,
    withdraw_bank_name TEXT,
    withdraw_bank_acct TEXT,
    withdraw_bank_acct_name TEXT,
    security_code_hash TEXT,
    security_code_salt TEXT,
    security_code_attempts INTEGER NOT NULL DEFAULT 0,
    security_code_locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS verified_identities (
    email TEXT PRIMARY KEY,
    fullname TEXT NOT NULL,
    phone TEXT NOT NULL,
    nin TEXT NOT NULL,
    selfie_photo TEXT,
    dob TEXT NOT NULL,
    verified_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS resellers (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL REFERENCES users(email),
    biz_name TEXT NOT NULL,
    biz_state TEXT NOT NULL,
    address TEXT,
    location_pinned SMALLINT NOT NULL DEFAULT 0,
    bank_name TEXT,
    bank_acct TEXT,
    bank_acct_name TEXT,
    plan TEXT NOT NULL DEFAULT 'Pro (₦6,000/mo)',
    plan_expires_at TEXT NOT NULL,
    interest_while_expired SMALLINT NOT NULL DEFAULT 0,
    banned SMALLINT NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'self',
    available_balance INTEGER NOT NULL DEFAULT 0,
    total_earning INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS listings (
    id SERIAL PRIMARY KEY,
    reseller_id INTEGER NOT NULL REFERENCES resellers(id),
    name TEXT NOT NULL,
    description TEXT,
    price_text TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'product',
    photos TEXT,
    viewers INTEGER NOT NULL DEFAULT 0,
    rating DECIMAL(3,2) NOT NULL DEFAULT 0,
    discount_code TEXT,
    discount_percent INTEGER,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id),
    reseller_id INTEGER NOT NULL REFERENCES resellers(id),
    buyer_email TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    subtotal INTEGER NOT NULL,
    fee INTEGER NOT NULL DEFAULT 0,
    discount_applied INTEGER NOT NULL DEFAULT 0,
    credit_used INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    commission INTEGER NOT NULL,
    reseller_payout INTEGER NOT NULL,
    cust_state TEXT,
    address TEXT NOT NULL,
    cust_phone TEXT,
    cust_whatsapp TEXT,
    cust_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decline_reason TEXT,
    expected_delivery_at TEXT,
    ordered_at TEXT NOT NULL DEFAULT (NOW()),
    delivered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id SERIAL PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    related_order_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS virtual_accounts (
    id SERIAL PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_name TEXT,
    bank_name TEXT NOT NULL,
    flw_reference TEXT,
    created_at TEXT NOT NULL DEFAULT (NOW()),
    UNIQUE(owner_type, owner_id)
  );

  CREATE TABLE IF NOT EXISTS saved_bank_accounts (
    id SERIAL PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    bank_acct TEXT NOT NULL,
    bank_acct_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS order_chat (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    from_role TEXT NOT NULL,
    text TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS buy_requests (
    id SERIAL PRIMARY KEY,
    reseller_id INTEGER NOT NULL REFERENCES resellers(id),
    item_name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (NOW()),
    closed SMALLINT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS buy_request_chat (
    id SERIAL PRIMARY KEY,
    buy_request_id INTEGER NOT NULL REFERENCES buy_requests(id),
    from_email TEXT NOT NULL,
    text TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    reporter_email TEXT NOT NULL,
    reported_email TEXT NOT NULL,
    reason TEXT NOT NULL,
    context TEXT,
    created_at TEXT NOT NULL DEFAULT (NOW()),
    resolved SMALLINT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    reseller_id INTEGER REFERENCES resellers(id),
    discount_percent INTEGER,
    audience TEXT NOT NULL DEFAULT 'all',
    target_email TEXT,
    expires_at TEXT,
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS banner_slides (
    id SERIAL PRIMARY KEY,
    image TEXT,
    text TEXT,
    link_url TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS customer_credits (
    id SERIAL PRIMARY KEY,
    customer_email TEXT NOT NULL,
    amount INTEGER NOT NULL,
    granted_by_reseller_id INTEGER REFERENCES resellers(id),
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (NOW()),
    expires_at TEXT,
    used SMALLINT NOT NULL DEFAULT 0,
    used_order_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    audience TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id INTEGER NOT NULL,
    user_email TEXT NOT NULL,
    PRIMARY KEY (notification_id, user_email)
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL REFERENCES users(email),
    from_role TEXT NOT NULL,
    text TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (NOW())
  );

  CREATE TABLE IF NOT EXISTS support_threads (
    user_email TEXT PRIMARY KEY,
    escalated SMALLINT NOT NULL DEFAULT 0,
    unread_for_admin SMALLINT NOT NULL DEFAULT 0,
    unread_for_user SMALLINT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    "key" TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS listing_ratings (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id),
    customer_email TEXT NOT NULL,
    stars INTEGER NOT NULL,
    at TEXT NOT NULL DEFAULT (NOW()),
    UNIQUE(listing_id, customer_email)
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified SMALLINT NOT NULL DEFAULT 0
  );
`;

async function initDb() {
  await exec(schema);
}

module.exports = { prepare, exec, initDb, pool };
