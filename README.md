# Ancentrix Dial

Ancentrix Dial is a calling workspace for teams. The browser starts a phone bridge through the Telnyx Voice API: Telnyx calls the employee's phone, then connects the customer. It does not use browser microphone/WebRTC calling and does not include AI calling or IVR.

## Requirements

- Node.js 20 or newer
- pnpm 9
- Firebase project with Authentication (Email/Password and email verification) and Cloud Firestore enabled
- Telnyx API key, Voice API Application ID, and a Telnyx caller ID number

## Local setup

1. Copy `.env.example` to `.env.local` and fill in Firebase Admin and web app settings.
2. Generate a 32-byte encryption key and base64 encode it, for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Put the result in `ENCRYPTION_KEY`.
3. Configure Firebase Authentication authorized domains to include `localhost` and the deployment host. Enable Email/Password sign in and email verification.
4. Install and run:

   ```sh
   pnpm install
   pnpm dev
   ```

5. Register an organization, verify the owner email, then configure Telnyx from Settings. Each employee saves their own phone number in Profile; the owner configures the shared Telnyx values.

## Login and routing

The login, registration, password recovery, and email-verification pages are public. The login form does not redirect based on a background session check; it creates the HttpOnly session cookie only after the user submits valid Firebase credentials. The dashboard validates that cookie on the server, and protected API routes validate it through `requireUser`. Middleware is limited to API rate limiting and same-origin checks so an expired cookie cannot cause a client-side page redirect loop.

For deployment, make sure the `NEXT_PUBLIC_FIREBASE_*` values belong to the same Firebase project as `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Add the deployed hostname to Firebase Authentication's authorized domains, then rebuild/redeploy after changing any `NEXT_PUBLIC_*` value.

## Dashboard call activity data

The dashboard's Call activity chart is generated from the authenticated `/api/call-logs` endpoint, which reads tenant-scoped records from the Firestore `call_logs` collection. Outbound calls create a log when the Telnyx call is started; inbound calls create a log when the Telnyx webhook receives the call. Subsequent Telnyx webhook events update the stored status, connection time, end time, and duration. The chart groups these saved records by their `createdAt` date for the selected range (last 7 days or current month). It shows an empty state when there are no call records; it does not use sample values.

## Firebase setup

Create a Firebase service account and set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. For a multiline private key in Render, set the environment variable with literal `\n` separators. Deploy `firestore.rules` and `firestore.indexes.json` using the Firebase CLI. All application Firestore operations run through authenticated Next.js server routes using the Admin SDK. The rules intentionally deny direct browser access.

## Telnyx setup

Configure only the Telnyx API key, Voice API Application ID, and caller ID number in workspace Settings. API credentials are encrypted at rest. In Telnyx, set the Voice API Application's webhook URL to `https://<your-render-host>/api/telnyx/webhook` and use webhook API v2. Set `TELNYX_PUBLIC_KEY` in the Render environment for Ed25519 webhook signature verification. Each employee must enter a phone number in their Profile. For outbound calls, Telnyx rings that employee first, then the webhook transfers the call to the customer. Incoming calls to the Voice API application are forwarded to the workspace owner's profile phone. When testing locally, set `NEXT_PUBLIC_APP_URL` to a public HTTPS tunnel such as an ngrok URL; Telnyx cannot reach a `localhost` webhook.

Calls use the employee's mobile or desk phone for audio; the browser does not need microphone permission. Render Free services sleep when idle, so inbound webhook forwarding can be delayed while the service wakes.

## Firebase email flows

Forgot-password and email verification messages are sent by Firebase Authentication. Enable Email/Password authentication and configure Firebase's email templates and authorized domains. Owners create employee Firebase accounts by entering the employee name, email, and initial password in Team Settings. Share the initial password securely; employees can change it through Firebase's password-reset flow. Employees do not self-register.

## Deploy to Render

The repository includes `render.yaml`, `Dockerfile`, `.dockerignore`, and `docker-compose.yml`. Create a Render Web Service from this repository and set the environment variables in the Render dashboard. The blueprint selects Render's Free plan (512 MB RAM, 0.1 CPU). The production container uses Next.js standalone output, disables eager route preloading and source maps, enables Next's webpack memory optimization, and caps Node's old-space heap at 320 MB to leave room for native memory. This is a conservative heap limit, not a process-wide RSS cap; monitor Render memory graphs during real usage. It binds to Render's `PORT` (10000 by default). Add the deployed host to Firebase Authentication authorized domains. Deploy the Firestore rules and indexes from the Firebase CLI before accepting registrations.

## Deploy with Docker

```sh
cp .env.example .env
# fill .env values
docker compose up --build
```

## Security notes

- Session cookies are HttpOnly, Secure in production, and SameSite=Lax. API handlers verify the Firebase session and enforce organization and role boundaries.
- Telnyx configuration uses AES-256-GCM encryption at rest. `ENCRYPTION_KEY` must remain stable; changing it requires re-encrypting stored credentials.
- Owner Telnyx settings require a recent Firebase reauthentication before they can be opened or changed.
- Keep `.env*` files out of source control. Rotate Firebase service account keys, Telnyx API keys, and `ENCRYPTION_KEY` through planned migrations.

## Commands

```sh
pnpm lint
pnpm typecheck
pnpm build
```

## Current scope

Implemented: organization registration, verified owner email login, Firebase password recovery, owner-created employee Firebase accounts with admin-assigned initial passwords, owner and employee roles, encrypted Telnyx Voice API settings, phone-bridge outbound calling and inbound forwarding to the workspace owner, tenant-scoped contacts with search/favorites/CSV import-export, call log storage/search/notes/export, dashboard summaries and live call-log aggregations, responsive workspace layout with a scrollable sidebar, owner employee create/remove/disable/reset flows, profile and organization settings, and role-guarded Telnyx settings.

Current limits: contacts do not yet have an edit form; call logs support text search but not direction/status filters; activity records are written for selected actions but have no viewer page; and the UI uses Tailwind components rather than generated shadcn/ui primitives. Real Telnyx credentials and webhook configuration are required for end-to-end calls. The supplied legacy backend's inbound AI media streaming is not part of this app; inbound calls here forward to the owner's phone.
