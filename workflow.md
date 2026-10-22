<!--
Vector-IDE workflow and architecture reference.
This document describes the code currently present in the repository.
It distinguishes implemented behaviour from recommended improvements.
-->

<div align="center">

# Vector-IDE — System Workflow & Architecture

**An AI-assisted, browser-based development environment**

Understand the product from sign-in to project creation, file editing, AI-driven code changes, terminal execution, preview, and credit purchase.

</div>

<p align="center">
  <img alt="Frontend" src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB?style=flat-square&logo=react&logoColor=black">
  <img alt="Backend" src="https://img.shields.io/badge/Backend-Express%20Services-111827?style=flat-square&logo=nodedotjs">
  <img alt="AI" src="https://img.shields.io/badge/AI-LangChain%20%2B%20LangGraph-2563EB?style=flat-square">
  <img alt="Database" src="https://img.shields.io/badge/Data-MongoDB%20%2B%20Redis-16A34A?style=flat-square">
</p>

> **Purpose of this document:** explain how the current implementation works, where the important code lives, and how the main components communicate. The diagrams describe the repository's design; the notes labelled **Implementation note** identify limitations that should not be confused with completed production safeguards.

---

## Contents

1. [What Vector-IDE does](#1-what-vector-ide-does)
2. [System architecture](#2-system-architecture)
3. [Codebase map](#3-codebase-map)
4. [Technologies and their roles](#4-technologies-and-their-roles)
5. [Authentication and session workflow](#5-authentication-and-session-workflow)
6. [Dashboard and project lifecycle](#6-dashboard-and-project-lifecycle)
7. [File explorer and editor workflow](#7-file-explorer-and-editor-workflow)
8. [AI agent and tool-execution workflow](#8-ai-agent-and-tool-execution-workflow)
9. [AI streaming with Server-Sent Events](#9-ai-streaming-with-server-sent-events)
10. [Terminal and preview workflow](#10-terminal-and-preview-workflow)
11. [Plans, payments, and credits](#11-plans-payments-and-credits)
12. [Data models and caching](#12-data-models-and-caching)
13. [Security boundaries and engineering trade-offs](#13-security-boundaries-and-engineering-trade-offs)
14. [Configuration and local services](#14-configuration-and-local-services)
15. [Interview walkthroughs](#15-interview-walkthroughs)
16. [Repository checklist and glossary](#16-repository-checklist-and-glossary)

---

## 1. What Vector-IDE does

Vector-IDE is a browser-based coding workspace with an AI agent that is designed to make actual changes to a user's project. It brings several familiar developer tools into one interface:

- **Dashboard:** create, list, star, and open projects.
- **File explorer:** browse a nested directory structure and create, rename, and delete entries.
- **Code editor:** edit file content using Monaco Editor and save it to the backend.
- **AI chat:** describe a feature in natural language and let an agent inspect and modify project files through predefined tools.
- **Terminal:** open a terminal session for a project using a pseudo-terminal and Socket.IO.
- **Preview:** render a basic HTML/CSS/JavaScript preview in an iframe.
- **Plans and credits:** create Razorpay orders and grant credits after payment verification.

### The main idea

A conventional chatbot mainly returns text. Vector-IDE's AI workflow is designed to connect model decisions to real file operations.

~~~mermaid
flowchart LR
    U[User describes a change] --> A[AI agent interprets request]
    A --> T{Need a tool?}
    T -- Yes --> F[File tools]
    F --> S[File service]
    S --> DB[(MongoDB)]
    DB --> R[Tool result]
    R --> A
    T -- No --> M[Final assistant message]
    S --> UI[Refresh Explorer]
    M --> UI
~~~

The model does not receive unrestricted database access. The application defines a set of tools such as reading a file, retrieving the project tree, and creating or updating files. The backend executes those tools and returns their results to the agent.

---

## 2. System architecture

### 2.1 High-level component diagram

~~~mermaid
flowchart TB
    Browser["Browser<br/>React + Vite"]
    Gateway["Express API Gateway<br/>Default port 8000"]

    Auth["Auth service<br/>Default port 8001"]
    Project["Project service<br/>Default port 8002"]
    File["File service<br/>Default port 8003"]
    AI["AI service<br/>Default port 8004"]
    Terminal["Terminal service<br/>Default port 8005"]
    Payment["Payment service<br/>Default port 8006"]

    Mongo[("MongoDB<br/>Mongoose models")]
    Redis[("Redis<br/>Sessions + project cache")]
    LLM["OpenRouter API<br/>DeepSeek Chat"]
    Razorpay["Razorpay API"]

    Browser -->|"HTTP + session cookie"| Gateway
    Browser -.->|"Socket.IO / WebSocket URL is configurable"| Terminal

    Gateway --> Auth
    Gateway --> Project
    Gateway --> File
    Gateway --> AI
    Gateway --> Terminal
    Gateway --> Payment

    Gateway <--> Redis
    Project <--> Redis

    Auth --> Mongo
    Project --> Mongo
    File --> Mongo
    AI --> LLM
    AI -->|"Internal HTTP file API calls"| File
    AI -->|"Credit-deduction request"| Auth
    Payment --> Razorpay
    Payment --> Mongo
    Payment -->|"Add credits request"| Auth
    Auth <--> Redis
~~~

**How to read this diagram:**

1. The frontend sends normal API requests through the gateway URL configured in the frontend.
2. The gateway validates the Redis-backed session on protected HTTP routes and forwards the request to the relevant service.
3. A proxy helper propagates the authenticated user's ID to project, file, AI, and payment services using the `x-user-id` header.
4. The AI service calls the file service over HTTP when its agent tools read or modify project files.
5. The terminal has a separate Socket.IO communication path. Its destination depends on `VITE_TERMINAL_SERVICE_URL`; the gateway also contains a Socket.IO proxy.
6. MongoDB stores application records, while Redis stores sessions and selected cached query results.

The repository follows a **service-oriented / microservices-style structure**. The code has separately organized Express processes and service-specific responsibilities. This separation improves clarity, but also creates operational concerns such as network failures, shared-secret management, consistency across services, and deployment configuration.

### 2.2 Gateway routing and default ports

The port values below are defaults from the service entry points. Environment variables can override them.

| Component | Default port | Gateway route / use |
|---|---:|---|
| API Gateway | 8000 | Frontend API entry point |
| Auth service | 8001 | `/api/auth` |
| Project service | 8002 | `/api/project` |
| File service | 8003 | `/api/file` |
| AI service | 8004 | `/api/ai` |
| Terminal service | 8005 | `/api/terminal` plus Socket.IO path |
| Payment service | 8006 | `/api/payment` |
| Redis | 6379 in the supplied Compose file | Session and cache storage |

The gateway configures CORS with a specific frontend origin from `FRONTEND_URL` and allows credentials. It uses cookie parsing for session cookies, and HTTP proxying to route requests. A separate WebSocket proxy forwards requests under the Socket.IO path.

### 2.3 Why have an API gateway?

The gateway provides a common frontend entry point and makes it possible to apply session checks before forwarding protected HTTP requests. It also hides the need for the frontend to know every internal service route.

The trade-off is that the gateway becomes an important dependency. Its route configuration, identity propagation, CORS rules, and WebSocket proxy must all be configured correctly.

---

## 3. Codebase map

The code is currently nested under the repository's top-level `Vector-IDE/` directory.

~~~text
Vector-IDE/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ProjectPage.jsx
│   │   │   └── Plan.jsx
│   │   ├── components/
│   │   │   ├── AiChat.jsx
│   │   │   ├── Explorer.jsx
│   │   │   ├── Folder.jsx
│   │   │   ├── Editor.jsx
│   │   │   ├── Preview.jsx
│   │   │   ├── Terminal.jsx
│   │   │   ├── BottomPanel.jsx
│   │   │   ├── CreateProjectModal.jsx
│   │   │   └── ProjectCard.jsx
│   │   ├── features/
│   │   │   ├── login.js
│   │   │   ├── logout.js
│   │   │   ├── me.js
│   │   │   ├── project.js
│   │   │   ├── file.js
│   │   │   └── payment.js
│   │   ├── redux/
│   │   │   ├── store.js
│   │   │   ├── userSlice.js
│   │   │   └── projectSlice.js
│   │   └── utils/axios.js
│   └── firebase.js
│
└── backend/
    ├── gateway/
    │   ├── index.js
    │   ├── middleware/protect.js
    │   └── utils/proxyWithHeader.js
    ├── services/
    │   ├── auth/
    │   ├── project/
    │   ├── file/
    │   ├── ai/
    │   │   ├── controllers/ai.controller.js
    │   │   ├── graph/graph.js
    │   │   ├── graph/tools.js
    │   │   └── utils/
    │   ├── terminal/
    │   │   └── index.js
    │   └── payment/
    ├── shared/redis/redis.js
    └── docker-compose.yml
~~~

### Files to read first when explaining the project

| Topic | Start with these files |
|---|---|
| Application entry and routes | `frontend/src/App.jsx`, `frontend/src/main.jsx` |
| Frontend API calls | `frontend/src/utils/axios.js`, `frontend/src/features/` |
| Authentication | `frontend/src/pages/Dashboard.jsx`, `backend/services/auth/controllers/auth.controller.js` |
| Gateway / session verification | `backend/gateway/index.js`, `backend/gateway/middleware/protect.js` |
| Dashboard / projects | `frontend/src/pages/Dashboard.jsx`, `frontend/src/components/CreateProjectModal.jsx`, `backend/services/project/controllers/project.controller.js` |
| File tree | `backend/services/file/controllers/file.controller.js`, `backend/services/file/utils/buildTree.js` |
| Editor | `frontend/src/components/Editor.jsx` |
| AI workflow | `frontend/src/components/AiChat.jsx`, `backend/services/ai/controllers/ai.controller.js`, `backend/services/ai/graph/graph.js`, `backend/services/ai/graph/tools.js` |
| Terminal | `frontend/src/components/Terminal.jsx`, `backend/services/terminal/index.js` |
| Credits and payments | `frontend/src/features/payment.js`, `backend/services/payment/controllers/payment.controllers.js` |

---

## 4. Technologies and their roles

| Technology | Role in Vector-IDE | Where to look |
|---|---|---|
| React | Component-based frontend | `frontend/src/` |
| Vite | Frontend development server and build tooling | `frontend/package.json` |
| React Router | Routes for dashboard, project workspace, and plans | `frontend/src/App.jsx` |
| Redux Toolkit | Shared user/project state | `frontend/src/redux/` |
| Axios | Frontend HTTP helper | `frontend/src/utils/axios.js` |
| Firebase Auth | Google sign-in in the browser | `frontend/src/pages/Dashboard.jsx` |
| Firebase Admin | Backend verification of Firebase ID tokens | `backend/services/auth/controllers/auth.controller.js` |
| Express | HTTP gateway and separate service APIs | `backend/` |
| Mongoose / MongoDB | User, project, file, and payment documents | `backend/services/*/models/` |
| Redis / ioredis | Sessions and project list cache | `backend/shared/redis/redis.js` |
| LangChain | Message types, model integration, and tool binding | `backend/services/ai/` |
| LangGraph | Agent/tool graph orchestration | `backend/services/ai/graph/graph.js` |
| Zod | Schemas for AI tool arguments | `backend/services/ai/graph/tools.js` |
| OpenRouter / DeepSeek Chat | Language-model endpoint and configured model | `backend/services/ai/utils/llm.js` |
| SSE | Streams AI status, messages, and file-operation events over HTTP | `backend/services/ai/controllers/ai.controller.js` |
| Monaco Editor | Code editing interface | `frontend/src/components/Editor.jsx` |
| xterm.js | Browser terminal emulator | `frontend/src/components/Terminal.jsx` |
| Socket.IO + node-pty | Bidirectional terminal transport and pseudo-terminal process | `backend/services/terminal/index.js` |
| Razorpay | Payment order creation and payment signature verification | `backend/services/payment/` |
| Docker Compose | Starts Redis in the supplied Compose configuration | `backend/docker-compose.yml` |

**Important distinctions:**

- Redux is frontend state, not permanent database storage.
- Redis is used for low-latency session lookup and caching; MongoDB stores persistent records.
- Monaco renders and edits source code; application code implements persistence.
- SSE is a server-to-client stream carried over HTTP. Socket.IO provides the terminal's interactive, bidirectional transport.
- LangGraph manages the agent's workflow; the model proposes actions, while tool implementations execute them.

---

## 5. Authentication and session workflow

### 5.1 Sign-in sequence

The browser uses Firebase's Google sign-in flow. The backend verifies the resulting Firebase ID token and creates an application-level session.

~~~mermaid
sequenceDiagram
    actor User
    participant UI as Dashboard.jsx
    participant Firebase as Firebase Auth
    participant Auth as Auth service
    participant Mongo as MongoDB
    participant Redis as Redis
    participant Browser as Browser cookie jar

    User->>UI: Click Continue with Google
    UI->>Firebase: signInWithPopup()
    Firebase-->>UI: Authenticated user
    UI->>Firebase: getIdToken()
    Firebase-->>UI: Firebase ID token
    UI->>Auth: POST /api/auth/login { token }
    Auth->>Firebase: verifyIdToken(token)
    Firebase-->>Auth: Verified claims / UID
    Auth->>Mongo: Find user by firebaseUid
    alt First login
        Auth->>Mongo: Create user profile
    end
    Auth->>Redis: Store session mapping and session data
    Auth-->>Browser: Set session cookie
    Auth-->>UI: User data
    UI->>UI: dispatch(setUserData(data))
~~~

### 5.2 Identity versus application session

These are different credentials with different responsibilities:

1. **Firebase ID token:** used at login so the backend can verify the Firebase identity.
2. **Application session ID:** generated by the backend using `crypto.randomUUID()`.
3. **Session record in Redis:** maps the session ID to application user data and is given a seven-day expiration.
4. **HTTP-only browser cookie:** carries the application session ID on eligible future requests.

The auth controller stores two keys:

- `user-session-{userId}` → session ID
- `session-{sessionId}` → session data such as user ID, name, email, avatar, and credits

The cookie uses `httpOnly: true`, a seven-day `maxAge`, and environment-dependent `secure` and `sameSite` settings. In production, the code sets `secure: true` and `sameSite: "none"`; modern browsers require Secure for SameSite=None cookies.

The frontend's Axios client has `withCredentials: true`. The gateway enables CORS credentials for the configured frontend origin.

### 5.3 Subsequent protected API request

~~~mermaid
flowchart TD
    A[Browser sends API request] --> B{Session cookie present?}
    B -- No --> C[Return 401]
    B -- Yes --> D[Gateway reads session ID]
    D --> E[Redis lookup: session-sessionId]
    E --> F{Session exists?}
    F -- No --> G[Return 401]
    F -- Yes --> H[Attach data to req.user]
    H --> I[Proxy request to downstream service]
    I --> J[Proxy helper forwards x-user-id]
    J --> K[Service performs operation]
~~~

The middleware is `backend/gateway/middleware/protect.js`. The `proxyWithHeader.js` helper forwards `req.user._id` as `x-user-id` for the services using that helper.

### 5.4 Logout sequence

The frontend calls `GET /api/auth/logout`. The auth controller deletes `session-{sessionId}` from Redis and clears the cookie. Future protected requests should then fail the Redis session lookup.

**Implementation note:** the logout code does not remove the associated `user-session-{userId}` mapping, so that mapping can remain until its TTL expires.

### Interview concepts

- **Authentication** answers “Who are you?”
- **Authorization** answers “What are you allowed to access?”
- **HTTP-only** makes a cookie inaccessible to ordinary browser JavaScript; it is not a complete defense against all session attacks.
- **CORS** controls cross-origin browser access. It is not an authentication or authorization mechanism.
- A valid session does not automatically authorize a user to access every project or file. Each resource operation must check ownership or permissions.

---

## 6. Dashboard and project lifecycle

### 6.1 Create a project

~~~mermaid
sequenceDiagram
    actor User
    participant Modal as CreateProjectModal.jsx
    participant Gateway as API Gateway
    participant Project as Project service
    participant Mongo as MongoDB
    participant Redis as Redis
    participant File as File service
    participant Redux as Redux store

    User->>Modal: Enter project name/description
    Modal->>Gateway: POST /api/project
    Gateway->>Gateway: Validate session
    Gateway->>Project: Forward request + x-user-id
    Project->>Mongo: Create project owned by user
    Project->>Redis: Invalidate projects-userId cache
    Project-->>Modal: New project document
    Modal->>Gateway: POST /api/file/create-root-folder
    Gateway->>File: Forward request + x-user-id
    File->>Mongo: Create root folder
    Modal->>Redux: dispatch(addNewProject(data))
    Redux-->>User: Project appears on dashboard
~~~

The modal is `frontend/src/components/CreateProjectModal.jsx`. The project service persists project metadata in the Project collection. The modal then creates a root folder through the file service and updates Redux.

**Implementation note:** the project creation request and root-folder creation request are separate calls, not a single transaction. If root-folder creation fails after project creation succeeds, the data can be left partially initialized. The frontend helper also returns `null` on API errors, so the modal should check both responses before treating creation as successful.

### 6.2 Read projects and use Redis cache

In `backend/services/project/controllers/project.controller.js`, the projects endpoint follows a cache-aside strategy:

~~~mermaid
flowchart TD
    A[GET /api/project] --> B[Build projects-userId key]
    B --> C{Redis cache hit?}
    C -- Yes --> D[Parse cached JSON]
    D --> Z[Return project list]
    C -- No --> E[Query MongoDB by owner]
    E --> F[Sort by updatedAt descending]
    F --> G[Store result in Redis]
    G --> Z
~~~

When a project is created, or its starred status is toggled, the controller attempts to invalidate the relevant cache keys. The next request then reloads data from MongoDB.

Three different state layers have different purposes:

| Layer | Holds | Lifetime / purpose |
|---|---|---|
| MongoDB | Project records | Persistent storage |
| Redis | Cached project lists and sessions | Shared server-side, fast lookup |
| Redux | Current frontend user and projects | UI state for the browser session |
| React component state | Modal, loading flags, selected views | Local interface behaviour |

### 6.3 Open a project workspace

The Dashboard project card navigates to `/project/:id`. The workspace route is declared in `frontend/src/App.jsx`.

On mount, `ProjectPage.jsx` reads the ID with `useParams()`, fetches project metadata, and loads the file tree. It stores project metadata in Redux and the nested file tree in local React state. It also manages editor tabs and visibility of the explorer, preview, terminal, and AI chat.

**Implementation note:** `getProjectById()` currently looks up the project by ID and updates `lastOpenedAt`, but it does not scope the lookup to the authenticated owner. Resource ownership must be enforced on the backend, not assumed from the dashboard UI.

---

## 7. File explorer and editor workflow

### 7.1 Data model: files and folders share a collection

The File model stores both files and folders in the same MongoDB collection. The `type` field is either `file` or `folder`.

| Field | Meaning |
|---|---|
| `owner` | User who owns the document |
| `projectId` | Project to which it belongs |
| `parentId` | Parent folder ID; `null` marks a root |
| `name` | File or folder name |
| `type` | `file` or `folder` |
| `content` | Stored text/source content |
| `language` / `extension` | Editor/file metadata |
| `size` | Stored character count in current implementation |
| `isDeleted` | Soft-deletion flag |

A child stores a reference to its parent rather than embedding an entire folder tree inside one MongoDB document. This makes individual items easier to create and update.

### 7.2 Build a nested tree

MongoDB returns matching file documents as a flat array. The helper `backend/services/file/utils/buildTree.js` converts them into a nested tree:

~~~mermaid
flowchart TD
    A[Fetch user's active files for project] --> B[Create map keyed by document ID]
    B --> C[Initialize children array for each node]
    C --> D[Second pass through documents]
    D --> E{Does parentId exist?}
    E -- Yes --> F[Append node to parent's children]
    E -- No --> G[Add node to root array]
    F --> H[Return nested tree]
    G --> H
~~~

With average constant-time map lookups, this takes **O(n) time** and **O(n) additional space** for (n) documents. The frontend recursively renders nodes using `Explorer.jsx` and `Folder.jsx`.

### 7.3 File-operation endpoints

| Operation | Endpoint |
|---|---|
| Create root folder | `POST /api/file/create-root-folder` |
| Create folder | `POST /api/file/create-folder` |
| Create file | `POST /api/file/create-file` |
| Update / rename file | `POST /api/file/update/:id` |
| Retrieve file | `GET /api/file/:id` |
| Retrieve project tree | `GET /api/file/tree/:projectId` |
| Delete entry | `DELETE /api/file/:id` |

The file controller filters tree, read, and update operations using user ownership and active/deleted status in the relevant queries. However, the delete handler currently uses an ID-only update without applying the same owner predicate.

### 7.4 Edit and save code

~~~mermaid
sequenceDiagram
    actor User
    participant Explorer as Folder.jsx / Explorer.jsx
    participant Page as ProjectPage.jsx
    participant Editor as Editor.jsx + Monaco
    participant API as File API
    participant Mongo as MongoDB

    User->>Explorer: Click file
    Explorer->>Page: openFile(file)
    Page->>Editor: activeTab and openTabs
    Editor->>Editor: Set local code state from activeTab.content
    User->>Editor: Edit text
    Editor->>Editor: Monaco onChange updates code
    User->>Editor: Click Save
    Editor->>API: updateFile(id, name, content)
    API->>Mongo: Update file document
    Mongo-->>Editor: Saved document response
    Editor->>Editor: Update tab state and show saved state
~~~

Monaco provides the editing experience; application state and API calls provide persistence. The code is manually saved using a Save control rather than a full autosave system.

**Implementation note:** the frontend file API helpers catch errors and return `null`. The editor save handler does not inspect the returned value before marking the file as saved. A production-ready implementation should distinguish a confirmed save from a failed request and protect unsaved edits when switching tabs.

---

## 8. AI agent and tool-execution workflow

This is Vector-IDE's key differentiating workflow.

### 8.1 AI request path

The frontend sends `projectId`, the current `message`, and conversation `history` to `POST /api/ai/chat`. The gateway protects the route and passes the authenticated user ID to the AI service in the `x-user-id` header.

The main implementation files are:

- `frontend/src/components/AiChat.jsx`
- `backend/services/ai/controllers/ai.controller.js`
- `backend/services/ai/graph/graph.js`
- `backend/services/ai/graph/tools.js`
- `backend/services/ai/utils/fetchFileAPIs.js`
- `backend/services/ai/utils/llm.js`

### 8.2 Graph architecture

~~~mermaid
flowchart TD
    Start([Start]) --> Agent[Agent node: build prompt + invoke LLM]
    Agent --> Decision{Last AI message has tool calls?}
    Decision -- Yes --> Tools[ToolNode executes requested tool]
    Tools --> Result[Tool results added to message state]
    Result --> Agent
    Decision -- No --> End([End])
~~~

In `graph.js`, the graph uses LangGraph's `StateGraph`, `MessagesAnnotation`, and prebuilt `ToolNode`. The agent node creates a message list with a system prompt and selected recent history, then invokes the model bound to tools. A conditional edge checks whether the latest AI message contains tool calls; if yes, execution routes to the tools node. After the tool result, the graph returns to the agent.

This loop is necessary because the task may need multiple dependent actions: inspect the file tree, read existing files, create folders, create files, and then summarize.

### 8.3 Configured model

`backend/services/ai/utils/llm.js` configures `ChatOpenRouter` with the model identifier `deepseek/deepseek-chat`, temperature `0`, and a maximum token setting of `1024`.

Temperature zero reduces sampling variation but does not guarantee identical results. The provider credentials must be available only in the backend environment.

### 8.4 Defined file tools

The current `fileTools()` factory exposes six tools:

| Tool | What the agent uses it for |
|---|---|
| `get_tree` | Discover project structure and real document IDs |
| `get_file` | Read an existing file before modifying it |
| `create_folder` | Create a folder under a parent folder |
| `create_file` | Create a file with supplied content and language |
| `update_file` | Replace content / update the name of an existing file |
| `delete_file` | Request a file deletion |

Zod schemas describe the arguments expected by the tools. The tools call helper functions in `fetchFileAPIs.js`, which use Axios to call the file service and send the user ID in the `x-user-id` header.

The system prompt instructs the agent to inspect the tree before acting, use exact IDs, read existing files before updating them, create folders before files, and avoid duplicates or repeated reads. These instructions guide the model but are **not** a substitute for backend authorization.

### 8.5 Example: “Build a portfolio website”

~~~mermaid
sequenceDiagram
    actor User
    participant Chat as AiChat.jsx
    participant Controller as AI controller
    participant Graph as LangGraph
    participant LLM as OpenRouter / DeepSeek
    participant Tools as File tools
    participant FileAPI as File service
    participant DB as MongoDB

    User->>Chat: Ask for a portfolio website
    Chat->>Controller: POST /api/ai/chat + history
    Controller->>Graph: Project ID + user ID + messages
    Graph->>LLM: System prompt + messages + bound tools
    LLM-->>Graph: Request get_tree
    Graph->>Tools: Execute get_tree
    Tools->>FileAPI: GET project tree
    FileAPI->>DB: Query active files
    DB-->>FileAPI: File documents
    FileAPI-->>Tools: Nested tree
    Tools-->>Graph: Tool result
    Graph->>LLM: Tool result + conversation state
    LLM-->>Graph: File creation/update tool calls
    Graph->>Tools: Execute selected operations
    Tools->>FileAPI: Create/update files
    FileAPI->>DB: Persist changes
    DB-->>FileAPI: Result
    FileAPI-->>Tools: Operation details
    Tools-->>Graph: Tool results
    Graph->>LLM: Updated state for final response
    LLM-->>Graph: Final assistant message
    Graph-->>Controller: Stream graph updates
    Controller-->>Chat: SSE progress and result events
    Chat->>Chat: Refresh file tree and display events
~~~

This diagram shows the intended orchestration. The exact tool calls depend on the user's request and the model's decisions; it should not be described as a fixed, deterministic list of operations.

### 8.6 Conversation history and execution limits

The AI controller's `buildHistory()` accepts user/assistant entries and keeps at most the most recent six entries supplied by the frontend, then adds the latest prompt. The graph also has a helper that limits the messages supplied to each model invocation. The graph stream is configured with a recursion limit of 40.

The chat messages are currently held in the React component's state. A durable conversation-history database model is not evident in the inspected flow, so don't claim conversations persist across sessions.

---

## 9. AI streaming with Server-Sent Events

The AI controller sets the response content type to `text/event-stream`, disables normal cache buffering, and writes named events. Instead of waiting for a single JSON response, the frontend reads chunks from the response body and parses events separated by blank lines.

### 9.1 Stream event path

~~~mermaid
flowchart LR
    Graph[LangGraph node updates] --> Controller[AI controller]
    Controller --> Event{Event type}
    Event -->|start / tool_start| Progress[Progress UI]
    Event -->|file_created / file_updated / folder_created / file_deleted| Badge[Operation badge]
    Event -->|message| Assistant[Assistant message]
    Event -->|done| Finished[Finish stream]
    Event -->|error| Error[Show failure]
    Badge --> Refresh[Reload project tree]
    Assistant --> Refresh
~~~

The controller sends events through a helper that writes both the event name and a JSON payload. Relevant event types include:

- `start` — the AI request has started.
- `tool_start` — the model requested a tool, with tool name and arguments.
- `file_created`, `folder_created`, `file_updated`, `file_deleted` — operation results.
- `message` — assistant text.
- `done` — the stream completed.
- `error` — failure after streaming has begun.

### 9.2 How the browser reads the stream

`AiChat.jsx` uses `fetch()`, obtains a reader with `response.body.getReader()`, decodes bytes with `TextDecoder`, buffers partial chunks, and splits complete events at `\n\n`. This buffering matters because a network chunk may contain part of an event or several events together.

**SSE versus WebSocket:**

- SSE is suited to server-to-client updates over an HTTP response, such as AI progress.
- WebSockets are suited to bidirectional terminal input/output, where the browser sends commands and receives output.

**Implementation note:** the backend uses LangGraph's `streamMode: "updates"` and invokes the model inside the agent node. The code streams graph updates; it is not necessarily token-by-token model streaming.

### 9.3 Credits in the AI flow

The AI controller calls `deductCredits({ userId, amount: 10 })`. That helper makes an HTTP request to the auth service. However, the helper catches errors and returns `null`, and the caller does not check the outcome before continuing.

For robust billing, credit reservation/deduction should be checked before expensive execution, with idempotency and failure/refund handling designed explicitly. An AI request should not be represented as paid or authorized merely because the helper returned without throwing.

---

## 10. Terminal and preview workflow

### 10.1 Browser terminal

The terminal UI uses xterm.js. The terminal service uses Socket.IO and `node-pty` to launch a shell process.

~~~mermaid
sequenceDiagram
    participant UI as Terminal.jsx / xterm.js
    participant Socket as Socket.IO
    participant Terminal as Terminal service
    participant File as File service
    participant DB as MongoDB
    participant PTY as PowerShell or Bash

    UI->>Socket: Connect to configured terminal URL
    UI->>Socket: terminal:init { projectId, userId, rows, cols }
    Socket->>Terminal: Initialize terminal session
    Terminal->>File: GET /tree/:projectId with x-user-id
    File->>DB: Fetch active project files
    DB-->>File: File tree and contents
    File-->>Terminal: Tree response
    Terminal->>Terminal: Sync files into temporary workspace
    Terminal->>PTY: Spawn shell with workspace as cwd
    Terminal-->>UI: terminal:ready
    UI->>Terminal: terminal:write
    Terminal->>PTY: Write user input
    PTY-->>Terminal: Process output
    Terminal-->>UI: terminal:data
    UI->>Terminal: terminal:resize
    Terminal->>PTY: Resize pseudo-terminal
~~~

The terminal service constructs a workspace under the operating system's temporary directory, using the project ID as a subdirectory. Before starting the shell, it fetches the project tree from the file service and writes its files and folders to disk. On Windows it selects PowerShell; otherwise it selects Bash. It maintains a session map keyed by the Socket.IO connection ID and kills the pseudo-terminal process when that connection disconnects.

**Important distinction:** the terminal runs against a temporary disk workspace. In the inspected implementation, terminal commands do not automatically write changed files back into the MongoDB-backed file tree. The initial synchronization is from the stored tree to the terminal workspace.

**Security note:** the terminal accepts `projectId` and `userId` in the client-emitted `terminal:init` event, and the gateway's WebSocket proxy path does not apply the HTTP `protect` middleware. This is a significant security boundary to harden: authenticate the socket/session on the server, derive identity from verified state rather than trusting client-provided IDs, authorize project ownership, and run shell processes in a real isolation boundary before treating the feature as production-safe.

### 10.2 Preview

The current `Preview.jsx` traverses the tree to locate `index.html`, a CSS file, and a JavaScript file. It embeds CSS and JS into an HTML document and renders that through an iframe's `srcDoc`. The iframe uses a sandbox that permits scripts, forms, and modals.

This is a lightweight browser preview, not a complete build service. The inspected code does not run Vite, resolve npm dependencies, or compile arbitrary React/JSX in this component. The agent's system prompt describes intended support for React + Vite and plain HTML/CSS/JavaScript, but the current preview implementation itself assembles HTML/CSS/JS.

---

## 11. Plans, payments, and credits

The frontend's plan/payment helper calls the gateway endpoints:

- `POST /api/payment/create`
- `POST /api/payment/verify`

The payment service uses Razorpay to create an order. The current controller defines these plans:

| Plan key | Display name | Amount in code | Credits |
|---|---|---:|---:|
| `pro` | Pro | ₹299 (29,900 paise) | 500 |
| `team` | Team | ₹799 (79,900 paise) | 2,000 |

### 11.1 Payment sequence

~~~mermaid
sequenceDiagram
    actor User
    participant UI as Plan page / payment helper
    participant Gateway as API Gateway
    participant Payment as Payment service
    participant Razorpay as Razorpay API
    participant DB as MongoDB
    participant Auth as Auth service

    User->>UI: Select plan
    UI->>Gateway: POST /api/payment/create
    Gateway->>Payment: Authenticated request + x-user-id
    Payment->>Razorpay: Create order with plan amount
    Razorpay-->>Payment: Order ID / amount / currency
    Payment->>DB: Save payment status=created
    Payment-->>UI: Order details + public key ID
    UI->>Razorpay: Complete checkout
    Razorpay-->>UI: Order ID, payment ID, signature
    UI->>Gateway: POST /api/payment/verify
    Gateway->>Payment: Authenticated verification request
    Payment->>Payment: Recompute HMAC-SHA256 signature
    Payment->>DB: Mark payment paid if signature matches
    Payment->>Auth: Add plan credits
    Auth->>DB: Update user credits
    Payment-->>UI: Payment verification response
~~~

The payment controller creates the order with notes containing the user ID and plan, and records a payment document with order ID, amount, currency, plan, credits and initial status. During verification, it computes an HMAC-SHA256 signature from the order ID and payment ID using the Razorpay key secret. If verification passes, it updates the payment document and calls the auth service to add credits.

### 11.2 Billing and consistency caveats

The current code checks for an already-paid record, but a production flow should additionally:

- Verify that the payment document belongs to the authenticated user making the verification request.
- Confirm the expected order, amount, currency and plan from server-side records.
- Make credit granting idempotent and safe against simultaneous verification requests.
- Use reliable payment-state transitions and persist errors/reconciliation results.
- Avoid logging payment signatures or other sensitive verification material.

The credit update endpoint is an internal service call in the current code. It should not be assumed safe merely because it is called from another backend service; service-to-service authorization and network restrictions are important.

---

## 12. Data models and caching

### 12.1 Logical data model

~~~mermaid
erDiagram
    USER ||--o{ PROJECT : owns
    USER ||--o{ FILE : owns
    PROJECT ||--o{ FILE : contains
    FILE o|--o{ FILE : parent_of
    USER ||--o{ PAYMENT : purchases

    USER {
        ObjectId _id
        string firebaseUid
        string email
        string name
        number credits
    }
    PROJECT {
        ObjectId _id
        ObjectId owner
        string name
        string description
        boolean starred
        date lastOpenedAt
    }
    FILE {
        ObjectId _id
        ObjectId owner
        ObjectId projectId
        ObjectId parentId
        string name
        string type
        string content
        boolean isDeleted
    }
    PAYMENT {
        ObjectId _id
        ObjectId userId
        string plan
        number amount
        string razorpayOrderId
        string status
    }
~~~

This is a **logical overview**, not a guarantee that MongoDB enforces every relationship as a relational database would. Ownership and reference constraints must be implemented through application logic and indexes.

### 12.2 Cache keys in the current project service

| Redis key pattern | Purpose |
|---|---|
| `session-{sessionId}` | Session lookup for protected HTTP requests |
| `user-session-{userId}` | Maps a user to the most recently created session ID in this implementation |
| `projects-{userId}` | Caches the user's project list |
| `starred-projects-{userId}` | Caches the user's starred project list |

The project list cache is invalidated by selected mutations. The shown project cache calls do not set a TTL, so correct invalidation becomes important for freshness.

**Trade-off:** caching can reduce database reads and latency, but introduces cache invalidation and stale-data risks. Redis availability also matters because the current gateway session middleware depends on Redis for protected HTTP access.

---

## 13. Security boundaries and engineering trade-offs

This section is especially useful for technical interviews. It distinguishes useful architectural choices from areas requiring further hardening.

| Area | Current implementation / risk | Recommended engineering direction |
|---|---|---|
| Identity | Firebase ID token is verified at login; a Redis-backed app session is then issued | Keep service-account keys private; support session invalidation and consistent logout |
| HTTP authorization | Gateway protects configured HTTP routes and propagates `x-user-id` | Enforce ownership in every read, update, delete and project lookup |
| Project endpoints | Project-by-ID and some mutation paths are not consistently owner-scoped | Use owner-scoped query filters and explicit access checks |
| File deletion | Delete controller performs ID-only soft-delete update | Scope the mutation by owner and active status; authorize the containing project |
| AI tools | System prompt guides model behaviour; tool schemas validate arguments | Treat prompts as guidance only; validate permissions, IDs, paths and operation limits on the server |
| Terminal | Socket initialization accepts client-supplied user/project IDs; socket proxy is separate from protected HTTP middleware | Authenticate sockets, derive the identity server-side, enforce project ownership, isolate shells and limit resources |
| Preview | Sandboxed iframe is used for assembled HTML/JS | Keep sandboxing restrictive; treat generated project code as untrusted |
| Credits | AI deduction helper suppresses errors; payment verification/crediting require robust idempotency | Check credit operations, reserve usage, use idempotent records and reconcile failures |
| Secrets | Services rely on environment variables and Firebase service-account configuration | Keep secrets out of Git and browser bundles; rotate any exposed keys |
| CORS | Gateway configures an allowed frontend origin and credentials | Use exact trusted origins; remember CORS is not authorization |
| Service-to-service requests | Internal HTTP helpers forward user ID headers | Restrict internal network access and authenticate service requests; never trust a user-ID header from an untrusted caller |

### Other implementation observations

- The project controller's toggle-star handler currently attempts to return an undefined `projects` variable. The database update may occur before the endpoint fails.
- The project deletion handler references `userId` without defining it in that function and deletes by ID without checking ownership.
- File update logic calculates a replacement extension on rename but does not assign the calculated value back to the document.
- The editor can show a successful-save indicator even when the API helper returned `null`.
- Project creation and root-folder initialization are separate requests, so partial completion must be handled.
- The terminal's initial disk synchronization is not a complete bidirectional sync with the persisted file service.

When discussing these, be precise: these are implementation weaknesses in the current code that should be fixed before production hardening. A good engineering answer explains the risk, its cause, and the fix without claiming the code already handles it.

---

## 14. Configuration and local services

The code reads configuration from environment variables. Exact values should be set in local environment files or a secure deployment secret store; do not commit real secrets to source control.

| Variable / setting | Used for |
|---|---|
| `VITE_SERVER_URL` | Frontend API base URL |
| `VITE_TERMINAL_SERVICE_URL` | Socket.IO terminal endpoint |
| `FRONTEND_URL` | Gateway's allowed frontend origin |
| `PORT` | Service port override |
| `AUTH_SERVICE` | Gateway auth-service target and AI credit helper's auth target |
| `PROJECT_SERVICE` | Gateway project-service target |
| `FILE_SERVICE` / `FILE_SERVICE_URL` | Gateway / internal file-service target |
| `AI_SERVICE` | Gateway AI-service target |
| `TERMINAL_SERVICE` | Gateway terminal-service target |
| `PAYMENT_SERVICE` | Gateway payment-service target |
| `MONGODB_URI` | MongoDB connection string used by service DB configs |
| `REDIS_URL` | Redis connection used by shared Redis client |
| `RAZORPAY_KEY_ID` | Razorpay public key identifier returned for checkout |
| `RAZORPAY_KEY_SECRET` | Backend payment-signature verification secret |
| Firebase service account JSON | Firebase Admin credentials imported by the auth service |
| OpenRouter credentials | Backend model provider authentication |

The supplied `backend/docker-compose.yml` starts Redis and exposes port 6379. It does not, by itself, orchestrate every Node.js service or the frontend. The individual services each have their own package configuration and entry point.

Do not infer that the app is hosted just because the source repository is on GitHub. Hosting requires running the frontend and backend services and providing the required database, Redis, Firebase, model-provider and payment configuration.

---

## 15. Interview walkthroughs

### 15.1 “Explain the project in 90 seconds”

> Vector-IDE is a browser-based AI development environment built with React and Vite. The frontend contains a dashboard, project workspace, Monaco-based editor, file explorer, AI chat, terminal and preview. The backend is organized into Express services behind an API gateway.
>
> Authentication uses Firebase Google sign-in. The backend verifies the Firebase ID token, keeps the user's application profile in MongoDB, creates a Redis-backed session, and returns an HTTP-only cookie for subsequent requests. The gateway checks that session and propagates the user ID to downstream services.
>
> Projects are stored in MongoDB and project lists are cached in Redis. Files and folders share a MongoDB model linked by parent IDs, and the file service converts the flat records into a nested tree for the Explorer.
>
> The AI feature is the core differentiator: a LangGraph agent uses a configured OpenRouter model and a set of file-operation tools. The tools call the file service to inspect or modify the actual project. The AI controller streams progress and results to the frontend using SSE. A separate terminal service uses Socket.IO and node-pty, while the payment service integrates Razorpay for purchased credits.
>
> The main engineering challenges are coordinating multiple services, protecting resource ownership, handling partial failures, and ensuring AI execution, terminal access, and credit operations are reliable and secure.

### 15.2 “Walk me through what happens when the AI creates a file”

1. The user submits a prompt in `AiChat.jsx`.
2. The browser sends the project ID, prompt, and history to `POST /api/ai/chat`.
3. The gateway validates the session and forwards the authenticated user ID to the AI service.
4. The AI controller validates the input and starts an SSE response.
5. LangGraph invokes the model with the system instructions and available tools.
6. The model requests a tool such as `get_tree` or `create_file`.
7. LangGraph's ToolNode executes the tool, which calls the file service over HTTP.
8. The file service validates the request and persists the mutation in MongoDB.
9. Tool results go back into the graph; the agent continues or produces a final response.
10. The controller sends operation/message events over SSE. The frontend displays progress and refreshes the file tree.

### 15.3 “What would you improve first?”

Prioritize correctness and security ahead of cosmetic features:

1. Enforce project/file ownership on every resource operation, including get-by-ID, delete, and star changes.
2. Authenticate terminal sockets independently and isolate shell execution from the host.
3. Make payment verification and credit granting user-bound, atomic, and idempotent.
4. Make AI credit deduction reliable and report save/tool failures correctly.
5. Handle partial project initialization and add robust frontend error/loading states.
6. Add integration tests for authentication, ownership, file CRUD, AI tool execution, terminal authorization, and payment reconciliation.

### 15.4 More practice questions

- Why use a gateway and multiple services rather than one Express application?
- What is the difference between a Firebase ID token and the app's session ID?
- Why use Redis as well as MongoDB and Redux?
- How is a nested file tree built, and what is its time complexity?
- Why use LangGraph rather than only one model call?
- What is the difference between tool calling and arbitrary shell execution?
- Why is SSE suitable for AI updates while Socket.IO is suitable for a terminal?
- What happens if the browser disconnects during AI execution?
- How can payment verification avoid granting credits twice?
- What must be checked before reading a project by its ID?
- What does the current terminal sync to disk, and does it sync changes back automatically?
- What parts of the system are implemented, and which require more production hardening?

---

## 16. Repository checklist and glossary

### Quick code-navigation checklist

- [ ] Can I explain the complete sign-in/session sequence?
- [ ] Can I trace one protected request through the gateway and a downstream service?
- [ ] Can I explain the project creation sequence and its partial-failure case?
- [ ] Can I explain the parent-ID data model and `buildTree()` algorithm?
- [ ] Can I distinguish local editor state, Redux state, MongoDB persistence, and Redis cache?
- [ ] Can I draw the LangGraph agent/tool loop from memory?
- [ ] Can I explain how file tools call the file service?
- [ ] Can I explain SSE event parsing in the browser?
- [ ] Can I describe how the terminal copies stored project content to a temporary workspace?
- [ ] Can I explain Razorpay order creation, signature verification, and credit granting?
- [ ] Can I identify the most important authorization and reliability gaps honestly?

### Glossary

| Term | Simple definition |
|---|---|
| API Gateway | Entry point that routes requests to backend services and applies shared request handling |
| Authentication | Verifying a user's identity |
| Authorization | Checking whether the user may perform an operation on a resource |
| Session | Server-managed state identifying a logged-in browser/client |
| Cache-aside | Read cache first; if missing, read the database and populate the cache |
| Parent reference | A record stores the ID of its parent, rather than embedding the full hierarchy |
| Soft delete | Mark a record deleted without immediately removing it from the database |
| LLM | A language model that interprets prompts and generates responses or structured tool requests |
| Tool calling | The model requests application-defined functions with structured arguments |
| LangGraph | Framework for building stateful agent workflows as graph nodes and transitions |
| ToolNode | LangGraph node that executes requested tools |
| SSE | Server-to-client streaming over an HTTP response |
| WebSocket | Persistent, bidirectional communication between client and server |
| Pseudo-terminal (PTY) | A process interface that behaves like a terminal for an interactive shell |
| Idempotency | Repeating an operation does not accidentally apply its effect multiple times |
| Ownership check | Server-side validation that the authenticated user owns or may access a resource |

---

<div align="center">

**The central workflow to remember**

**Authenticate → Route → Load project → Read/write files → Use AI tools → Stream progress → Run/preview → Account for usage**

</div>

This document reflects the currently inspected repository structure and code paths. When explaining Vector-IDE in an interview, distinguish what the implementation currently does from the improvements recommended in Section 13.

