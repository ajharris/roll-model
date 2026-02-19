# roll-model

This repository contains:

- `backend/`: Serverless API and infrastructure.
- `frontend/`: Next.js (App Router) frontend v1.

## Frontend v1 quick start

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Build for production:

```bash
cd frontend
npm run build
```

Required frontend environment variables are documented in `frontend/.env.example`.

## Backend quick start

```bash
npm install
npm run build
npm test
npm run lint
```
