# SupportDesk — Real-Time Support Platform with RAG AI Assistance

[![Demo Link](https://img.shields.io/badge/Demo-Live_Preview-blue)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A modern, Intercom-style customer support desk built with Node.js, Express, Socket.io, React, and Google Gemini AI. Features real-time messaging, presence, knowledge base retrieval (RAG), sentiment and urgency detection, and automated conversation summarization.

---

### Demo Preview
![SupportDesk Demo Walkthrough](https://raw.githubusercontent.com/placeholder-demo/supportdesk-preview.gif)

*Live Demo Link:* [https://supportdesk.example.com](#)

---

## Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                  CLIENTS                                          |
|                                                                                   |
|   +----------------------------+             +--------------------------------+   |
|   |    Support Agent Inbox     |             |      Guest Customer Chat       |   |
|   |  - Real-time inbox & stats |             |  - No account required         |   |
|   |  - Typing & read receipts  |             |  - Unique visitor session      |   |
|   |  - AI suggestions & RAG    |             |  - Embedded iframe / link      |   |
|   +--------------+-------------+             +---------------+----------------+   |
+------------------|-------------------------------------------|--------------------+
                   | HTTP / WebSocket                          | HTTP / WebSocket
                   |                                           |
+------------------v-------------------------------------------v--------------------+
|                             SUPPORTDESK SERVER (Node.js)                          |
|                                                                                   |
|  +--------------------+   +-----------------------+   +------------------------+  |
|  | Express REST API   |   | Socket.io Coordinator |   | Security & Middleware  |  |
|  | - Auth (JWT/Bcrypt)|   | - Handshake Auth      |   | - Workspace scoping    |  |
|  | - KB Articles CRUD |   | - Rooms (ws: / conv:) |   | - In-memory limiters   |  |
|  | - Public chat meta |   | - Typing & presence   |   | - Zod validation       |  |
|  +--------------------+   +-----------+-----------+   +------------------------+  |
|                                       |                                           |
|                  +--------------------+---------------------+                     |
|                  |                                          |                     |
|         +--------v----------+                      +--------v-----------+         |
|         | Retrieval Service |                      |  LLM Service       |         |
|         | - MongoDB $text   |                      |  - Google Gemini   |         |
|         |   full-text score |                      |    (@google/genai) |         |
|         | - Workspace scoped|                      |  - Fallback model  |         |
|         +--------+----------+                      |  - Mock fallback   |         |
|                  |                                 +--------+-----------+         |
+------------------|------------------------------------------|---------------------+
                   |                                          |
        +----------v-----------+                   +----------v-----------+
        |   MongoDB Database   |                   | Google Gemini API    |
        | - Users & Workspaces |                   | - gemini-3.5-flash   |
        | - Conversations      |                   | - gemini-3.1-lite    |
        | - Messages & Articles|                   +----------------------+
        +----------------------+
```

---

## Features

- **Guest Customer Experience**: Customers join without account friction by opening a shareable link or iframe widget. Sessions persist across browser refresh.
- **Agent Command Center**: Live 3-column inbox with real-time updates for conversation list, typing indicators, read receipts, and live metrics.
- **AI-Powered Replies (RAG)**: Integrates the workspace's internal knowledge base to draft context-aware answers, avoiding hallucinations.
- **Sentiment & Urgency Detection**: Real-time analysis labels incoming customer state (`calm`, `frustrated`, `angry`) and priority (`low`, `medium`, `high`).
- **Auto-Summarization**: Automatically produces a concise 2-sentence summary and final sentiment upon conversation resolution.
- **Strict Multi-Tenant Isolation**: Agents only access conversations and knowledge base articles within their own workspace.
- **Resilient AI Mock Mode**: Works out of the box with zero external API keys required, using smart rule-based heuristics.

---

## Setup & Installation

### 1. Prerequisites
- Node.js 20+
- MongoDB 6+ running locally on `mongodb://127.0.0.1:27017/supportdesk`

### 2. Install Dependencies
```bash
npm run install:all
```

### 3. Environment Configuration
The server loads configuration from `server/.env`. A template is provided in `server/.env.example`.

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server HTTP port | `5000` |
| `MONGODB_URI` | MongoDB connection URI | `mongodb://127.0.0.1:27017/supportdesk` |
| `JWT_SECRET` | Secret key for signing agent tokens | `<random 64-char string>` |
| `CLIENT_ORIGIN` | Allowed client origin for CORS | `http://localhost:5173` |
| `GEMINI_API_KEY` | Google Gemini API key (optional) | `""` (Empty enables mock mode) |
| `GEMINI_MODEL` | Primary Gemini model | `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODEL` | Secondary fallback model | `gemini-3.1-flash-lite` |
| `AI_COOLDOWN_SECONDS` | Cooldown period between agent AI suggestions | `5` |

---

## Obtaining a Free Google Gemini API Key

1. Navigate to Google AI Studio: [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with your Google account and click **Create API Key**.
3. Copy the API key and paste it into `server/.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
4. **Handling Quotas & Model Errors**:
   - If you encounter HTTP `429 (Rate Limit)` or `503 (Model Overloaded)`, the server automatically falls back to `GEMINI_FALLBACK_MODEL` (`gemini-3.1-flash-lite`).
   - If the key is exhausted or invalid, the app falls back smoothly to internal Mock Mode without breaking chats or dropping messages.

---

## Socket.io Protocol & Permission Rules

### Handshake Authentication
- **Agents**: Provide `{ token: "<jwt_token>" }`. Verified against `JWT_SECRET`; assigns role `agent` and auto-joins `ws:<workspaceId>`.
- **Customers**: Provide `{ publicKey: "<workspace_key>", visitorId: "<optional_id>" }`. Verified against workspace records; assigns role `customer`.

### Socket Events Reference

| Event Name | Direction | Emitter | Description |
|---|---|---|---|
| `customer:start` | Client -> Server | Customer | Starts or resumes conversation by `visitorId`. |
| `customer:ready` | Server -> Client | Server | Returns active conversation ID and message history. |
| `customer:message` | Client -> Server | Customer | Sends customer message (rate limited to 20/min). |
| `customer:typing` | Client -> Server | Customer | Relays customer typing status. |
| `agent:open` | Client -> Server | Agent | Marks unread messages as read, joins conversation room. |
| `agent:opened` | Server -> Client | Server | Sends conversation object and message history to agent. |
| `agent:message` | Client -> Server | Agent | Sends agent reply, records first response time, auto-assigns. |
| `agent:typing` | Client -> Server | Agent | Relays agent typing status to customer. |
| `agent:claim` | Client -> Server | Agent | Assigns conversation to requesting agent. |
| `agent:close` | Client -> Server | Agent | Closes conversation and triggers async AI summarization. |
| `agent:suggest` | Client -> Server | Agent | Triggers RAG-assisted reply draft (subject to cooldown). |
| `conversation:new` | Server -> Client | Server | Broadcasts newly created conversation to workspace agents. |
| `conversation:updated` | Server -> Client | Server | Broadcasts metadata changes (assignee, unread, summary). |
| `message:new` | Server -> Client | Server | Delivers message to active conversation room. |
| `message:read` | Server -> Client | Server | Notifies conversation room of read receipts. |
| `stats:update` | Server -> Client | Server | Updates open, unassigned, and average first response metrics. |
| `customer:presence` | Server -> Client | Server | Broadcasts online/offline status of customer. |
| `ai:suggestion` | Server -> Client | Server | Delivers drafted reply and detected sentiment to agent. |
| `ai:error` | Server -> Client | Server | Notifies agent of cooldown or AI provider errors. |
| `app:error` | Server -> Client | Server | Safe user-facing error notice. |

### Strict Permission Guardrails
- **Customer Isolation**: A customer socket can only read and write to the conversation linked to their verified `visitorId`.
- **Workspace Isolation**: Agent socket events verify that the requested conversation belongs to the agent's active workspace.
- **Closed Conversation Immutability**: Any messages sent to a closed conversation are rejected.

---

## How Retrieval-Augmented Generation (RAG) Works

1. **Context Extraction**: When an agent clicks **Suggest reply**, the system extracts the customer's latest inquiry text.
2. **Text Index Search**: MongoDB performs an indexed `$text` query against the workspace's articles, scoring by relevance (`textScore`).
3. **Prompt Grounding**: The top relevant articles are inserted into the Gemini prompt as strict ground-truth context.
4. **Safety & Guardrails**: The system instruction forbids hallucination: if the knowledge base does not contain the answer, the AI explicitly advises the agent to verify internally rather than inventing details.
5. **Agent Verification**: Suggestions are drafts; the agent reviews, edits, and sends manually.

---

## Testing Guide

### Automated End-to-End Test Suite
Run the comprehensive 10-step server E2E test suite:
```bash
npm run test:e2e
```

### Manual Testing Workflow
1. Open a normal browser window at `http://localhost:5173`.
2. Register an agent, create a workspace (e.g., "Acme Support"), and add a knowledge base article under `/kb`.
3. Go to `/settings` and copy the public chat link.
4. Open an **Incognito / Private window** and paste the public chat link.
5. Enter a guest name and send a question covered by the knowledge base article.
6. Observe real-time message delivery, typing indicators, and unread badges in the agent inbox.
7. Click **Suggest reply** in the AI panel, verify the article source citation, and send the response.
8. Click **Close chat** and inspect the automatic 2-sentence conversation summary.

---

## Known Limitations

- **Free Tier Gemini Quotas**: Google's free tier has strict rate limits per minute (RPM/TPM). The app includes automatic cooldowns and fallback to mock mode.
- **Privacy Notice**: Prompts sent under Gemini free tier may be logged for Google product improvement. Use fictional test data in development.
- **Attachments**: The chat supports text messages up to 1000 characters; file uploads and email forwarding are intentionally excluded to keep the architecture focused and interview-ready.

---

## Interview Questions & Answers

### 1. How is multi-tenancy enforced between different business workspaces?
**Answer:** Multi-tenancy is enforced at both the database schema level and the application boundary. Every conversation and article contains a `workspace` foreign key. In REST controllers, we extract `req.user.workspace` from the verified JWT and scope all queries to `{ workspace: req.user.workspace._id }`. In Socket.io, agents join a workspace-specific room (`ws:<workspaceId>`), and every incoming agent event verifies that the conversation belongs to the agent's workspace before making changes.

### 2. How do Socket.io rooms prevent cross-customer data leakage?
**Answer:** Customer sockets never join the workspace broadcast room (`ws:<workspaceId>`). Instead, customer sockets only join a discrete room specific to their conversation (`conv:<conversationId>`). The server verifies during handshake that the customer's `visitorId` matches the conversation's owner, preventing customers from listening to or sending messages into other conversations.

### 3. How does the RAG retrieval pipeline work without an external vector database?
**Answer:** We leverage MongoDB's built-in full-text index on the `title` and `content` fields of the `Article` model. When an agent requests an AI suggestion, we run an indexed `$text` search sorted by relevance score (`$meta: 'textScore'`), strictly filtered by `workspace`. The matched articles are fed into the system prompt as grounding context for the LLM.

### 4. What happens if the LLM provider experiences downtime or hits rate limits?
**Answer:** Resilience is handled on multiple levels: first, on HTTP 429 or 503 errors, the client attempts a one-time retry using a lightweight fallback model (`gemini-3.1-flash-lite`). Second, if the call still fails (or if no API key is configured), the system seamlessly transitions to Mock Mode, returning rule-based sentiment detection and excerpts from the top article. A failure in AI assistance never blocks sending messages or closing conversations.

### 5. Why are agent tokens stored in `sessionStorage` instead of `localStorage`?
**Answer:** Storing agent credentials in `sessionStorage` isolates sessions to the individual browser tab. This allows a developer or reviewer to test multiple agents or switch between agent and guest roles simultaneously in the same browser without authentication conflicts.

---

## Resume Bullet Points

- Designed and engineered a full-stack, multi-tenant real-time customer support platform (SupportDesk) using Node.js, Express, Socket.io, React, and MongoDB.
- Implemented Retrieval-Augmented Generation (RAG) using Google Gemini and MongoDB full-text indexing to draft support replies grounded strictly in internal documentation.
- Built a secure, multi-room WebSocket architecture managing live inbox feeds, typing indicators, read receipts, and agent presence with zero cross-tenant leakage.
- Developed an automated NLP pipeline for sentiment analysis, urgency scoring, and conversation summarization with a zero-dependency mock mode fallback.
- Enforced strict rate limiting, sliding window algorithms, and Zod schema validations across REST and WebSocket communication layers.
