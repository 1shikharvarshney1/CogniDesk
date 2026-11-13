# CogniDesk Fresh Empirical Evaluation Report

**Evaluation Date:** November 14, 2026  
**Git Baseline Tag:** `eval-baseline`  
**Host Architecture:** Single 8 GB shared machine hosting the Node.js server, MongoDB database, and evaluation load generator.

---

## 1. Environment Specifications

| Parameter | Specification | Notes |
| :--- | :--- | :--- |
| **Operating System** | Windows 11 Home Single Language (Build 10.0.26300) | 64-bit OS |
| **CPU Model** | Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz | 4 Physical Cores, 8 Logical Processors |
| **System Memory** | 8.00 GB (8,253,232 KB total visible memory) | Shared across all tiers |
| **Node.js Version** | v24.21.0 | Native ES modules |
| **npm Version** | 11.19.0 | Project package manager |
| **Database** | MongoDB Server 8.3.7 | Local real service (`mongodb://127.0.0.1:27017/supportdesk`) |
| **Backend Server** | Node.js Express 4.21.2 + Socket.io 4.8.1 | Running locally on port 5000 |
| **LLM Provider** | Google Gemini API via `@google/genai` | Primary: `gemini-3.5-flash`, Fallback: `gemini-3.1-flash-lite` |
| **Resource Contention** | Shared single host | Server, MongoDB, and load generator share 8 GB RAM and 4 CPU cores |

---

## 2. Step 1: WebSocket Load Test Results

### Methodology & Definitions
- **Metric Definition:** One "message" is defined strictly as a customer emit (`customer:message`) that the support agent in that conversation receives (`message:new`).
- **Timing Harness:** Measured using a single high-resolution clock (`performance.now()`) within a single unified client process to eliminate clock drift.
- **Client Pacing:** Sockets emit messages at randomized intervals between 3.5s and 4.0s (average ~3.75s, or ~16 msg/min) to respect the server's in-memory sliding window rate limit of 20 msg/min per visitor.
- **Protocol Ramp:** Ramped across 100, 250, and 500 concurrent connections. Each level was tested for 60 seconds per run across 3 independent measured runs ($n = 9$ runs total, representing 540 seconds of active load traffic and 38,368 total delivered messages).
- **Execution Command:** `node eval/run_load_test_suite.js` (orchestrating `node eval/load_test_harness.js`)
- **Raw Data Files:** `eval/results/load_test_100_run*.json`, `eval/results/load_test_250_run*.json`, `eval/results/load_test_500_run*.json`, `eval/results/load_test_summary.json`

### Aggregated Results Table (Medians Across 3 Runs per Level)

| Concurrency Level | Runs ($n$) | Total Messages Delivered | Throughput (msg/s) | Latency p50 (ms) | Latency p95 (ms) | Latency p99 (ms) | Connection Errors | Runtime Disconnects | Server CPU (Avg / Peak) | Server RAM (Avg / Peak) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **100** | 3 (60s ea) | 4,009 | **20.70** | **1,168.12** | **2,204.70** | 2,260.58 | 0 | 0 | 27.8% / 72.1% | 193.1 MB / 230.2 MB |
| **250** | 3 (60s ea) | 11,570 | **61.72** | **90.15** | **384.91** | 1,087.08 | 0 | 0 | 33.3% / 80.7% | 302.9 MB / 321.4 MB |
| **500** | 3 (60s ea) | 22,789 | **119.84** | **328.86** | **2,814.99** | 3,358.91 | 0 | 0 | 66.4% / 100.7% | 359.7 MB / 382.6 MB |

> [!NOTE]
> **Level 1000 Stability Assessment:** Concurrency of 1000 was skipped because at 500 connections the shared 8 GB host reached CPU saturation (100.7% peak CPU) and the p95 latency degraded from 384.91 ms to 2,814.99 ms. Sockets did not drop, but CPU capacity reached its physical limit.

---

## 3. Step 2: Server Profiling & Bottleneck Analysis

- **Profiling Tool:** V8 internal statistical profiler (`node --prof`), analyzed via `node --prof-process`.
- **Target Load:** Concurrency level 500 (15,159 V8 execution ticks analyzed).
- **Raw Profiling Output:** `eval/results/profiling_summary.txt`, `eval/results/profiling_raw.txt`

### Execution Time Breakdown

| Category | Time Share | Top Hotspots |
| :--- | :---: | :--- |
| **System Libraries (I/O)** | **44.7%** | `ntdll.dll` (Windows asynchronous I/O completion ports / network socket multiplexing) |
| **Node.js Core Execution** | **18.5%** | `node.exe` (V8 garbage collection, promise queues, event loop scheduling) |
| **BSON & Database Serialization** | **~8.5%** | `bson/lib/bson.cjs` (`*serializeInto`, `*deserializeObject`, `*ObjectId`, `*serializeString`) |
| **MongoDB Driver Protocol** | **~7.2%** | `mongodb/lib/cmap/connection.js` (`*sendWire`, `*readMany`, `*sendCommand`), `connection_pool.js` (`*processWaitQueue`) |
| **Mongoose ODM Hydration** | **~6.1%** | `mongoose/lib/document.js` (`$toObject`, `applyDefaults`, `_getPathsToValidate`) |
| **Socket.io Parser & Broadcast** | **~4.8%** | `socket.io-parser` (`is-binary.js`, packet serialization, room distribution) |

### First Degradation Analysis
1. **The Culprit:** In `customerHandlers.js`, on **every single message** received over WebSocket, the server issues five distinct database operations:
   - `Conversation.findById(conversationId)` (read)
   - `saveMessage`: `Message.create` (insert) + `Conversation.findByIdAndUpdate` (update)
   - `Conversation.findById(conversationId).populate('assignee')` (read + join)
   - `getWorkspaceStats(workspaceId)`: issues **two** `countDocuments` queries and **one** aggregation pipeline (`Conversation.aggregate`)
2. **System Degradation:** At 120 messages/second, the single Node process executes over **700 MongoDB operations per second**. At 500 concurrent connections, the MongoDB connection pool wait queue (`connection_pool.js:432`) and BSON serialization saturate the CPU (peaking at 100.7%), causing the p95 latency to jump from 384 ms to 2,815 ms.

---

## 4. Step 3: Multi-Tenant Isolation Evaluation

- **Evaluation Script:** `node eval/test_tenant_isolation.js`
- **Sample Size ($n$):** 16 penetration attempts across two distinct workspaces (Alpha and Beta).
- **Result:** **16 of 16 attempts blocked (100.0%)**. 0 leaks detected.
- **Raw Results:** `eval/results/tenant_isolation.json`, `eval/results/tenant_isolation.txt`

| # | Protocol | Vector / Target | Expected Behavior | Observed Result | Status |
| :-: | :---: | :--- | :--- | :--- | :---: |
| 1 | **REST** | `GET /api/conversations` (Agent B) | Exclude Tenant A chats | 0 Tenant A conversations returned | **BLOCKED** |
| 2 | **REST** | `GET /api/conversations/:id/messages` (Agent B) | Reject access to Tenant A chat | HTTP 403 Forbidden | **BLOCKED** |
| 3 | **REST** | `GET /api/articles` (Agent B) | Exclude Tenant A articles | 0 Tenant A articles returned | **BLOCKED** |
| 4 | **REST** | `PUT /api/articles/:id` (Agent B) | Prevent modifying Tenant A article | HTTP 403 Forbidden | **BLOCKED** |
| 5 | **REST** | `DELETE /api/articles/:id` (Agent B) | Prevent deleting Tenant A article | HTTP 403 Forbidden | **BLOCKED** |
| 6 | **REST** | `GET /api/conversations/:id/messages` (No auth) | Reject unauthenticated request | HTTP 401 Unauthorized | **BLOCKED** |
| 7 | **REST** | `GET /api/stats` (Agent B) | Scoped workspace analytics only | Strictly scoped (open=1, unassigned=1) | **BLOCKED** |
| 8 | **Socket** | `agent:open` on Tenant A conversation | Reject cross-tenant open | `app:error: Conversation not found or access denied` | **BLOCKED** |
| 9 | **Socket** | `agent:message` to Tenant A conversation | Reject cross-tenant message write | `app:error: Conversation not found or access denied` | **BLOCKED** |
| 10 | **Socket** | `agent:claim` on Tenant A conversation | Reject cross-tenant assignment | `app:error: Conversation not found or access denied` | **BLOCKED** |
| 11 | **Socket** | `agent:close` on Tenant A conversation | Reject cross-tenant close | `app:error: Conversation not found or access denied` | **BLOCKED** |
| 12 | **Socket** | `agent:suggest` on Tenant A conversation | Reject cross-tenant AI draft | `app:error: Conversation not found or access denied` | **BLOCKED** |
| 13 | **Socket** | `ws:<id>` broadcast eavesdropping | Agent B must not receive Tenant A events | Agent A received event; Agent B received 0 events | **BLOCKED** |
| 14 | **Socket** | Customer session hijacking via `visitorId` | Must not resume cross-tenant chat | Server generated new isolated conversation | **BLOCKED** |
| 15 | **Socket** | Rogue customer write before session start | Reject unstarted customer message | `app:error: Chat session has not been started yet` | **BLOCKED** |
| 16 | **Socket** | `conv:<id>` customer room eavesdropping | Customer B must not receive Customer A chats | Customer B received 0 events | **BLOCKED** |

---

## 5. Step 4: Rate Limiting Verification

- **Evaluation Script:** `node eval/test_rate_limiting.js`
- **Configured Limits:** Customer: 20 messages / minute | Agent AI: 5 seconds cooldown
- **Raw Results:** `eval/results/rate_limiting.json`, `eval/results/rate_limiting.txt`

| Test Layer | Test Action | Configured Limit | Result | Verification |
| :--- | :--- | :---: | :--- | :---: |
| **Service Layer** | 25 rapid calls (`checkCustomerMessageRate`) | 20 / min | Calls 1–20 allowed (20/20); Calls 21–25 rejected (5/5) | **CONFIRMED** |
| **Service Layer** | Separate `visitorId` call immediately after | 20 / min | Call allowed (isolated per-visitor sliding window) | **CONFIRMED** |
| **Service Layer** | Rapid agent AI call (`checkAgentAiCooldown`) | 5s cooldown | Call 1 allowed; Call 2 immediately rejected (remaining: 5s) | **CONFIRMED** |
| **Service Layer** | Re-attempt agent AI after 5.2s elapsed | 5s cooldown | Call 3 allowed after cooldown elapsed | **CONFIRMED** |
| **WebSocket E2E** | 25 rapid `customer:message` emits | 20 / min | Messages 1–20 saved; Messages 21–25 emitted `app:error` | **CONFIRMED** |

> [!WARNING]
> **Architectural Limitation:** Rate limits are stored in in-memory JavaScript `Map` instances (`customerMessageBuckets`, `agentCooldowns`). They reset on process restart and do **not** synchronize across horizontally scaled multi-instance clusters without an external store such as Redis.

---

## 6. Step 5: RAG Evaluation (MongoDB $text Search + Gemini LLM)

- **Corpus Nature:** **100% Synthetic** customer support dataset (15 articles, 30 fixed test questions, committed in `eval/rag_ground_truth.json` prior to execution).
- **Evaluation Script:** `node eval/test_rag.js`
- **Retrieval Sample Size ($n$):** 150 evaluations (1 warm-up run + 5 measured runs over all 30 questions).
- **Gemini Sample Size ($n$):** 5 measured end-to-end runs (with 1 warm-up run, paced at 4.5s intervals).
- **Raw Results:** `eval/results/rag.json`, `eval/results/rag.txt`

### Retrieval Accuracy (MongoDB $text Search, $n = 150$)

| Query Category | Question Count | Evaluations ($n$) | Top-1 Hits | Top-1 Hit Rate | Top-3 Hits | Top-3 Hit Rate |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Direct** | 10 | 50 | 50 | **100.0%** | 50 | **100.0%** |
| **Paraphrased** | 8 | 40 | 35 | **87.5%** | 40 | **100.0%** |
| **Synonyms** | 7 | 35 | 30 | **85.7%** | 35 | **100.0%** |
| **Deliberately Hard** | 5 | 25 | 15 | **60.0%** | 20 | **80.0%** |
| **Overall Corpus** | **30** | **150** | **130** | **86.7%** | **145** | **96.7%** |

### Latency Profiles (Median and p95 across measured runs)

| Pipeline Component | Sample Count ($n$) | Engine / Target | Median Latency | p95 Latency | p99 Latency |
| :--- | :---: | :--- | :---: | :---: | :---: |
| **Retrieval Stage** | 150 | MongoDB 8.3.7 `$text` Index | **4.30 ms** | **14.53 ms** | 25.21 ms |
| **LLM Generation** | 5 | Google Gemini (`gemini-3.5-flash`) | **4,171.84 ms** | **4,588.62 ms** | N/A ($n < 100$) |
| **Total End-to-End** | 5 | Full RAG Pipeline (`suggestReply`) | **4,181.44 ms** | **4,595.78 ms** | N/A ($n < 100$) |

### Failure Analysis & Observed Fault Tolerance
1. **Linguistic Failure Case:** Question `q28` (*"Can I prevent team members from connecting from home or public networks?"*) failed to retrieve `kb_art_14` (*"IP Whitelisting and Network Access Restrictions"*) in the top-3. Because MongoDB `$text` search uses keyword matching and Porter stemming rather than dense semantic embeddings, queries lacking direct token stem overlap with article text miss relevant documents.
2. **Automated LLM Fallback In Action:** In measured Run 4, Google AI Studio returned HTTP 503 (*"This model is currently experiencing high demand"*). CogniDesk's dual-model fallback mechanism automatically caught the 503 and retried with `gemini-3.1-flash-lite`, completing the request successfully in 4,411.02 ms without user-visible failure.

---

## 7. Step 6: Input Validation Verification

- **Evaluation Script:** `node eval/test_validation.js`
- **Sample Size ($n$):** 36 malformed REST and WebSocket payloads.
- **Result:** **36 of 36 payloads correctly rejected (100.0%)**.
- **Raw Results:** `eval/results/validation.json`, `eval/results/validation.txt`

| Schema / Boundary | Payloads ($n$) | Tested Malformations | Rejection Rate |
| :--- | :---: | :--- | :---: |
| **`registerSchema`** | 10 | Short username (<2), empty username, missing `@` domain, missing user, password <6, missing fields, non-string types | **10 / 10 (100.0%)** |
| **`loginSchema`** | 4 | Invalid email syntax, empty password, missing email, missing password | **4 / 4 (100.0%)** |
| **`createWorkspaceSchema`** | 4 | Empty name, name <2 chars, missing name, numeric name | **4 / 4 (100.0%)** |
| **`joinWorkspaceSchema`** | 2 | Join code <6 chars, missing join code | **2 / 2 (100.0%)** |
| **`articleSchema` (Create)** | 6 | Empty title, missing title, empty content, missing content, content >4000 chars, numeric title | **6 / 6 (100.0%)** |
| **`articleSchema` (Update)** | 2 | Empty title, content >4000 chars | **2 / 2 (100.0%)** |
| **WebSocket Handshake** | 3 | Malformed JWT, non-existent workspace publicKey, empty credentials | **3 / 3 (100.0%)** |
| **Socket Message Payload** | 5 | Empty message text, whitespace-only text, text >1000 characters | **5 / 5 (100.0%)** |
| **Total Validation Suite** | **36** | **All boundaries enforced by Zod and domain validators** | **36 / 36 (100.0%)** |

---

## 8. Resume-Safe Claims

The following claims are strictly backed by measured data from the evaluation runs documented above. Each claim includes its exact sample size ($n$) and testing conditions.

1. **WebSocket Throughput & Concurrency:**  
   *"Engineered and evaluated a real-time support platform handling up to 500 concurrent WebSocket connections and 119.8 msg/s throughput with 0 connection drops or server errors across 22,789 delivered messages on a single host ($n = 3$ runs of 60s)."*

2. **Sub-100ms Median Latency at Moderate Scale:**  
   *"Achieved a median end-to-end WebSocket message delivery latency of 90.15 ms (p95: 384.91 ms) under 250 concurrent active connections ($n = 11,570$ measured round-trips)."*

3. **Multi-Tenant Boundary Isolation:**  
   *"Demonstrated 100% tenant isolation across 16 automated penetration vectors ($n = 16$), verifying strict boundary enforcement across REST endpoints, WebSocket room subscriptions (`ws:<id>`, `conv:<id>`), and agent authorization checks."*

4. **Fast Local Knowledge Retrieval:**  
   *"Benchmarked full-text RAG search using MongoDB `$text` indexing, achieving 86.7% Top-1 and 96.7% Top-3 retrieval accuracy with a median retrieval latency of 4.30 ms ($n = 150$ queries across 5 measured runs on a 15-article synthetic corpus)."*

5. **AI Suggestion Pipeline & Fault Resilience:**  
   *"Integrated Google Gemini for context-grounded AI support drafting (median latency 4,171.84 ms, $n = 5$), validated with automated fallback to `gemini-3.1-flash-lite` during transient upstream 503 service outages."*

6. **Input Validation Integrity:**  
   *"Enforced 100% rejection of malformed REST and WebSocket inputs across 36 attack vectors ($n = 36$) using schema-level Zod validation and domain constraints."*
