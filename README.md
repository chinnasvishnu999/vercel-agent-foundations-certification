# Ship It Shop — Store Agents

Two AI agents for the Ship It Shop storefront (Vercel Swag Store API), built for the Vercel Agent Foundations certification:

- **Shopping agent** for customers. It lives in the storefront's side panel, finds products, shows them as interactive cards and files returns through a durable workflow.
- **Store admin agent** for employees at `/admin`. It answers questions about support, returns, inventory and sales. It runs calculations in a persistent **Vercel Sandbox** and keeps a **memory file** in that sandbox.

**Live:** https://vercel-agent-foundations-certificat-ruddy-rho.vercel.app · admin: [`/admin`](https://vercel-agent-foundations-certificat-ruddy-rho.vercel.app/admin) (use the admin password from the assignment brief)

## Try it

**Shopping agent.** Open the site and click the agent button in the header.

| Ask | What you should see |
| --- | --- |
| "Show me hats" | Product cards with images, prices and links. |
| "Tell me about the Black Beanie" | A detail card with live stock and an **Add to cart** button that updates the header cart. |
| "Tell me about product unicorn_999" | "No product matches that request." The agent doesn't invent one. |
| "I want to return order 11111, the hoodie and desk mat, they don't fit" | A return card within a few seconds. The store's decision arrives about 15–60 s later and the card updates itself. Demo orders 11111, 22222 and 33333 can be returned; 44444 and 55555 can't, and the agent explains why. |
| Refresh the page while an answer is streaming | The answer continues from where it stopped, with no duplicate message and no second request to the model. |

**Admin agent.** Sign in at `/admin`; the suggestion buttons cover the main cases.

| Ask | What you should see |
| --- | --- |
| "Summarize this week's revenue" | Totals from `getSalesAnalytics` with the exact date range. |
| "Which products had the highest return rates in the last 30 days?" | A **Vercel Sandbox** block (Running… → Done in 0.1 s) with the Python command and its output, then a ranked answer (e.g. Black Click Pen 6/59 = 10.2%). |
| "Which low-stock products sold the most this month?" | Inventory and sales joined in the sandbox. |
| "Run cat data/nope.json in the sandbox." | The block shows **Failed (exit 1)** with stderr, and the agent explains the failure. |
| "Remember that our fiscal week runs Sunday to Saturday." then **New chat** and "When does our fiscal week start?" | A **Saved to memory** chip, and the new conversation knows the answer. |
| "Restock the Black Pullover Hoodie with 50 units." | A refusal: the store data is read-only. |

## Requirements → implementation

| Requirement | Where |
| --- | --- |
| Shopping tools `searchProducts`, `getAllCategories`, `getProductDetails`, `returnOrder` | `lib/tools.ts` |
| Generative UI (product cards, detail card, return card, tool states) | `components/shopping/*`, `components/agent-chat.tsx` |
| Durable chat + reconnect after refresh | `lib/workflows/chat-flow.ts`, `app/api/chat/route.ts`, `app/api/chat/[id]/stream/route.ts`, `components/chat/durable-chat.ts` |
| Durable return flow (lookup → notify → preauthorize refund → file return → wait for the store's webhook, with a polling fallback) | `lib/workflows/return-flow.ts`, `app/api/returns/[id]/route.ts` |
| Admin tools `getSupportTickets`, `getReturnsHistory`, `getInventoryStock` (paginated), `getSalesAnalytics` + catalog tools, read-only | `lib/admin-tools.ts` |
| Admin agent only for signed-in admins | `proxy.ts` (redirect) + `lib/admin-guard.ts` (401 in the API route) |
| Durable admin chat + reconnect | `lib/workflows/admin-chat-flow.ts`, `app/admin/api/chat/**` |
| Vercel Sandbox bash tool (admin-only) with running / done / failed UI | `lib/admin-sandbox.ts`, `bash` in `lib/admin-tools.ts`, `components/admin/sandbox-command.tsx` |
| Persistent memory file in the same sandbox, read by app code at the start of each conversation, appended by the agent, empty memory handled | `readMemory` / `appendMemory` in `lib/admin-sandbox.ts`, `readAdminMemoryStep` in `lib/workflows/admin-chat-flow.ts`, `saveMemory` in `lib/admin-tools.ts` |
| AI Elements UI, responsive and accessible | `components/ai-elements/*`, both chat components (tested at 390 px and 1280 px) |
| AI Gateway | model strings such as `openai/gpt-4.1-mini` in `lib/agent.ts` and `lib/admin-agent.ts` |
| Validated inputs | zod schemas on every tool and route body |
| Secrets never exposed | `BYPASS_SECRET` and the admin password are used only on the server; tool results never include them; memory rejects secret-like notes |

## Architecture

```
Browser ── useChat + WorkflowChatTransport ──► POST /api/chat ──► start(shoppingChatFlow)
   ▲  (x-workflow-run-id saved in sessionStorage)                    │ WorkflowAgent: each model call
   └── after a refresh: GET /api/chat/{runId}/stream?startIndex ◄────┘ and tool call is a durable step

returnOrder tool ──► start(returnOrderFlow) ── steps ──► Store API ── webhook ──► resumes the run

/admin (cookie gate) ──► POST /admin/api/chat ──► start(adminChatFlow)
                                                    ├─ step: read memory/MEMORY.md from the sandbox
                                                    ├─ back-office tools ─► save data/<chat>/*.json in the sandbox
                                                    ├─ bash tool ─► run jq / python3 / node in the sandbox
                                                    └─ saveMemory ─► append to memory/MEMORY.md
```

### Implementation decisions

- **Durability.** Both chats use `WorkflowAgent` from `@ai-sdk/workflow`: every model call and tool `execute` is a Workflow step. Transient Store API errors are thrown so the step retries; 400/404/422 responses come back to the model as a status it can explain. Output goes to the run's durable stream. The client saves the run id and replays the stream from `startIndex` after a refresh, so work is never repeated.
- **Returns.** The return flow is its own workflow, so the chat answers right away and the decision arrives later. The Store API's callback goes to a Workflow webhook. Preview deployments sit behind deployment protection, which would block that callback, so there the flow also polls (90 s wait, then every 30 s, up to 8 times).
- **Sandbox.** There is one named, persistent sandbox per environment (`ship-shop-admin-<VERCEL_ENV>`), created on first use with `Sandbox.getOrCreate`. Network access is denied (`deny-all`): commands only work on files the app wrote. Each back-office tool writes its full result to `data/<conversation>/<dataset>.json` and tells the agent the path, row count and field names. Each conversation gets its own folder, so simultaneous admins can't overwrite each other's data; folders older than a day are removed. Commands have a 60 s limit and output is capped at 12,000 characters. A failed command is a normal result the agent reads and fixes; a sandbox outage throws, so the step retries.
- **No arithmetic in the model.** The admin instructions require all counting, joins and rankings to run in the sandbox. They also define the return rate (units in all return requests ÷ units sold in the same range) and require a sanity check before answering. Results were checked against an independent calculation from the Store API.
- **Memory.** `memory/MEMORY.md` lives in the same sandbox. App code (not the agent) reads it in a workflow step at the start of every admin conversation and puts it in the instructions; "(nothing saved yet)" covers the empty case. If the sandbox is unavailable, the chat continues with a note. The agent appends dated preference, correction or business-context lines; notes that look like credentials are rejected on the server.
- **Admin isolation.** The admin API lives under `/admin/api/*` because the admin cookie is scoped to `/admin` and `proxy.ts` guards that path; the route checks the cookie again. Admin tools are never given to the shopping agent, and each stream-replay endpoint only replays runs of its own workflow.
- **Models.** Shopping uses `openai/gpt-4.1-mini` (fast and reliable with tools in testing; a smaller model invented prices). Admin uses `openai/gpt-4.1` for multi-step reasoning. Both can be changed with env vars.

## Setup

Prerequisites: Node.js 22+, pnpm, the Vercel CLI and a Vercel project created from the assignment's template (so `BYPASS_SECRET` and `API_BASE_URL` are set).

```bash
pnpm install
vercel link                  # pick your team and the project
vercel env pull .env.local   # BYPASS_SECRET, API_BASE_URL, VERCEL_OIDC_TOKEN
pnpm dev                     # http://localhost:3000
```

Without the Vercel CLI, copy `.env.example` to `.env.local` and fill it in. Locally, the OIDC token authenticates both AI Gateway and Vercel Sandbox; it expires after 12 hours, so run `vercel env pull` again when calls start failing. On Vercel, OIDC is automatic. Deploy by pushing to the connected Git repository (or `vercel --prod`); no extra configuration is needed.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `BYPASS_SECRET` | Yes | Deployment-protection bypass secret for the Store API, sent from the server as `x-vercel-protection-bypass`. Server-only; never prefix with `NEXT_PUBLIC_`. |
| `API_BASE_URL` | Yes | Store API base URL, ending in `/api`. Set by the template. |
| `VERCEL_OIDC_TOKEN` | Locally | Written by `vercel env pull`. Authenticates AI Gateway and Vercel Sandbox locally (expires after 12 h). Automatic on Vercel. |
| `AI_GATEWAY_API_KEY` | No | AI Gateway API key, used instead of OIDC for model calls when set. |
| `SHOPPING_AGENT_MODEL` | No | AI Gateway model for the shopping agent (must support tools). Default `openai/gpt-4.1-mini`. |
| `ADMIN_AGENT_MODEL` | No | AI Gateway model for the admin agent (must support tools). Default `openai/gpt-4.1`. |
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL for metadata. Default `http://localhost:3000`. |

The app also reads Vercel's system variables `VERCEL_ENV` (which sandbox to use), and `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` (the return webhook URL). Vercel sets these automatically.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build / serve it |
| `pnpm lint` | ESLint |
| `pnpm type-check` | `tsc --noEmit` |

## Project structure

```
app/
  (store)/                     storefront: home, search, product pages
  api/chat/route.ts            shopping chat: starts a workflow run
  api/chat/[id]/stream/        replays a shopping run (refresh / reconnect)
  api/returns/[id]/            status of a return workflow run
  admin/                       /admin page + /admin/login
  admin/api/chat/              admin chat route + its replay endpoint
lib/
  agent.ts, tools.ts           shopping agent and tools
  admin-agent.ts               admin agent and instructions
  admin-tools.ts               back-office, bash and saveMemory tools
  admin-sandbox.ts             Vercel Sandbox: datasets, commands, memory file
  workflows/                   chat-flow, admin-chat-flow, return-flow
  api.ts                       typed Store API client (server-only)
components/
  agent-chat.tsx, shopping/    shopping chat UI and generative UI cards
  admin-agent-chat.tsx, admin/ admin chat UI, tool results, sandbox block
  chat/durable-chat.ts         useChat + WorkflowChatTransport + refresh resume
  ai-elements/                 AI Elements components
```

## Testing

There is no unit-test framework. Each change was verified with `pnpm type-check`, `pnpm lint` and `pnpm build`, plus end-to-end checks against a local server, the Vercel preview and production:

- Playwright runs in Chromium (1280 px) and WebKit (390 px): product cards, add to cart, not-found, return card, refresh mid-answer (1 POST, 1 resume, no duplicates), admin sign-in, sandbox Running / Done / Failed states, memory chip, no horizontal overflow, no console errors.
- Admin answers compared with numbers computed directly from the Store API: return rates, low-stock top sellers, returns by decision, revenue by category, ticket categories, open urgent tickets, out-of-stock products.
- Concurrent admin conversations each used their own sandbox folder and got correct results.
- Durability: a simulated Store API outage was retried, and a failure injected mid-return didn't repeat completed steps.
- No secrets in streamed answers (including a prompt-injection attempt) or in the client JavaScript.

## Known limitations

- The admin login is the template's demo gate: a fixed password, with the cookie value equal to the password. Production would need real authentication.
- Sandbox datasets are a snapshot from the agent's last fetch in that conversation; the agent fetches again for new questions or ranges.
- Returns on preview deployments get their decision by polling (deployment protection blocks the webhook); production uses the webhook.
