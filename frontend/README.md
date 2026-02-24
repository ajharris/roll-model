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

## Cognito Hosted UI (local / preview / prod)

The frontend supports Cognito Hosted UI sign-in with a callback route at `/auth/callback` (code + PKCE flow).

Required Hosted UI env vars:

- `NEXT_PUBLIC_COGNITO_DOMAIN` (for example `yourdomain.auth.us-east-1.amazoncognito.com`)
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS` (comma-separated)
- `NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS` (comma-separated)

Redirect URI validation rules enforced by the app:

- Sign-in redirect URIs must be valid `http(s)` URLs.
- Sign-in redirect URIs must use the callback path `/auth/callback`.
- Sign-out redirect URIs must be valid `http(s)` URLs.
- At runtime, the app selects the redirect URIs whose origin matches the current `window.location.origin`.
- If no redirect URI matches the current origin, Hosted UI sign-in is disabled and the UI shows a configuration error.

Example values (single env file supporting local + Amplify preview + production):

```env
NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS=http://localhost:3000/auth/callback,https://my-preview-branch.d123.amplifyapp.com/auth/callback,https://app.example.com/auth/callback
NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS=http://localhost:3000/,https://my-preview-branch.d123.amplifyapp.com/,https://app.example.com/
```

Cognito app client setup must include every sign-in/sign-out URI above in:

- `Allowed callback URLs` (sign-in)
- `Allowed sign-out URLs` (sign-out)

## Build

```bash
npm run build
```

## Notes

- Tokens are stored in memory and sessionStorage only.
- API calls attach the Cognito ID token in `Authorization`.
- Hosted UI callback processing exchanges authorization codes using PKCE and hydrates the same session storage used by direct sign-in.
- AI chat calls backend `/ai/chat`; if unavailable, UI degrades gracefully.
