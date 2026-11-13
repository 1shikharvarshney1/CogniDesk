# CogniDesk: Real-Time Support Platform with RAG AI Assistance

An Intercom-style customer support desk. Customers chat through a shareable link, agents handle chats in a live inbox, and an AI assistant drafts replies grounded in the company's knowledge base.

**Stack:** React 18 (Vite), Node.js, Express, Socket.io, MongoDB (Mongoose), Zod, Google Gemini.

## Architecture

```
  Agent Inbox (React)                 Guest Customer Chat (React)
  - live inbox and stats              - no account needed
  - typing, read receipts             - session survives refresh
  - AI suggestions
          |                                      |
          +-------- HTTP / WebSocket ------------+
                            |
          +-----------------v------------------+
          |      Express + Socket.io server    |
          |  - JWT auth for agents             |
          |  - Workspace-scoped rooms/queries  |
          |  - Rate limiting, Zod validation   |
          +--------+--------------------+------+
                   |                    |
        +----------v---------+   +------v----------------+
        | Retrieval service  |   | LLM service           |
        | MongoDB $text      |   | Gemini + fallback     |
        | search per         |   | model, mock mode      |
        | workspace          |   +-----------------------+
        +----------+---------+
                   |
        +----------v---------+
        |      MongoDB       |
        | Users, Workspaces, |
        | Conversations,     |
        | Messages, Articles |
        +--------------------+
```

## Features

- **Guest chat**: customers open a link, enter a name and chat; sessions persist across refresh
- **Agent inbox**: live conversation list, typing indicators, read receipts and live stats
- **AI suggested replies (RAG)**: the assistant answers from the workspace's knowledge base and cites its source
- **Sentiment and urgency**: labels the customer as calm, frustrated or angry, with a priority level
- **Auto-summary**: a short summary is generated when a chat is closed
- **Multi-tenant isolation**: agents only see conversations and articles from their own workspace
- **Mock mode**: works without an API key using simple rules

## Empirical Performance & Evaluation

All metrics were freshly measured on a single shared 8 GB host (Windows 11, Intel i5-10300H 4C/8T, local MongoDB 8.3.7) with zero synthetic padding. See full reproduction scripts and raw data in [/eval](eval/RESULTS.md).

### 1. WebSocket Concurrency & Message Latency
*Evaluated across 3 measured runs of 60s per level ($n = 38,368$ total delivered messages; 1 customer emit to agent receipt).*

| Concurrent Sockets | Throughput (msg/s) | Latency p50 | Latency p95 | Latency p99 | Errors / Disconnects | Server CPU (Avg / Peak) | Server RAM (Avg) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **100** | 20.70 msg/s | 1,168.12 ms | 2,204.70 ms | 2,260.58 ms | 0 / 0 | 27.8% / 72.1% | 193.1 MB |
| **250** | 61.72 msg/s | 90.15 ms | 384.91 ms | 1,087.08 ms | 0 / 0 | 33.3% / 80.7% | 302.9 MB |
| **500** | 119.84 msg/s | 328.86 ms | 2,814.99 ms | 3,358.91 ms | 0 / 0 | 66.4% / 100.7% | 359.7 MB |

### 2. Knowledge Base Retrieval (MongoDB $text Search)
*Evaluated on a synthetic corpus of 15 articles and 30 test questions ($n = 150$ queries over 5 measured runs).*

| Category | Questions | Evaluations ($n$) | Top-1 Accuracy | Top-3 Accuracy | Retrieval Latency (p50 / p95) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Direct Queries** | 10 | 50 | 100.0% | 100.0% | 4.30 ms / 14.53 ms |
| **Paraphrased** | 8 | 40 | 87.5% | 100.0% | 4.30 ms / 14.53 ms |
| **Synonyms** | 7 | 35 | 85.7% | 100.0% | 4.30 ms / 14.53 ms |
| **Deliberately Hard** | 5 | 25 | 60.0% | 80.0% | 4.30 ms / 14.53 ms |
| **Total Corpus** | **30** | **150** | **86.7%** | **96.7%** | **Median: 4.30 ms \| p95: 14.53 ms** |

*Note: Google Gemini LLM generation latency averaged 4,171.84 ms (p95: 4,588.62 ms, $n = 5$), with automated fallback to `gemini-3.1-flash-lite` on transient 503 errors.*

### 3. Tenant Isolation & Validation
- **Multi-Tenant Boundary Enforcement:** **16 / 16 (100.0%)** cross-workspace attack vectors blocked across REST APIs, conversation IDs, and WebSocket rooms (`ws:<id>`, `conv:<id>`).
- **Input Validation:** **36 / 36 (100.0%)** malformed REST and WebSocket payloads rejected by Zod and domain constraints.
- **Rate Limiting:** Confirmed customer message limiting at 20 msg/min and agent AI cooldown at 5s.

## Prerequisites

- Node.js 20+
- MongoDB running locally (`mongodb://127.0.0.1:27017/supportdesk`) or an Atlas URI

## Setup

```bash
git clone https://github.com/1shikharvarshney1/CogniDesk.git
cd CogniDesk

npm run install:all

cp server/.env.example server/.env
# Edit server/.env: set MONGODB_URI and JWT_SECRET, optionally GEMINI_API_KEY

npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:5000

## Environment Variables

| Variable                | Default                                 | Description                     |
| ----------------------- | --------------------------------------- | ------------------------------- |
| `PORT`                  | `5000`                                  | Server port                     |
| `MONGODB_URI`           | `mongodb://127.0.0.1:27017/supportdesk` | MongoDB connection string       |
| `JWT_SECRET`            | none (required)                         | Secret for signing agent tokens |
| `CLIENT_ORIGIN`         | `http://localhost:5173`                 | Allowed CORS origin             |
| `GEMINI_API_KEY`        | empty (mock mode)                       | Google AI Studio key            |
| `GEMINI_MODEL`          | `gemini-3.5-flash`                      | Primary Gemini model            |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.1-flash-lite`                 | Fallback model                  |
| `AI_COOLDOWN_SECONDS`   | `5`                                     | Cooldown between AI suggestions |

## Enabling the Real AI

1. Create a free key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in `server/.env` as `GEMINI_API_KEY=your_key` and restart the server.
3. On rate limit (429), overload (503) or unknown model (404), the server retries once with `GEMINI_FALLBACK_MODEL`. If the AI still fails, the agent sees a friendly error and the chat keeps working.

> **Privacy:** on the free tier, Google may use prompts to improve its products. Use fictional data.

## How to Try It

Each browser tab keeps its own session. Use one normal window for the agent and an incognito window for the customer:

1. Agent: open http://localhost:5173, register, and create a workspace.
2. Add an article under **Knowledge Base** (for example, a refund policy).
3. Open **Settings** and copy the public chat link.
4. Customer (incognito): open the link, enter a name and ask a question covered by the article.
5. Agent: watch the message arrive live, click **Suggest reply**, check the cited source, and send a reply.
6. Click **Close chat** to see the automatic summary.

## How RAG Works Here

1. **Query**: when an agent clicks Suggest reply, the customer's latest messages are used as the query.
2. **Search**: MongoDB runs a `$text` search on the workspace's articles and ranks by relevance.
3. **Grounding**: the top articles are added to the Gemini prompt as the only source of truth.
4. **Safety**: if the knowledge base doesn't contain the answer, the AI says so instead of inventing one.
5. **Human in the loop**: suggestions are drafts; the agent edits and sends them.

## Socket Protocol

### Handshake

- **Agents**: send `{ token }` (JWT). They join the room `ws:<workspaceId>`.
- **Customers**: send `{ publicKey, visitorId? }`. They only join their own room `conv:<conversationId>`.

### Events

| Event                  | Direction        | Description                                    |
| ---------------------- | ---------------- | ---------------------------------------------- |
| `customer:start`       | Client to Server | Start or resume a conversation by `visitorId`  |
| `customer:ready`       | Server to Client | Conversation ID and message history            |
| `customer:message`     | Client to Server | Customer message (rate limited)                |
| `customer:typing`      | Client to Server | Customer typing status                         |
| `agent:open`           | Client to Server | Open a conversation and mark messages read     |
| `agent:opened`         | Server to Client | Conversation and history for the agent         |
| `agent:message`        | Client to Server | Agent reply; records first response time       |
| `agent:typing`         | Client to Server | Agent typing status                            |
| `agent:claim`          | Client to Server | Assign the conversation to the agent           |
| `agent:close`          | Client to Server | Close the conversation and trigger the summary |
| `agent:suggest`        | Client to Server | Request an AI reply draft                      |
| `conversation:new`     | Server to Client | New conversation for workspace agents          |
| `conversation:updated` | Server to Client | Assignee, unread count or summary changed      |
| `message:new`          | Server to Client | New message in the conversation room           |
| `message:read`         | Server to Client | Read receipt                                   |
| `stats:update`         | Server to Client | Open, unassigned and average first response    |
| `customer:presence`    | Server to Client | Customer online or offline                     |
| `ai:suggestion`        | Server to Client | Drafted reply, sentiment and sources           |
| `ai:error`             | Server to Client | Cooldown or AI provider error                  |
| `app:error`            | Server to Client | Safe user-facing error                         |

### Permission rules

- A customer can only read and write the conversation linked to their `visitorId`.
- Agent events check that the conversation belongs to the agent's workspace.
- Messages sent to a closed conversation are rejected.

## Known Limitations

- The free Gemini tier has per-minute limits.
- Messages are text only (up to 1000 characters); there are no file uploads or email forwarding.
- Rate limiters are in memory, so they reset when the server restarts.
