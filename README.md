# CogniDesk: Real-Time Support Platform with RAG AI Assistance

An Intercom-style customer support desk. Customers chat through a shareable link, agents handle chats in a live inbox, and an AI assistant drafts replies grounded in the company's knowledge base.

**Stack:** React 18 (Vite), Node.js, Express, Socket.io, MongoDB (Mongoose), Python FastAPI, Sentence Transformers, Zod, Google Gemini.

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
        | - MongoDB $text    |   | Gemini + fallback     |
        | - Vector / Hybrid  |   | model, mock mode      |
        +---+--------------+-+   +-----------------------+
            |              |
            |   +----------v------------------------+
            |   | Python Embedding Service (FastAPI)|
            |   | Sentence Transformers             |
            |   | all-MiniLM-L6-v2 (384 dims, L2)   |
            |   +-----------------------------------+
            |
        +---v----------------+
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

### 2. Knowledge Base Retrieval Modes & Benchmark
*Evaluated across all 3 retrieval modes on a synthetic corpus of 15 articles and 30 fixed test questions ($n = 150$ queries per mode over 5 measured runs). Pre-computed article embeddings measure pure search latency; query-embedding latency is measured separately.*

| Mode | Engine / Strategy | Top-1 Accuracy | Top-3 Accuracy | Search Latency p50 | Search Latency p95 | Query Embed p50 | Query Embed p95 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`text`** (default) | MongoDB 8.3.7 `$text` Index | **86.7%** (130/150) | **96.7%** (145/150) | **2.69 ms** | **4.58 ms** | *N/A* | *N/A* |
| **`vector`** | Local Cosine (`all-MiniLM-L6-v2`, 384 dims) | **96.7%** (145/150) | **96.7%** (145/150) | **32.78 ms** | **42.50 ms** | **26.51 ms** | **36.61 ms** |
| **`hybrid`** | Reciprocal Rank Fusion ($k=60$) | **96.7%** (145/150) | **100.0%** (150/150) | **17.25 ms** | **27.91 ms** | **26.51 ms** | **36.61 ms** |

*(Historical Cloud Baseline for comparison: `gemini-embedding-001` (3,072 dims) achieved 100.0% vector Top-1, but required **460.34 ms** query embedding latency — ~17x slower than the local model.)*

*Category-level findings:*
- **Direct queries (n=10):** All three modes achieved 100.0% Top-1 accuracy.
- **Paraphrased (n=8) & Synonyms (n=7):** Vector achieved 100.0% Top-1, whereas text mode dropped to 87.5% and 85.7% due to vocabulary divergence.
- **Deliberately Hard (n=5):** Text mode achieved 60.0% Top-1 and 80.0% Top-3 (completely missing question `q30` on 429 status codes). Vector achieved 80.0% Top-1. Hybrid achieved 80.0% Top-1 and **100.0% Top-3**.
- **Query Embedding Latency:** Local open-source `all-MiniLM-L6-v2` generates query vectors in **26.51 ms p50** (~17x faster than cloud Gemini embeddings at 460.34 ms).
- **End-to-End LLM Generation:** Google Gemini (`gemini-3.5-flash`) drafting latency averaged 16.48s median ($n = 5$, with 3.15s fallback on `gemini-3.1-flash-lite`).

### 3. Tenant Isolation & Validation
- **Multi-Tenant Boundary Enforcement:** **20 / 20 (100.0%)** cross-workspace attack vectors blocked across REST APIs, conversation IDs, WebSocket rooms (`ws:<id>`, `conv:<id>`), and knowledge base retrieval scopes (text, vector, and hybrid).
- **Input Validation:** **36 / 36 (100.0%)** malformed REST and WebSocket payloads rejected by Zod and domain constraints.
- **Rate Limiting:** Confirmed customer message limiting at 20 msg/min and agent AI cooldown at 5s.

## Prerequisites

- Node.js 20+
- Python 3.10+ (for local embeddings microservice)
- MongoDB running locally (`mongodb://127.0.0.1:27017/cognidesk`) or an Atlas URI

## Setup

```bash
git clone https://github.com/1shikharvarshney1/CogniDesk.git
cd CogniDesk

# Install Node dependencies across root, server, and client
npm run install:all

# Install Python dependencies for the embedding microservice
pip install -r embedding-service/requirements.txt

cp server/.env.example server/.env
# Edit server/.env: set MONGODB_URI and JWT_SECRET, optionally GEMINI_API_KEY

# Starts frontend (Vite), backend (Node Express), and embedding service (FastAPI) concurrently
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:5000
- Embedding Service: http://localhost:8000

## Environment Variables

| Variable                | Default                                 | Description                                        |
| ----------------------- | --------------------------------------- | -------------------------------------------------- |
| `PORT`                  | `5000`                                  | Server port                                        |
| `MONGODB_URI`           | `mongodb://127.0.0.1:27017/cognidesk`   | MongoDB connection string                          |
| `JWT_SECRET`            | none (required)                         | Secret for signing agent tokens                    |
| `CLIENT_ORIGIN`         | `http://localhost:5173`                 | Allowed CORS origin                                |
| `GEMINI_API_KEY`        | empty (mock mode)                       | Google AI Studio key                               |
| `GEMINI_MODEL`          | `gemini-3.5-flash`                      | Primary Gemini model for generation                |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.1-flash-lite`                 | Fallback generation model                          |
| `RETRIEVAL_MODE`        | `text`                                  | Knowledge retrieval engine: `text`, `vector`, `hybrid` |
| `EMBEDDING_PROVIDER`    | `local`                                 | Embedding provider: `local` (Sentence Transformers) or `gemini` |
| `EMBEDDING_SERVICE_URL` | `http://127.0.0.1:8000`                 | Endpoint for local FastAPI embedding service       |
| `EMBEDDING_MODEL`       | `all-MiniLM-L6-v2`                      | Embedding model (`all-MiniLM-L6-v2` 384 dims for local; `gemini-embedding-001` 3072 dims for gemini) |
| `AI_COOLDOWN_SECONDS`   | `5`                                     | Cooldown between AI suggestions                    |

## Retrieval Modes

CogniDesk supports three retrieval strategies behind `RETRIEVAL_MODE`:

1. **Text (`text`, default):**
   - Uses MongoDB's built-in `$text` inverted index with Porter stemming.
   - **Pros:** Fast local execution (~2.7 ms median search latency), zero external service dependencies or embedding overhead.
   - **Cons:** Fails on queries with vocabulary divergence (e.g., "connecting from home" vs "IP whitelisting", or error codes like 429).
2. **Vector (`vector`):**
   - Embeds knowledge base articles with open-source Sentence Transformers `all-MiniLM-L6-v2` (384 dimensions, L2 normalized) served from the local FastAPI microservice (or cloud Gemini when `EMBEDDING_PROVIDER=gemini`).
   - Generates a query vector in ~26.5 ms and computes cosine similarity in Node memory across all articles in the caller's workspace.
   - **Pros:** High semantic recall (96.7% Top-1 accuracy on our 30-question benchmark), resolving paraphrasing and synonyms with zero cloud API costs and sub-30ms query latency.
   - **Cons:** Compact 384-dimensional latent space may occasionally misprioritize isolated numeric codes without lexical context.
3. **Hybrid (`hybrid`):**
   - Runs text search and vector search in parallel within the workspace.
   - Merges and re-ranks the candidates using Reciprocal Rank Fusion (RRF, $k=60$):
     $$\text{RRF\_Score}(d) = \sum_{m \in \{\text{text}, \text{vector}\}} \frac{1}{60 + \text{rank}_m(d)}$$
   - Combines lexical precision for exact keywords with semantic resilience, achieving **100.0% Top-3 accuracy**.

> **Tenant Isolation:** Vector and hybrid retrieval strictly filter candidates by `{ workspace: workspaceId }` in MongoDB before computing similarity, ensuring cross-tenant boundaries remain uncompromised.
> **Graceful Fallback:** If the embedding microservice is offline or errors (or `GEMINI_API_KEY` is missing in Gemini mode), `vector` and `hybrid` automatically fall back to MongoDB `$text` search.

## Running Embeddings Backfill & Evaluations

### Backfill Article Embeddings
When switching existing workspaces to `vector` or `hybrid` mode, run the backfill script to generate embeddings for articles that lack them:

```bash
cd server
npm run embeddings:backfill
```

### Running the Retrieval Evaluation
To execute the 30-question comparative benchmark across all three retrieval modes and generate fresh performance metrics:

```bash
node eval/test_rag.js
```

Raw evaluation output is saved to `eval/results/rag.json` and `eval/results/rag.txt`. Detailed methodology and benchmark results are documented in [eval/RESULTS.md](eval/RESULTS.md).

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
2. **Search**: the retrieval service searches the workspace's articles using the configured `RETRIEVAL_MODE` (MongoDB `$text` keyword search, local Sentence Transformers dense vector embeddings, or hybrid RRF).
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

- The local Sentence Transformers embedding microservice requires Python 3.10+ and downloads ~90 MB model weights on initial cold start, consuming ~300 MB RAM in runtime memory.
- The free Gemini tier has per-minute limits.
- Messages are text only (up to 1000 characters); there are no file uploads or email forwarding.
- Rate limiters are in memory, so they reset when the server restarts.
