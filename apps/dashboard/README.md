# @neuro/dashboard

Next.js dashboard for NEURO - Monitoring and Manual Approval interface.

## Features

- **Cyberpunk UI**: Dark theme with neon accents
- **Real-time Monitoring**: System status, chain stats
- **Approval Queue**: Manual approval for AI decisions
- **Kill Switch**: Emergency stop control
- **Market Overview**: Trending tokens from nad.fun

## Prerequisites

- Node.js 20+
- Running backend services

## Installation

```bash
pnpm install
```

## Configuration

Set environment variables in `.env.local`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Run Commands

```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start

# Lint
pnpm lint

# Type checking
pnpm typecheck
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main dashboard |
| `/approvals` | Approval queue |
| `/portfolio` | Portfolio view |
| `/tokens` | Token browser |
| `/market` | Market overview |
| `/decisions` | AI decisions log |
| `/history` | Transaction history |
| `/settings` | Configuration |

## Components

### Layout
- `Header` - Top navigation with chain status
- `Sidebar` - Navigation menu

### Panels
- `StatusPanel` - Service health indicators
- `ApprovalQueue` - Pending approvals
- `MarketOverview` - Trending tokens
- `ActivityFeed` - Recent activity

### Controls
- `KillSwitch` - Emergency stop button

## Styling

Tailwind CSS with custom cyberpunk theme:

```css
/* Colors */
cyber-purple: #9333ea
cyber-pink: #ec4899
cyber-cyan: #06b6d4
cyber-green: #22c55e
cyber-red: #ef4444
cyber-yellow: #fbbf24

/* Effects */
.neon-text     /* Glowing text */
.cyber-card    /* Styled card */
.cyber-button  /* Styled button */
.glitch        /* Glitch effect */
```

## Architecture

```
apps/dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── controls/
│   │   ├── layout/
│   │   └── panels/
│   ├── hooks/
│   ├── lib/
│   ├── store/
│   └── styles/
│       └── globals.css
└── README.md
```
