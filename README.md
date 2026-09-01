# Artifact Notifier

Full-stack application that tracks **real-time** new versions of artifacts
published on **npm**, **Maven Central** and **PyPI**, and notifies users by email
(immediately or as a digest recap, as they choose).

- **Backend**: Node + [NestJS](https://nestjs.com/) 12, Prisma + SQLite, multi-provider OIDC,
  polling (npm, Maven/PyPI), email sending via SMTP (Mailtrap by default).
- **Frontend**: [Angular](https://angular.dev/) 22, OIDC authentication and management of
  artifact subscriptions.

> Inspired by an original Deno POC: only new versions of artifacts
> **actually followed** by at least one user are stored in the database.

## Architecture

```
artifact-notifier/
├── backend/     # NestJS + Prisma + real-time listeners + notifications
├── frontend/    # Angular 22 (OIDC auth, dashboard, preferences)
└── package.json # `dev` scripts (concurrently)
```

### Data flow

1. Listeners (npm SSE / Maven polling / PyPI RSS polling) receive new
   publications from their ecosystem.
2. Each listener filters by the **set of followed artifacts** (cached, refreshed
   every 30 s). Everything else is ignored.
3. For a followed artifact whose version is higher than the known version:
    - update of `FollowedArtifact.currentVersion`
    - creation of an `ArtifactVersionEvent` (only 1 per `(artifact, version)`)
    - creation of a **PENDING `NotificationDelivery` per user** following the artifact
4. Depending on user preferences:
    - `IMMEDIATE` → email sent right away, delivery marked `SENT`
    - `DIGEST` → recap email sent once the configured interval has elapsed, grouping
      all `PENDING` deliveries of that user

Notification state is therefore **per (event, user)** via the
`NotificationDelivery` table — two users following the same artifact with different
intervals still receive their notifications independently.

## Prerequisites

- Node.js 20+
- npm 10+
- A [Mailtrap](https://mailtrap.io) account (or another SMTP server) for emails
- At least one configured OIDC provider (Google / GitHub / Facebook)

## Installation

```bash
# 1. Install all dependencies (backend + frontend)
npm run install:all

# 2. Configure the backend
cp backend/.env.example backend/.env
#    edit backend/.env (SMTP, JWT_SECRET, OIDC providers — see below)

# 3. Create the SQLite database (single init migration, also generates the client)
npm run backend:migrate
```

## OIDC configuration

The backend loads providers from `.env` via `OIDC_PROVIDERS` (comma-separated
list). For each provider `xxx` (lowercase), fill in:

| Variable | Description |
|---|---|
| `OIDC_XXX_DISPLAY_NAME` | Name shown on the login button |
| `OIDC_XXX_ISSUER` | OIDC issuer (discovery `.well-known`) — Google, Facebook |
| `OIDC_XXX_AUTHORIZATION_ENDPOINT` / `TOKEN_ENDPOINT` / `USERINFO_ENDPOINT` | Manual endpoints (GitHub has no standard OIDC discovery) |
| `OIDC_XXX_CLIENT_ID` / `OIDC_XXX_CLIENT_SECRET` | OAuth credentials from your provider |
| `OIDC_XXX_SCOPES` | Requested scopes |

### Google
1. Create an "OAuth application" in [Google Cloud Console](https://console.cloud.google.com/).
2. Add the redirect URI: `http://localhost:3000/api/auth/google/callback`.
3. Fill in `OIDC_GOOGLE_CLIENT_ID` / `OIDC_GOOGLE_CLIENT_SECRET`, `OIDC_GOOGLE_ISSUER=https://accounts.google.com`.

### GitHub
1. [Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/developers).
2. Authorization callback URL: `http://localhost:3000/api/auth/github/callback`.
3. Fill in `OIDC_GITHUB_CLIENT_ID` / `OIDC_GITHUB_CLIENT_SECRET` (endpoints are
   pre-filled in `.env.example`).

### Facebook
1. [Meta for Developers → App → Facebook Login](https://developers.facebook.com/).
2. Valid OAuth Redirect URI: `http://localhost:3000/api/auth/facebook/callback`.
3. Fill in `OIDC_FACEBOOK_CLIENT_ID` / `OIDC_FACEBOOK_CLIENT_SECRET`.

## Run in development

From the root:

```bash
npm run dev
```

- Backend: http://localhost:3000/api
- Frontend: http://localhost:4200

Open http://localhost:4200, sign in via an OIDC provider, then:
1. Add a followed artifact (e.g. npm `react`, or maven `org.springframework:spring-core`).
2. Wait for / trigger a new version → an `ArtifactVersionEvent` is created **only**
   for followed artifacts.
3. Preferences = immediate → mail received in Mailtrap. Preferences = digest (e.g. 1 min) →
   recap mail received after the interval.

## Quick API tests

```bash
# List configured OIDC providers
curl http://localhost:3000/api/auth/providers

# Artifact search (authenticated required for /artifacts)
curl -b cookies.txt http://localhost:3000/api/artifacts/search?ecosystem=npm&q=react
```

## Database structure (Prisma)

See `backend/prisma/schema.prisma`: `User`, `UserPreferences`, `FollowedArtifact`,
`ArtifactVersionEvent`, `NotificationDelivery`, `ListenerSequence`.

- `ListenerSequence` allows resuming npm/Maven/PyPI tracking where it stopped
  (`_changes` sequence / timestamp / RSS etag).
