# Ship It Shop — Vercel Agent Foundations Certification

A Next.js e-commerce app used as the hands-on project for the Vercel Agent Foundations Certification. The storefront brand is **Ship It Shop**; the backend it talks to is the Vercel Swag Store API.

The repo has two layers:

1. **A working storefront** — products, search, product pages, cart, promotions, and categories, backed by the live Vercel Swag Store API. There is no local product or cart database; reads happen in Server Components and mutations go through Server Actions, so the deployment-protection secret never reaches the client.
2. **A workshop scaffold** — the agent and workflow pieces (`lib/agent.ts`, `lib/tools.ts`, `lib/workflows/*`, the `/api/chat*` and `/api/admin/chat` routes) are intentionally left as stubs that return `501`. You implement them as you work through the certification chapters.

## Tech stack

- **Next.js 16** (App Router) with **React 19**
- **TypeScript** (`strict`), `@/*` path alias → project root
- **Tailwind CSS v4** + **shadcn/ui** (new-york style); `lucide-react` icons
- **AI SDK 7** (`ai`, `@ai-sdk/react`) for the agent chapters
- **pnpm** (see `pnpm-lock.yaml`)

## Getting started

Prerequisites: Node.js 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
vercel link                  # select your team and the deployed project
vercel env pull .env.local   # BYPASS_SECRET, API_BASE_URL and an AI Gateway OIDC token
pnpm dev
```

Without the Vercel CLI, copy `.env.example` to `.env.local` and fill in the values yourself.

Open [http://localhost:3000](http://localhost:3000).

The storefront needs `BYPASS_SECRET` and `API_BASE_URL`. The agents also need AI Gateway access: the OIDC token from `vercel env pull` (it expires after 12 hours locally, so pull again) or an `AI_GATEWAY_API_KEY`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `BYPASS_SECRET` | Yes | Vercel deployment-protection bypass secret. Sent as the `x-vercel-protection-bypass` header on every API call. Server-only — never give it a `NEXT_PUBLIC_` prefix. |
| `API_BASE_URL` | Yes | Store API base URL, ending in `/api`. Prepopulated by the template's Deploy button; keep the provided value. |
| `VERCEL_OIDC_TOKEN` | Local AI calls | AI Gateway credential written by `vercel env pull`; expires after 12 hours locally. Not needed on Vercel, where OIDC is automatic. |
| `AI_GATEWAY_API_KEY` | No | AI Gateway API key, used instead of OIDC when set. Server-only. |
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL used for metadata. Defaults to `http://localhost:3000`. |

`.env.local` is gitignored; `.env.example` is the redacted template.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server on http://localhost:3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint with Next.js's recommended rules (`eslint.config.mjs`) |
| `pnpm type-check` | TypeScript check (`next build` skips type errors via `ignoreBuildErrors`) |

There is no test framework configured.

## Project structure

```
app/
  (store)/                 # storefront route group
    page.tsx               # / — home (force-static, revalidate 60)
    search/                # /search — dynamic, reads ?q & ?category
    products/[param]/      # /products/:idOrSlug — SSG product detail
  admin/                   # /admin dashboard + /admin/login (demo auth)
  api/
    chat/route.ts          # customer chat — workshop stub (501)
    chat/[id]/stream/      # durable-agent stream resume — workshop stub (501)
    admin/chat/route.ts    # admin agent chat — workshop stub (501)
  layout.tsx               # synchronous root layout (keeps routes statically renderable)
lib/
  api.ts                   # typed fetch wrapper for the Swag Store API (server-only)
  types.ts                 # shared API/domain types
  format.ts                # formatPrice() — API prices are integer cents
  cart-token.ts            # httpOnly cart_token cookie helpers
  cart-actions.ts          # 'use server' cart mutations (revalidateTag('cart'))
  admin-auth.ts            # demo admin auth constants
  admin-actions.ts         # 'use server' admin login/logout
  agent.ts, tools.ts       # workshop stubs — your agent + its tools
  workflows/               # workshop stubs — chat / admin-chat / return flows
components/
  cart-*.tsx               # cart provider, button, and sheet (client)
  agent-chat.tsx, admin-agent-chat.tsx, ai-elements/   # chat UI (workshop)
  header, footer, product-*, promo-banner, category-showcase, ...
```

## How it works

### Storefront & data layer

`lib/api.ts` is a typed `fetch` wrapper that talks to the live Swag Store API and injects the `BYPASS_SECRET`. It's server-only by convention. Read endpoints use ISR (`next: { revalidate: 300, tags: [...] }`); stock checks and all cart endpoints use `cache: 'no-store'`. Cart mutations run as Server Actions and call `revalidateTag('cart')`.

The cart UUID issued by the API is stored in an `httpOnly` `cart_token` cookie (`lib/cart-token.ts`). `components/cart-provider.tsx` hydrates the cart on the client at mount and uses `useOptimistic` for snappy updates, so the root layout can stay synchronous and routes can render statically.

Render modes: `/` is **static** (`force-static`, `revalidate = 60`), `/products/[param]` is **SSG** (`generateStaticParams` + `generateMetadata`), and `/search` is **dynamic** (it reads `searchParams`).

### Admin

`/admin` is gated behind `/admin/login` with a simple demo cookie set by `lib/admin-actions.ts`. The dashboard hosts the admin agent chat UI, which posts to `/api/admin/chat`. That route — like the customer `/api/chat` routes — is a workshop stub until you complete the corresponding chapter.

## Deployment

Deploys to [Vercel](https://vercel.com). In the project's environment variables set `BYPASS_SECRET` and `API_BASE_URL` (the Deploy button does this). AI Gateway uses the deployment's OIDC token automatically. `images.remotePatterns` in `next.config.mjs` is whitelisted for the Vercel Blob hosts the API serves product images from — add hostnames there if the API starts returning images from a new domain.
