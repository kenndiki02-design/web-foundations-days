# SnapShare Scaling Plan

SnapShare is a photo-sharing app where users upload photos and scroll a feed of photos from people they follow.

## 1. Assumptions

- 10,000,000 registered users.
- 10% are active each day.
- Each active user uploads 1 photo per day.
- Each active user views 50 feed pages per day (one page = one request to the feed).
- An average photo is 2 MB, and each photo also gets a 50 KB thumbnail.
- There are 86,400 seconds in a day and 365 days in a year.
- Peak traffic is 5× the average.
- 1 MB = 1,000,000 bytes, 1 TB = 1,000,000 MB (decimal units, to keep the arithmetic simple).
- Photo storage is counted once. Real storage will be higher because of backups and replication, and the database is small by comparison, so it is ignored here.

**Daily active users (DAU):** 10,000,000 × 10% = **1,000,000 users per day**.

## 2. Estimates

### Uploads per second
- Uploads per day: 1,000,000 users × 1 photo = 1,000,000 photos.
- Average: 1,000,000 / 86,400 ≈ **12 uploads per second**.
- Peak (5×): ≈ **58 uploads per second**.

### Feed views per second
- Feed views per day: 1,000,000 users × 50 pages = 50,000,000 views.
- Average: 50,000,000 / 86,400 ≈ **579 feed views per second**.
- Peak (5×): ≈ **2,900 feed views per second**.

### Photo storage per year
- Originals: 1,000,000 × 2 MB = 2 TB per day, so 2 TB × 365 = **730 TB per year**.
- Thumbnails: 1,000,000 × 50 KB = 50 GB per day, so 50 GB × 365 ≈ **18 TB per year**.
- Total: ≈ **748 TB per year** (about 0.75 PB).

### Upload bandwidth (extra check)
- Average: 12 uploads/s × 2 MB ≈ 24 MB/s.
- Peak: 58 uploads/s × 2 MB ≈ 116 MB/s.

## 3. Read-heavy or write-heavy?

SnapShare is **read-heavy**. There are 50 feed views for every 1 upload, a ratio of about 50 : 1, and each feed page shows several photos, so the real ratio of photo reads to photo writes is even higher.

What this means for the design:
- Optimise for reads first: serve photos from a CDN, keep hot data in a cache, and send read queries to a database read replica.
- Writes are rare enough that a single primary database can handle them (58 uploads per second at peak), so the write path can stay simple.
- The slow part of a write (making thumbnails) should be moved out of the request so uploads feel fast.

## 4. Why photos must not be stored in the database

- **Size:** at 748 TB per year, photos would make the database enormous. That makes backups, restores and replication slow and expensive.
- **Cost:** database storage and database servers are far more expensive per terabyte than object storage.
- **Speed:** serving large files through the database ties up connections and memory that queries need, and slows down everything else.
- **Fit:** a database is built for small structured rows and queries, not for large binary files that are never searched or edited.

Instead, photo files go into **object storage** (such as Amazon S3). The database stores only **metadata**: the photo id, owner, caption, upload time, the object storage key for the original and the thumbnail, and the thumbnail status.

## 5. Architecture diagram

```
                        +-------+
                        | Users |
                        +---+---+
          API requests      |      image requests
        +-------------------+-------------------+
        v                                       v
+---------------+                          +---------+
| Load Balancer |                          |   CDN   |
+-------+-------+                          +----+----+
        |                                       |
        v                                       |
+--------------------------------------+        |
|        App Servers (1 .. N)          |        |
+---+-----------+----------+--------+--+        |
    |           |          |        |           |
    v           v          v        v           v
+-------+  +----------+  +-------+  +------------------+
| Cache |  | Database |  | Queue |  |  Object Storage  |
|(Redis)|  | (primary)|  +---+---+  | originals and    |
+-------+  +----+-----+      |      | thumbnails       |
                |            v      +------------------+
                v        +--------+          ^
        +--------------+ | Worker |----------+
        | Read Replica | +--------+
        +--------------+
```

Arrows not drawn, to keep the diagram readable:
- The cache falls back to the **read replica** when a feed is not cached.
- The **worker** also updates the photo's row in the **database** once the thumbnail is ready.

Summary of the main paths:
- **Viewing photos:** User -> CDN -> (on a miss) Object Storage.
- **Loading the feed:** User -> Load Balancer -> App Server -> Cache -> (on a miss) Read Replica.
- **Uploading a photo:** User -> Load Balancer -> App Server -> Object Storage + Database (primary) + Queue -> Worker -> Object Storage + Database.

## 6. Components and the problem each solves

- **CDN:** delivers photos and thumbnails from servers close to the user, which solves slow image loading for distant users and takes most of the image traffic off our own servers.
- **Load balancer:** spreads incoming requests across many app servers, which solves the problem of one server being overloaded and of a single server failure taking the app down.
- **App servers:** run the business logic (login, upload, feed), and because they are stateless we can add more of them to handle growth.
- **Cache (Redis):** keeps recently built feeds and popular data in memory, which solves repeated, slow database queries for the same data and absorbs the peak of about 2,900 feed views per second.
- **Database (primary):** stores users, follows and photo metadata reliably, and is the single place where all writes go so the data stays consistent.
- **Read replica:** holds a copy of the primary database that serves read queries, which solves the problem of heavy feed reads slowing down the primary that handles writes.
- **Object storage:** stores the large photo files cheaply and durably at the scale of hundreds of terabytes, which a database cannot do economically.
- **Queue:** holds thumbnail jobs until a worker is ready, which solves the problem of making users wait for slow image processing and protects the system from upload spikes.
- **Worker:** picks jobs off the queue and creates the 50 KB thumbnail in the background, so that thumbnails are made without slowing the upload request and more workers can be added when the queue grows.

## 7. Upload flow (step by step)

1. The user picks a photo in the app and taps upload. The app sends the photo to SnapShare over HTTPS.
2. The request reaches the **load balancer**, which forwards it to a healthy **app server**.
3. The app server checks that the user is logged in and validates the file (it is an image, and the size is within the limit, for example 10 MB).
4. The app server saves the original photo to **object storage** and receives back a storage key.
5. The app server inserts a row in the **primary database** with the photo id, owner, caption, upload time, the original's storage key and the status `thumbnail_pending`.
6. The app server puts a "create thumbnail" job (photo id and storage key) on the **queue**.
7. The app server replies to the user with success (for example `201 Created`). The user does not wait for the thumbnail.
8. A **worker** takes the job from the queue, downloads the original from object storage and creates a 50 KB thumbnail.
9. The worker saves the thumbnail to object storage, then updates the database row with the thumbnail key and the status `ready`.
10. The worker removes or refreshes any affected cache entries, so followers' feeds show the new photo. The CDN then serves the thumbnail and photo to viewers, fetching them from object storage the first time they are requested.
11. If the worker fails, the job returns to the queue and is retried. After several failures it moves to a dead-letter queue for investigation, and the photo stays marked `thumbnail_pending`.

## 8. Trade-offs

- **Eventual consistency (read replica and cache vs. fresh data):** the replica copies data from the primary with a small delay, and cached feeds can be a few seconds or minutes old. We gain speed and the ability to handle about 2,900 reads per second, but a user may briefly not see a new photo or a new like right after it happens. We could reduce the problem by reading the user's own recent uploads from the primary.
- **Asynchronous thumbnails (fast upload vs. delay):** using a queue and worker makes the upload respond quickly and lets the system absorb spikes, but the thumbnail is not available immediately. The app must show a placeholder or the original until the job finishes, and we have extra moving parts (queue, workers, retries) to run and monitor.
- **CDN (speed and offloading vs. cost and staleness):** a CDN makes images load much faster and cuts the load on object storage, but it costs money per gigabyte served, and a deleted or replaced photo may stay visible until the cache entry expires or is purged.
- **Object storage (cheap and scalable vs. simple):** keeping photos outside the database makes storage cheap and scalable, but it adds a second system to keep in sync. A photo can exist in storage without a database row, or the reverse, if a step fails halfway, so we need cleanup jobs and careful ordering of steps (save the file first, then the database row).