---
name: shadcn-master
description: >
  ALWAYS use this skill for any component work in this project — no exceptions. Trigger immediately when the user: (1) asks to "add", "install", or "wire up" any shadcn component (combobox, sheet, toast, dialog, input, select, card, etc.); (2) asks to "create", "build", "make", or "write" any React component (HotelCard, TagInput, SearchInput, SectionHeader, PriceTag, Navbar, or any other named component); (3) asks to "add a variant", "add a state", "update styles", or "modify" any existing component file; (4) mentions src/components/, data-slot, CVA, buttonVariants, or shadcn in the context of code changes. If the user is asking you to produce or edit a .tsx component file, this skill applies. Invoke it even when the task sounds simple — the conventions it enforces are easy to get wrong without it.
---

# shadcn-master — Component Working Guide

This project uses **shadcn/ui v4** with the `radix-luma` style on top of **Tailwind CSS v4** (Vite plugin). The conventions below are non-negotiable — getting them wrong is the most common source of broken or inconsistent components.

---

## Decision Framework

| Task                                                   | Workflow                                                 |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Need a standard shadcn primitive (Dialog, Input, etc.) | [Install workflow](#installing-shadcn-components)        |
| Need a reusable component that composes primitives     | [Custom component workflow](#creating-custom-components) |
| Need a new variant or style on an existing component   | [Modify workflow](#modifying-existing-components)        |

---

## Non-Negotiable Conventions

Get these right before writing a single line of component code:

### Import alias

Always use `#/` — never `@/`.

```ts
import { cn } from '#/lib/utils' // ✅
import { Button } from '#/components/ui/button' // ✅
import { cn } from '@/lib/utils' // ❌
```

### Icon library

Use `@hugeicons/react` + `@hugeicons/core-free-icons`. Never import from `lucide-react`.

```ts
import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

// Usage:
<HugeiconsIcon icon={Search01Icon} size={16} />
```

### Radix primitives

Use the unified `radix-ui` package, not the legacy scoped packages.

```ts
import { Slot, Dialog } from 'radix-ui' // ✅
import * as Dialog from '@radix-ui/react-dialog' // ❌
```

### ESLint header

Every component file that uses type imports must start with this comment:

```ts
/* eslint-disable import/consistent-type-specifier-style */
```

### TypeScript

This project uses `verbatimModuleSyntax`. Use `import type` for type-only imports when they appear as separate import statements. In intersections and inline generics, the inline `type` keyword is fine.

### Package manager

Always `bun`, never npm or pnpm.

```bash
bunx shadcn@latest add dialog  # ✅
npx shadcn@latest add dialog   # ❌
```

---

## Design Tokens

Two token systems coexist — use the right one for the right purpose.

### Shadcn semantic tokens (for component states)

These respond to `.dark` class automatically. Use them for interactive, stateful UI:

```
--background / --foreground
--primary / --primary-foreground
--secondary / --secondary-foreground
--muted / --muted-foreground
--accent / --accent-foreground
--destructive
--border / --input / --ring
--card / --popover (and their foregrounds)
```

### Brand tokens (for brand identity)

These respond to `[data-theme='dark']` and `prefers-color-scheme`. Use them for brand-forward surfaces, decorative elements, and marketing UI:

```
--sea-ink         (dark teal — primary text color for brand elements)
--sea-ink-soft    (muted teal)
--lagoon          (teal accent)
--lagoon-deep     (deeper teal)
--palm            (green)
--sand            (light background surface)
--foam            (very light green-white)
--surface         (translucent white glass)
--surface-strong  (more opaque glass)
--line            (subtle border)
--bg-base         (page background)
--chip-bg / --chip-line  (tag/badge surfaces)
```

**Rule of thumb:** For interactive UI components (buttons, inputs, dialogs), prefer the shadcn semantic tokens. For layout surfaces, branded containers, or decorative elements, reach for brand tokens.

---

## Installing Shadcn Components

```bash
bunx shadcn@latest add <component-name>
```

After install, open the generated file and verify:

1. **Alias** — if the file uses `@/`, do a find-and-replace to `#/`
2. **Icons** — if the file imported `lucide-react`, replace with `@hugeicons/react`
3. **ESLint header** — add if missing
4. **Radix imports** — if the file uses `@radix-ui/react-*`, check if unified `radix-ui` re-exports it; replace if so

The component goes to `src/components/ui/<component-name>.tsx` (kebab-case).

---

## Creating Custom Components

Custom components live in `src/components/ComponentName.tsx` (PascalCase). They compose shadcn primitives for project-specific use cases.

### File structure template

```tsx
/* eslint-disable import/consistent-type-specifier-style */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'
// Import shadcn primitives as needed:
// import { Button } from '#/components/ui/button'
// import { Input } from '#/components/ui/input'

const componentVariants = cva('base-classes-here', {
  variants: {
    variant: {
      default: '...',
    },
    size: {
      default: '...',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

function ComponentName({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof componentVariants>) {
  return (
    <div
      data-slot="component-name"
      className={cn(componentVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { ComponentName, componentVariants }
```

### Key patterns for custom components

**`data-slot`** — always include on the root element. Use kebab-case matching the component name. This enables parent components to style children via CSS attribute selectors.

**`data-variant` and `data-size`** — include these if the component has variant/size props:

```tsx
<div
  data-slot="search-input"
  data-variant={variant}
  data-size={size}
  ...
/>
```

**`asChild` support** — add when the component might need to render as a different element (links styled as buttons, etc.):

```tsx
import { Slot } from 'radix-ui'

function ComponentName({ asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp data-slot="component-name" {...props} />
}
```

**Forwarding refs** — not needed in React 19 (which this project uses). `ref` is a regular prop in `ComponentProps`.

---

## Modifying Existing Components

When adding a variant or changing styles on an existing component (e.g., the Button):

1. Read the full file first — understand the existing CVA structure, base classes, and variant shapes
2. Add new variants that follow the same pattern as the existing ones:
   - Same property names (`variant`, `size`, etc.)
   - Same class-application style (Tailwind utilities, CSS variable references)
   - Dark mode handled inline via `dark:` prefix (for shadcn tokens) or left to CSS (for brand tokens)
3. Update `defaultVariants` only if the new variant should be the default
4. Export any new variant type that consumers might need

**Example — adding a `warning` variant to Button:**

```ts
variant: {
  // ...existing variants...
  warning:
    'bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 focus-visible:border-amber-500/40 focus-visible:ring-amber-500/20 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:text-amber-400',
},
```

Follow the same opacity-layered pattern as `destructive` — tinted background, matching text, hover darkens, dark mode adjusts.

---

## Radius Scale

The project defines a stepped radius scale based on `--radius: 0.625rem`:

| Token         | Value     | Use                |
| ------------- | --------- | ------------------ |
| `rounded-sm`  | ~0.375rem | Small inputs, tags |
| `rounded-md`  | ~0.5rem   | Cards, panels      |
| `rounded-lg`  | 0.625rem  | Standard surfaces  |
| `rounded-xl`  | ~0.875rem | Modal overlays     |
| `rounded-2xl` | ~1.125rem | Large cards        |
| `rounded-3xl` | ~1.375rem | Feature sections   |
| `rounded-4xl` | ~1.625rem | Buttons (default)  |

The Button uses `rounded-4xl` — this is intentional, giving pill-shaped buttons. Match this when composing button-like elements.

---

## Quick Checklist

Before submitting any component work, verify:

- [ ] Import alias is `#/` throughout
- [ ] No `lucide-react` imports — use `@hugeicons/react`
- [ ] No `@radix-ui/react-*` imports — use unified `radix-ui`
- [ ] ESLint comment at top of file
- [ ] `data-slot` on root element
- [ ] Named exports (not default exports)
- [ ] Both component and variants exported (if CVA used)
- [ ] `bun` used for any CLI commands
