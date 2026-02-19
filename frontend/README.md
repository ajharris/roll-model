# roll-model frontend v1

Next.js App Router frontend for athlete journaling, coach review, analytics, export, and AI chat UX.

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Build

```bash
npm run build
```

## Notes

- Tokens are stored in memory and sessionStorage only.
- API calls attach the Cognito ID token in `Authorization`.
- AI chat calls backend `/ai/chat`; if unavailable, UI degrades gracefully.
