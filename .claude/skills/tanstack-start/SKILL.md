---
name: tanstack-start
description: >
  Use this skill whenever working in this TanStack Start codebase — adding routes, writing server functions, loading data, wiring middleware, integrating TanStack Query, or handling SSR/head concerns. Trigger on any task involving: routing (createFileRoute, __root, routeTree), server functions (createServerFn), data loading (loader, useLoaderData), SSR metadata (head()), middleware (createMiddleware), or server-only logic. Even if the task seems simple, invoke this skill to ensure consistent patterns.
---

# TanStack Start — Working Guide

TanStack Start is a full-stack React framework built on TanStack Router. Its key mental model: **the router owns the data lifecycle**. Routes declare their own loaders, head metadata, and server handlers. Server functions bridge the client/server boundary via RPC. This separation of concerns is the framework's central design.

---

## Decision Framework: Which Pattern to Use?

Before writing code, pick the right pattern:

| Scenario                                    | Pattern                                   |
| ------------------------------------------- | ----------------------------------------- |
| Page needs data at render time (SSR)        | `loader` in `createFileRoute`             |
| Data needs client-side caching / refetching | Loader + TanStack Query `ensureQueryData` |
| Form submission or mutation                 | `createServerFn({ method: 'POST' })`      |
| REST/webhook endpoint                       | Server route handler in `createFileRoute` |
| Cross-cutting concern (auth, logging)       | `createMiddleware`                        |
| One-off server-side read                    | `createServerFn({ method: 'GET' })`       |
| Public config (API URLs)                    | `import.meta.env.VITE_*`                  |
| Secret config (DB, tokens)                  | `process.env.*` (server only)             |

---

## Routing

### File Naming → URL Mapping

```
src/routes/
  __root.tsx          → root layout (wraps all routes)
  index.tsx           → /
  about.tsx           → /about
  posts/
    index.tsx         → /posts
    $postId.tsx       → /posts/:postId   ($ prefix = dynamic segment)
    $postId.edit.tsx  → /posts/:postId/edit
  api/
    webhook.$.ts      → /api/webhook/*   ($ suffix = splat/catch-all)
```

**Never edit `routeTree.gen.ts`** — TanStack Router's Vite plugin regenerates it from the file tree.

### Creating a Route

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    return await fetchPost(params.postId)
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData.title }]
  }),
  component: PostDetail,
})

function PostDetail() {
  const post = Route.useLoaderData()
  const { postId } = Route.useParams()
  return <h1>{post.title}</h1>
}
```

**Why loaders belong in the route:** They run on the server before hydration, enabling SSR without waterfalls. Keep them simple — delegate heavy logic to server functions.

### Root Layout (`__root.tsx`)

```typescript
import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [{ rel: 'stylesheet', href: stylesUrl }],
  }),
  component: () => (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
})
```

---

## Server Functions

Server functions are typed RPC calls — they run only on the server but can be called from the client.

### GET (read)

```typescript
import { createServerFn } from '@tanstack/react-start'

export const getPost = createServerFn({ method: 'GET' })
  .validator((postId: string) => postId) // validate/transform input
  .handler(async ({ data: postId }) => {
    return await db.post.findUnique({ where: { id: postId } })
  })
```

### POST (mutation)

```typescript
export const createPost = createServerFn({ method: 'POST' })
  .validator((d: { title: string; body: string }) => d)
  .handler(async ({ data }) => {
    return await db.post.create({ data })
  })
```

### Calling from a loader

```typescript
export const Route = createFileRoute('/posts/$postId')({
  loader: ({ params }) => getPost({ data: params.postId }),
})
```

### Calling from a component (mutation)

```typescript
import { useServerFn } from '@tanstack/react-start'

function PostForm() {
  const submit = useServerFn(createPost)
  return (
    <form onSubmit={async (e) => {
      e.preventDefault()
      const fd = new FormData(e.currentTarget)
      await submit({ data: { title: fd.get('title') as string, body: fd.get('body') as string } })
    }}>
      ...
    </form>
  )
}
```

**Security:** Server functions never expose their implementation to the client. Process env vars and secrets are safe here.

---

## TanStack Query Integration

Use Query when you need client-side caching, background refetching, or invalidation. The loader primes the cache on the server; the component reads it with `useQuery`.

```typescript
import { queryOptions, useQuery } from '@tanstack/react-query'

// Define query options once, reuse everywhere
const postQuery = (postId: string) =>
  queryOptions({
    queryKey: ['posts', postId],
    queryFn: () => getPost({ data: postId }),
  })

// Route: prime the cache on the server
export const Route = createFileRoute('/posts/$postId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postQuery(params.postId)),
  component: PostDetail,
})

// Component: reads from cache (no extra request)
function PostDetail() {
  const { postId } = Route.useParams()
  const { data: post } = useQuery(postQuery(postId))
  return <h1>{post?.title}</h1>
}
```

**When to use loader-only vs loader + Query:**

- Loader-only: data is static for the page visit, no refetch needed
- Loader + Query: data can change, user can trigger refetch, or other components need the same data

---

## Middleware

Middleware runs on every matching server function call. Use it for auth, logging, and request context.

```typescript
import { createMiddleware } from '@tanstack/react-start'

// Auth middleware — runs server-side, enriches context
const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const session = await getSession()
    if (!session.userId) throw new Error('Unauthorized')
    return next({ context: { user: await getUser(session.userId) } })
  },
)

// Attach to a server function
export const getMyPosts = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return await db.post.findMany({ where: { userId: context.user.id } })
  })
```

### Global middleware (all server functions)

Register in `src/router.tsx` or `src/start.ts` via the `functionMiddleware` option.

---

## Server Routes (HTTP Endpoints)

For webhooks, REST APIs, or file downloads — these respond directly without client routing:

```typescript
export const Route = createFileRoute('/api/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = await request.json()
        await processWebhook(payload)
        return Response.json({ received: true })
      },
    },
  },
})
```

---

## Environment Variables

```typescript
// ✅ Server-only (database, secrets) — never in components
const db = connect(process.env.DATABASE_URL)

// ✅ Client-safe — must be prefixed with VITE_
const apiUrl = import.meta.env.VITE_API_URL

// ❌ Never do this — exposes secrets
const apiUrl = process.env.SECRET_KEY // broken on client anyway
```

`.env` file precedence: `.env.local` > `.env.production` / `.env.development` > `.env`

---

## SEO & Head Metadata

Each route owns its own `head()`. Data from `loaderData` is available:

```typescript
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => fetchPost(params.postId),
  head: ({ loaderData: post }) => ({
    meta: [
      { title: `${post.title} | Reisify` },
      { name: 'description', content: post.excerpt },
      { property: 'og:image', content: post.coverImage },
    ],
  }),
})
```

---

## Common Pitfalls

1. **Importing server-only code in components** — anything calling `process.env` or DB must be in a server function or loader, never in a component that renders on the client.

2. **Stale `routeTree.gen.ts`** — if routes aren't being found, the dev server may need a restart to trigger regeneration.

3. **Missing `context.queryClient`** — Query's `queryClient` must be added to the router context in `router.tsx` before using it in loaders.

4. **`redirect()` in loaders** — use `throw redirect({ to: '/login' })` (throw, not return) so TanStack Router's error boundary intercepts it.

5. **Path aliases** — this project uses `#/*` and `@/*` for `src/*`. Prefer `#/` for absolute imports from `src`.

---

## Project Conventions (reisify-web)

- Package manager: **bun**
- Styling: **Tailwind CSS v4** (via `@tailwindcss/vite`), global styles in `src/styles.css`
- TypeScript: strict mode, `verbatimModuleSyntax` — use `import type` for type-only imports
- Run `bun check` after editing to auto-fix lint/format issues
