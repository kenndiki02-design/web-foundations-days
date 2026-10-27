# TicketHub Design Document

TicketHub is a website that sells tickets for concerts and events. This document follows the six-part framework: **requirements, estimates, API, data model, architecture and trade-offs**. A seventh section explains in detail how the design prevents two people from buying the same seat.

**Summary of the key decisions**
- A relational SQL database is the single source of truth for seats, so a seat can never be sold twice (section 4 and section 7).
- A seat is reserved with one atomic database update, and the database refuses a second ticket for the same seat.
- A waiting room, a CDN and a cache protect the system when 200,000 people arrive at once (section 5).

---

## 1. Requirements

### Functional requirements
- Users can register, sign in and sign out.
- Users can browse and search events (name, date, venue).
- Users can view an event's seat map, showing which seats are available and their prices.
- Users can **hold** one or more seats for a short time (5 minutes) while they pay.
- Users can pay for held seats and receive tickets by email and on the site.
- Users can see their past orders and tickets ("My tickets").
- Held seats that are not paid for are released automatically.
- A user can buy at most 4 tickets per event.

### Non-functional requirements
- **Correctness (the most important):** a seat is never sold to two people, and a customer is never charged for a seat they do not receive.
- **Speed:** browsing pages load in under 1 second for 95% of requests. Holding a seat answers in under 500 ms.
- **Availability:** 99.9% uptime overall. Browsing must keep working even when the purchase flow is under heavy load.
- **Scalability:** handles normal days and a "big sale" spike of about 600 times normal traffic.
- **Fairness:** no one gets an advantage by being a few milliseconds faster or by using bots. Everyone who arrives during the opening window has a fair chance, and each person is limited to 4 tickets.
- **Durability:** a paid order is never lost. The database is backed up and can be restored to any point in time.
- **Security:** HTTPS everywhere, hashed passwords, and card details handled only by the payment provider (TicketHub never stores card numbers).

---

## 2. Estimates

### Assumptions
- 2,000,000 registered users.
- Normal day: 50,000 visitors, each viewing 10 pages, and 5,000 tickets sold.
- Average 2 tickets per order, so about 2,500 orders a day.
- Half of all seat holds are abandoned or expire, so holds are about 2 times the tickets sold.
- Peak on a normal day is 5 times the average.
- 86,400 seconds in a day.
- Big sale: 200,000 people try to buy 20,000 seats within 10 minutes (600 seconds). Assume half of them arrive in the first minute, each person makes about 10 requests during the sale (page loads, seat map refreshes, hold attempts), and each person tries about 3 seats because many are already taken.

### Normal traffic

| Measure | Calculation | Average | Peak (5×) |
|---------|-------------|---------|-----------|
| Page views | 50,000 × 10 = 500,000 per day | ≈ 6 per second | ≈ 29 per second |
| Tickets sold | 5,000 per day | ≈ 0.06 per second (one every 17 seconds) | ≈ 0.3 per second |
| Seat holds | 5,000 × 2 = 10,000 per day | ≈ 0.12 per second | ≈ 0.6 per second |

- Browsing is about **100 times** more frequent than buying (500,000 page views for 5,000 tickets), so the system is **read-heavy**.
- Storage is small: about 1.8 million tickets a year at about 1 KB each is under 2 GB, and seat rows (for example 100 new events a month with 10,000 seats at 200 bytes each) add about 2.4 GB a year. The total is about **4 GB per year**.

### Big sale (a very popular concert)

| Measure | Calculation | Average over 10 minutes | First minute (spike) |
|---------|-------------|-------------------------|----------------------|
| Requests | 200,000 × 10 = 2,000,000 | ≈ 3,300 per second | 100,000 people × 10 = 1,000,000 in 60 s ≈ **17,000 per second** |
| Hold attempts | 200,000 × 3 = 600,000 | ≈ 1,000 per second | 300,000 in 60 s ≈ **5,000 per second** |
| Seats sold | 20,000 | ≈ 33 per second | ≈ 110 per second if it sells out in about 3 minutes |

- Demand is **10 people for every seat**, so at least 90% of people will not get a ticket. The system must make that experience clear and fair.

### Comparison

| | Normal day | Big sale | Difference |
|---|-----------|----------|-----------|
| Visitors | 50,000 per day | 200,000 in 10 minutes | 4 times a whole day's visitors, in 10 minutes |
| Requests per second | ≈ 6 average (≈ 29 peak) | ≈ 3,300 average, ≈ 17,000 in the first minute | about **580×** to **2,900×** the normal average |
| Tickets sold per second | ≈ 0.06 | ≈ 33 | about **580×** |

**What this means:** the sale is a short spike of 10 to 15 minutes that is hundreds of times bigger than normal traffic. It would be wasteful to run enough servers for it all year, and a normal website would fall over. The design therefore has to **flatten the spike** (CDN, cache and waiting room) and **scale up just before the sale**. Most importantly, the seat-reservation logic must stay **correct** even when thousands of people click the same seat at the same moment.

---

## 3. API design

Base URL: `https://api.tickethub.example/v1`. JSON bodies. All endpoints except the first three and `GET /events` need the header `Authorization: Bearer <token>`.

| # | Method | Path | Description | Success status |
|---|--------|------|-------------|----------------|
| 1 | `POST` | `/auth/login` | Sign in and get an access token. | `200 OK` |
| 2 | `GET` | `/events` | Browse and search events (`q`, `page`, `limit`). | `200 OK` |
| 3 | `GET` | `/events/{id}` | Get one event's details. | `200 OK` |
| 4 | `GET` | `/events/{id}/seats` | View the seat map with each seat's status and price (`section` optional). | `200 OK` |
| 5 | `POST` | `/events/{id}/queue` | Join the waiting room for a popular event's sale. | `202 Accepted` |
| 6 | `GET` | `/events/{id}/queue` | Check your place in the waiting room and get your entry pass when it is your turn. | `200 OK` |
| 7 | `POST` | `/events/{id}/holds` | Hold one or more seats for 5 minutes. | `201 Created` |
| 8 | `DELETE` | `/events/{id}/holds` | Release your held seats. | `204 No Content` |
| 9 | `POST` | `/orders` | Pay for your held seats and receive tickets. Needs an `Idempotency-Key` header. | `201 Created` |
| 10 | `GET` | `/orders/{id}` | View one order. | `200 OK` |
| 11 | `GET` | `/me/tickets` | View all your tickets. | `200 OK` |

### Example: hold seats

```http
POST /v1/events/55/holds
Authorization: Bearer eyJhbGciOi...
```

```json
{ "seat_ids": [1201, 1202] }
```

Response `201 Created`:

```json
{
  "event_id": 55,
  "seat_ids": [1201, 1202],
  "total_cents": 18000,
  "expires_at": "2026-12-05T18:05:00Z"
}
```

If any requested seat is not free, **none** are held and the response is `409 Conflict`:

```json
{
  "error": {
    "code": "SEAT_UNAVAILABLE",
    "message": "Seat 1202 was just taken. Please choose another seat.",
    "details": [{ "seat_id": 1202 }]
  }
}
```

### Example: pay for held seats

```http
POST /v1/orders
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: 7c1b6d0e-4f55-4b8e-9d1a-0a8f3f5e2c11
```

```json
{ "event_id": 55, "payment_token": "tok_visa_123" }
```

Response `201 Created`:

```json
{
  "id": 9001,
  "event_id": 55,
  "status": "paid",
  "total_cents": 18000,
  "tickets": [
    { "id": 30001, "seat_id": 1201, "code": "TH-8F3K-29QX" },
    { "id": 30002, "seat_id": 1202, "code": "TH-1M7A-55ZD" }
  ]
}
```

### Error codes

| Status | When it happens |
|--------|-----------------|
| `400 Bad Request` | Invalid data, for example no seats in the request or more than 4 tickets. |
| `401 Unauthorized` | Missing or expired token. |
| `402 Payment Required` | The card was declined. The held seats stay held until the hold expires, so the user can try another card. |
| `403 Forbidden` | The sale has not opened, the user has no waiting-room entry pass, or the order belongs to someone else. |
| `404 Not Found` | The event, order or seat does not exist. |
| `409 Conflict` | A seat is already held or sold, or the user's hold expired before payment. |
| `429 Too Many Requests` | Rate limit exceeded (protects against bots and refresh storms). The `Retry-After` header says when to try again. |
| `503 Service Unavailable` | The purchase flow is temporarily full. The client shows the waiting room. |

Because the `Idempotency-Key` is saved with the order, a double click or a retry after a network failure returns the **same order** instead of creating a second one.

---

## 4. Data model

Five tables: `users`, `events`, `seats`, `orders` and `tickets`. The SQL uses SQLite syntax (the dialect used in the course playground). In production on PostgreSQL the main changes would be `BIGINT GENERATED ALWAYS AS IDENTITY` for ids and `TIMESTAMPTZ` for times.

### Relationships

- **One-to-many: events to seats.** An event has thousands of seats, and each seat belongs to one event.
- **One-to-many: users to orders.** A user can place many orders, and each order belongs to one user.
- **One-to-many: orders to tickets.** An order contains one or more tickets, and each ticket belongs to one order.
- **One-to-one (at most): seats to tickets.** A seat has **at most one ticket**, enforced by `UNIQUE (seat_id)` on `tickets`. This rule is what stops a double sale.
- **Many-to-many: users and events.** A user can buy tickets for many events, and an event has many buyers. The `orders` table is the link between them.

### CREATE TABLE statements

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  venue       TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  on_sale_at  TEXT NOT NULL,
  total_seats INTEGER NOT NULL CHECK (total_seats > 0)
);

CREATE TABLE seats (
  id                INTEGER PRIMARY KEY,
  event_id          INTEGER NOT NULL REFERENCES events (id),
  section           TEXT NOT NULL,
  row_label         TEXT NOT NULL,
  seat_number       INTEGER NOT NULL,
  price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
  status            TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'held', 'sold')),
  held_by_user_id   INTEGER REFERENCES users (id),
  hold_expires_at   TEXT,
  UNIQUE (event_id, section, row_label, seat_number),
  -- A seat has a holder and an expiry time if and only if it is held.
  CHECK ((status = 'held' AND held_by_user_id IS NOT NULL AND hold_expires_at IS NOT NULL)
      OR (status <> 'held' AND held_by_user_id IS NULL AND hold_expires_at IS NULL))
);

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users (id),
  event_id        INTEGER NOT NULL REFERENCES events (id),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payment_ref     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tickets (
  id       INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id),
  seat_id  INTEGER NOT NULL UNIQUE REFERENCES seats (id),  -- one ticket per seat, ever
  code     TEXT NOT NULL UNIQUE                            -- the code shown as a QR code
);
```

### Indexes

```sql
-- Seat map and "how many seats are left" for one event.
CREATE INDEX idx_seats_event_status ON seats (event_id, status);

-- Lets the clean-up job find expired holds without scanning every seat.
CREATE INDEX idx_seats_expired_holds ON seats (hold_expires_at) WHERE status = 'held';

-- "My orders", newest first.
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
```

---

## 5. Architecture

### Diagram

```
                         +--------+
                         | Client |
                         +---+----+
                             |
                             v
                         +-------+
                         |  DNS  |
                         +---+---+
        static files and     |        API requests
        cached event pages   |
        +--------------------+--------------------+
        v                                         v
   +---------+                          +-------------------+
   |   CDN   |                          | Load Balancer     |
   +---------+                          | (+ rate limiting) |
                                        +---------+---------+
                                                  |
                                                  v
                                        +-------------------+
                                        |   Waiting Room    |
                                        |  (admits ~300     |
                                        |   users/second)   |
                                        +---------+---------+
                                          +-------+-------+
                                          v               v
                                   +------------+  +------------+
                                   | App Server |  | App Server |   (auto-scaled, 2..N)
                                   |     1      |  |     N      |
                                   +-----+------+  +------+-----+
                                         |                |
              +--------------------------+----------------+------------------+
              v                          v                                   v
        +-----------+        +--------------------+                    +-----------+
        |   Cache   |        |   Primary DB       |                    |   Queue   |
        |  (Redis)  |        |   (all seat and    |                    +-----+-----+
        +-----------+        |   order writes)    |                          |
                             +---------+----------+                          v
                                       | replication                  +-------------+
                                       v                              |   Workers   |
                             +--------------------+                   | (emails,    |
                             |   Read Replica     |                   |  tickets,   |
                             |   (browsing reads) |                   |  hold sweep)|
                             +--------------------+                   +-------------+

          App servers  <---->  Payment Provider (external: authorize and capture payments)
```

Arrows not drawn, to keep the diagram readable:
- App servers read the event list and seat map from the **cache** first and from the **read replica** on a miss. Anything that changes a seat goes to the **primary DB**.
- **Workers** read from the queue and write results (for example "email sent") to the primary DB.

### Components and the problem each solves

- **Client:** the web page or app where people browse, pick seats and pay.
- **DNS:** turns `tickethub.example` and `api.tickethub.example` into server addresses so users do not need to know where servers are.
- **CDN:** serves images, scripts and the (cached) event pages from servers near the user, which keeps most of the 17,000 requests per second off our own servers.
- **Load balancer with rate limiting:** shares requests between app servers, stops sending traffic to broken ones, and blocks clients that send too many requests (bots and refresh storms).
- **Waiting room:** lets people into the purchase flow at a rate the system can handle (about 300 users per second) and puts everyone else in an orderly queue, so a spike of 200,000 people becomes a steady stream.
- **App servers:** run the API logic and are stateless, so we can add more before a big sale and remove them afterwards.
- **Cache (Redis):** stores the event pages and seat maps for 1 to 2 seconds, and also holds waiting-room entry passes and rate-limit counters, which spares the database from thousands of identical reads.
- **Primary database:** the single source of truth for seats and orders, where transactions and constraints guarantee that a seat is never sold twice.
- **Read replica:** a live copy that answers browsing queries and takes read load away from the primary, and it can be promoted if the primary fails.
- **Queue:** holds slow, non-urgent jobs (emails, ticket PDFs, clean-up) so the user's request never waits for them.
- **Workers:** process the queued jobs, including the sweep that releases expired holds, and retry them if they fail.
- **Payment provider (external):** takes the card payment, so TicketHub never stores card numbers.

### How the design survives the big sale

1. **Prepare in advance.** The sale time is known, so we scale up app servers, cache and database connections 30 minutes before it opens and run load tests beforehand.
2. **Absorb browsing at the edge.** The event page and static files come from the CDN. The seat map is cached for 1 to 2 seconds, so 17,000 requests per second become a few database reads per second.
3. **Waiting room.** People are admitted at about 300 per second. With roughly 3 seat-hold attempts each, that is about 900 hold attempts per second at the database, instead of the 5,000 per second spike. This is a number a well-sized primary database can handle for simple indexed updates, but it should be confirmed with a load test before the sale.
4. **Fair order.** Everyone who arrives in the first few minutes is given a random place in the queue, so being a few milliseconds faster does not help, and bots gain nothing from speed. Each account can hold at most 4 seats and is rate-limited.
5. **Protect the database.** All seat changes go through short transactions on indexed rows, hold connections briefly, and use a limited pool of connections.
6. **Keep slow work out of the request.** Emails and ticket PDFs go through the queue.
7. **Degrade gracefully.** If the purchase flow is full, users get `503` and the waiting-room page, while browsing other events keeps working.
8. **Sold-out is a normal outcome.** Once the last seat is sold, the cache and event page show "Sold out" and the waiting room stops admitting people, so the other 180,000 people get a clear answer instead of errors.

---

## 6. Trade-offs

- **Seat holds (fair checkout vs. locked-up seats).** Holding seats for 5 minutes stops two people paying for the same seat and gives people time to pay. The cost is that people who never pay lock up seats for a while. A shorter hold (for example 3 minutes) frees seats sooner but rushes people, so we chose 5 minutes, extended by 2 minutes once payment has started.
- **Waiting room (stability and fairness vs. user experience).** The waiting room protects the database and gives everyone a fair chance, but it adds waiting, extra complexity and some frustration. Without it, the site would likely crash for everyone. We accept the wait because a crashed sale is much worse.
- **Cached seat map (speed vs. freshness).** A cache makes the seat map fast, but it can be 1 to 2 seconds out of date, so a user may click a seat that has just been taken. This is safe, because the database decides who gets the seat, and the user just sees "Seat just taken, please choose another". A cache with no delay would defeat the purpose.
- **One primary database (correctness vs. write scaling).** Sending all seat changes to one primary database keeps things simple and correct, but it limits write capacity and puts all the load of a popular event on one machine. The waiting room keeps that load within what it can handle. If we ever needed far more, we could split events across several databases (sharding by event), at the cost of much more complexity.
- **Authorize first, capture after (safety vs. extra steps).** We authorize the payment, then confirm the seats, then capture the money. This means a customer is never charged for a seat they did not get, at the cost of an extra step and of cancelling the authorization when the confirmation fails.

---

## 7. How the design prevents two people buying the same seat

The danger is a **race condition**: two people click the same seat at the same moment and the system thinks it is free for both. We prevent it with several layers, so that no single bug can cause a double sale.

### Layer 1: reserve the seat with one atomic update (not check, then update)

A wrong approach is to run `SELECT` to see whether the seat is free and then `UPDATE` to take it. Two requests can both see "available" before either one updates, and both succeed.

Instead, the "is it free?" test and the claim happen in **one SQL statement**:

```sql
-- Hold one seat. :seat_id, :event_id and :user_id are supplied by the app.
UPDATE seats
SET status = 'held',
    held_by_user_id = :user_id,
    hold_expires_at = datetime('now', '+5 minutes')
WHERE id = :seat_id
  AND event_id = :event_id
  AND (status = 'available'
       OR (status = 'held' AND hold_expires_at < datetime('now')));
```

The database locks the row while it updates it, so concurrent requests for the same seat are handled **one after the other**. The first one changes the status to `held`. When the second one runs, the `WHERE` condition no longer matches, so **0 rows are changed**. The app checks the number of rows changed:
- `1` row changed: this user got the seat.
- `0` rows changed: someone else has it, so the API replies `409 Conflict`.

The condition also treats an **expired** hold as free, so correctness does not depend on the clean-up job running on time.

### Layer 2: all-or-nothing for several seats

When a user holds two seats, the app runs the update for each seat inside **one transaction**. If any update changes 0 rows, the app runs `ROLLBACK`, and the seats that were just held are released as if nothing happened. The user never ends up with half of what they asked for.

### Layer 3: confirm the purchase in a transaction

After the payment is authorized, one transaction turns the held seats into sold seats, but only if they are **still held by this user and not expired**:

```sql
BEGIN;

-- For each seat in the order. The app checks that exactly 1 row was changed each time.
UPDATE seats
SET status = 'sold', held_by_user_id = NULL, hold_expires_at = NULL
WHERE id = :seat_id
  AND status = 'held'
  AND held_by_user_id = :user_id
  AND hold_expires_at >= datetime('now');

INSERT INTO tickets (order_id, seat_id, code)
VALUES (:order_id, :seat_id, :code);

-- After every seat has been confirmed:
UPDATE orders SET status = 'paid' WHERE id = :order_id;

COMMIT;
```

If any seat update changes 0 rows (for example the hold expired and someone else took the seat), the app runs `ROLLBACK`, cancels the payment authorization so the customer is not charged, marks the order `failed` and replies `409 Conflict`.

### Layer 4: a database constraint as the final safety net

`tickets.seat_id` is declared `UNIQUE`. Even if there were a bug in the application code, the database would **refuse** to create a second ticket for the same seat, and the whole transaction would fail and roll back. The `seats` table also has a `CHECK` rule that a held seat must have a holder and an expiry time, so the data cannot get into an inconsistent state.

### Layer 5: repeated requests do not create repeated orders

Every payment request carries an `Idempotency-Key`, saved in `orders.idempotency_key` with a `UNIQUE` constraint. If the user double-clicks "Pay" or the app retries after a network error, the second request finds the existing order and returns it, so nobody is charged twice or issued tickets twice.

### What about the cache and the waiting room?

- The **cached seat map** is only a guide and may be a second out of date. It is never used to decide who gets a seat. Only the database update in Layer 1 decides.
- The **waiting room** controls how many people reach the database, not which seat they get. It improves speed and fairness, but correctness comes from the layers above.
- If an app server crashes in the middle of a purchase, the transaction is rolled back automatically and any unpaid hold simply expires after 5 minutes, so no seat stays locked forever.

### Summary

| Risk | Protection |
|------|------------|
| Two people click the same seat at the same moment | One atomic conditional `UPDATE`, where the database serializes updates to the same row. |
| Someone gets only some of their seats | A transaction with `ROLLBACK` on any failure. |
| A hold expires while the user is paying | The confirm step re-checks the hold, and the payment authorization is cancelled if it fails. |
| A bug in the app tries to sell a seat twice | `UNIQUE (seat_id)` on `tickets`. |
| Double click or retry | `UNIQUE` idempotency key on `orders`. |
| Stale cache shows a taken seat | The cache is never trusted for decisions. |