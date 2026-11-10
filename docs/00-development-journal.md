# 00 — Development Journal

**Status:** Append-only record, started 2026-11-10 · **Last entry:** 2026-11-10

A chronological record of how WorkFlow is designed, built, tested and deployed. Each entry describes what I was working on, what I considered, what I decided, what happened, and what's still open. Entries are never rewritten. If an earlier entry turns out to be wrong, a later entry says so. The rules are in the [documentation guide](documentation-guide.md#8-the-development-journal).

The first entries were written on 2026-11-10 from the evidence available then: the commit history and the Phase 1 documents. Where a document's own date differs from its commit date, both are given.

---

## 2026-11-05 — Phase 1 planning: requirements and architecture

**Evidence:** commit `0317be1` (2026-11-05), the first versions of `docs/01`–`07`.

**Working on:** turning my brief for WorkFlow into a full specification before writing any code. The brief covered a multi-tenant project management platform, three workspace roles, and a fixed stack: Laravel, Sanctum, React, Vite, Tailwind, MySQL.

**Main questions:**
- How to keep organisations' data apart in one application.
- How the browser should authenticate.
- How the "active workspace" reaches the API.
- How the roles in the brief fit together.

**Options and decisions:**

| Question | Options considered | Decision |
|---|---|---|
| Tenancy model | Shared tables with `workspace_id`; schema per tenant; database per tenant | Shared tables, strengthened with composite foreign keys so the database itself rejects cross-workspace links, plus a global scope that **fails closed** when no workspace is set (ADR-01) |
| Authentication | Sanctum bearer tokens; Sanctum SPA cookie sessions | Cookie sessions, because tokens in JavaScript-readable storage can be stolen through XSS (ADR-02) |
| Active workspace | Server session; request header; URL path; subdomain | URL path, because a session-stored workspace lets two browser tabs act on different organisations without the user noticing (ADR-03, D5) |
| Roles | Workspace-wide Project Manager; two layers | Two layers: workspace roles plus project roles, so a Project Manager only manages assigned projects (D1) |

I confirmed D1–D11 the same day, including:
- Team Members change only their own tasks (D2).
- Only managers complete tasks (D3).
- One assignee per task (D4).
- Email verification in V1 (D6).
- One repository (D8).
- No deletion of workspaces and accounts in V1 (D9).
- Plain-text comments (D10).
- Fixed roles in code (D11).

**First hosting decision (D7, since superseded):** a small Linux VPS with a purchased domain, using `app.` and `api.` subdomains. That was the setup Sanctum's documentation describes.

**What I learned:**
- Sanctum's cookie mode depends on the SPA and API sharing a site, which turns hosting into an authentication question.
- In MySQL, `ON DELETE SET NULL` can't work on a composite foreign key that includes a non-nullable `workspace_id`.

**Unresolved:** hosting cost. I didn't want to commit to paying for a VPS or a domain.

---

## 2026-11-06 — Hosting rethought for zero cost

**Evidence:** commit `5c79b70` (2026-11-06). The revised documents are dated 2026-11-05.

**Problem:** I wanted a public demonstration at no cost, without a purchased domain, while keeping Sanctum cookie authentication.

**Investigated:**
- Free plans on Render, Railway, Koyeb, Fly.io, Oracle Cloud Always Free, alwaysdata and InfinityFree.
- Free MySQL hosting.
- The Public Suffix List. `onrender.com`, `vercel.app`, `netlify.app`, `up.railway.app`, `fly.dev`, `alwaysdata.net` and `duckdns.org` are all public suffixes, so two services on any of them are different sites to a browser.

**Decision at the time:**
- One Docker container on Render's free plan serving both applications from one origin, with Nginx routing by path.
- Aiven's free MySQL for the database.
- Brevo's email API, subject to validation, because Render's free plan blocks outbound SMTP ports.
- GitHub Actions for migrations and a nightly demo reset.
- Demo data treated as disposable.

**What I learned:**
- On a free platform domain, the only way to keep first-party cookies is for the browser to see a single origin.
- Free tiers differ widely in sleeping, workers and databases, and they change.

**Unresolved:** whether Docker runs on Render's free plan, and Brevo's rules for free senders.

---

## 2026-11-08 — Free MySQL withdrawn; moved to PostgreSQL

**Evidence:** commit `82596c8` (committed 2026-11-10; the revised documents are dated 2026-11-08). ADR-10, D12, D13, and `docs/03` section 7.

**Problem:** Aiven stopped creating new free MySQL services on 2026-11-06, and is deleting existing ones on 2026-12-21. Its paid MySQL plan costs $5 a month. My zero-cost plan depended on a service I could no longer create.

**Investigated:** whether PostgreSQL supports the design without weakening any tenant safeguard:
- **Composite foreign keys:** supported.
- **Open invitation per email:** the MySQL generated-column workaround becomes a **partial unique index**.
- **Case-insensitive email:** needs a `lower(email)` unique index, because PostgreSQL compares text case-sensitively.
- **Foreign key indexes:** PostgreSQL doesn't create them automatically, so they become explicit, with a guard test.
- **Locking:** `FOR UPDATE` can't be combined with aggregate functions.
- **Transactions:** a transaction refuses all further statements after an error.
- **Laravel:** supports all of it, with raw SQL needed only for partial and expression indexes.

**Providers compared:**

| Provider | Free terms | Verdict |
|---|---|---|
| Neon | Permanent, no card, public TLS certificate | Chosen |
| Aiven PostgreSQL | 20 connections, private CA | Fallback |
| Supabase | Pauses after a week idle, and has an automatic data API that must be disabled | Second fallback |
| Render PostgreSQL | Expires after 30 days | Rejected |

**Email:** I still couldn't confirm Brevo's free-sender rules, so I proposed an in-app **demo mailbox** (D13). In demo mode only reserved `workflow.test` addresses are accepted, so no real email address is ever collected. Real email delivery stays in the application.

**Decision:** PostgreSQL 18 everywhere: locally, in CI and on Neon (D12, proposed).

**What I learned:** a database engine change has to be evaluated against the design's guarantees, not done by renaming. Two parts of the design got simpler with PostgreSQL.

---

## 2026-11-10 — Separate frontend and backend services

**Evidence:** commit `889edfc` (2026-11-10). ADR-09, ADR-11, and `docs/02` section 10.

**Decision prompting this:** I wanted the frontend and backend deployed as separate Render services rather than one container.

**Problem:** with Render's two default domains, calling the API directly would:
- make the session cookie a third-party cookie, blocked by Safari,
- leave the `XSRF-TOKEN` cookie unreadable to the SPA,
- fail Sanctum's same-site requirement,
- and `.onrender.com` can't be used as a cookie domain.

**Investigated:** Render static-site rewrite rules. Render's documentation allows a full URL as the destination, but doesn't describe how requests are proxied. Community threads report it working for API paths, and one reports roughly 400 ms against 40 ms when called directly.

**Decision:**
- The static site forwards `/api/*` and `/sanctum/*` to the backend, so the browser sees one origin (ADR-09, D7 revised).
- No permanent queue worker in V1. Notifications and demo emails are written synchronously after commit (ADR-11).
- Email verification uses relative signed URLs, so the hostname seen behind the proxy doesn't matter.

**Fallbacks** if the forwarding fails, each requiring a deliberate decision:
- One container.
- A purchased domain.
- A Vercel or Netlify proxy.

Bearer tokens and cross-site cookies are rejected on security grounds.

**Unresolved:** whether Render's forwarding preserves cookies, bodies and headers. **This became the first task of Phase 2.**

---

## 2026-11-10 — Phase 1 approved

**Evidence:** commit `ff2daea` (2026-11-10) on `main`, a squash merge of `docs/phase-1-architecture`.

I approved the Phase 1 documents, including D12 (PostgreSQL 18 on Neon) and D13 (the fictional demo mailbox), subject to the documented security requirements. D7, separate services with forwarding, stays approved but **unverified** until the forwarding experiment runs on Render.

---

## 2026-11-10 — Render forwarding experiment built and checked locally

**Evidence:** `experiments/render-proxy/` on `spike/render-proxy-test`, still uncommitted at the time of this entry, and the recorded local results in its README.

**Working on:** the smallest experiment that answers whether Render's forwarding works, before building any authentication.

**Approach:**
- A plain-PHP echo service in a small Docker image, not Laravel. Forwarding is an HTTP-level question, and a framework would only add noise. Where it matters, the backend copies Laravel's behaviour: two `Set-Cookie` headers on a 204 from `/sanctum/csrf-cookie`, and Laravel-shaped 419, 422 and 429 errors.
- A framework-free test page that runs checks P1–P7.
- A Node.js stand-in for Render, so the harness could be checked locally.
- The experiment branch is never merged into `main`.

**Testing, 2026-11-10, locally on Windows:** PHP 8.3 built-in server, the Node.js stand-in, and a Playwright-controlled Chromium-based browser.
- **`curl` through the stand-in:** two separate `Set-Cookie` headers on the 204, `Retry-After` preserved on the 429, a `PATCH` body echoed intact, and the client-route fallback and 404/405 behaviour all correct.
- **Browser run:** "6 pass, 0 fail, 1 inconclusive". P1–P4 passed. P5 and P7 were reported as PASS. P6 was INCONCLUSIVE, because the local backend never sleeps.

**Not done:**
- Docker isn't installed on my machine, so **the image has never been built**.
- **Nothing was deployed to Render.**

**Unresolved:** every question about Render itself. Also, whether the Docker image builds and fits Render's free 512 MB instance.

---

## 2026-11-10 — Experiment review and documentation system

**Working on:** reviewing the experiment's code against what its checks claim, and setting up a documentation system for the whole repository.

**Experiment findings:**
- **P5's local PASS is not meaningful.** The client, stand-in and backend all used 127.0.0.1, so the run only showed that the analysis code works. It's now recorded as "not established".
- **P7's local PASS is loopback timing:** a median of 20 ms forwarded against 13 ms direct. It's now labelled as local-only.
- **P6 was recorded as INCONCLUSIVE, not PASS.** The run's own output shows this. It needs a real Render backend after at least 16 minutes idle.
- **Five harness issues found, none applied yet:**
  - C1: the separate P6 wake test can falsely pass for a recently restarted container.
  - C2: one P2 check passes trivially on a first run.
  - C3: P3's summary mentions `Origin` even when it wasn't sent.
  - C4: P5's visibility check uses substring matching.
  - C5: a fully broken proxy delays the run by up to 4 minutes.

  Each has a proposed minimal fix in the experiment README. I'll decide on them before the Render run, so the code stays as it was tested.

**Documentation changes:**
- Rewrote the root README, which was a one-line UTF-16 file.
- Added the [documentation guide](documentation-guide.md) and this journal.
- Added status lines to every document, saying what is approved, implemented, tested or deployed. Currently that's approved only.
- Rewrote the documents in my own engineering voice, and removed showcase-oriented wording.
- Corrected stale content: D13 is approved, the experiment uses plain PHP rather than a minimal Laravel service, and P1 includes `PUT`.
- Added an execution-status table to the testing strategy.

**What I learned:** a check can pass without testing anything meaningful when the environment can't produce the condition it checks for, as with IP identification on localhost. Results need to record what they establish, not just their label.

**Next:**
1. Commit the experiment on its spike branch.
2. Bring the documentation changes to `main` through a docs branch.
3. Decide on corrections C1–C5.
4. Deploy the experiment to Render. That's also the Docker image's first build.
5. Run P1–P7 there.

---

## 2026-11-10 — Documentation structure finalised

**Working on:** settling the documentation layout before going back to the experiment.

**Changes:**
- Renamed the journal from `08-development-journal.md` to `00-development-journal.md`, so the project's history sorts first in `docs/`.
- Renamed the guide from `00-documentation-guide.md` to an unnumbered `documentation-guide.md`, because it describes the documents rather than the product.
- The seven specification documents keep their numbers.
- Updated every link. The root README now links the journal prominently.
- In the earlier entries, only link targets changed, to follow the renames. Their content is unchanged.

**Where things stand:**

| Category | Status |
|---|---|
| Proposed architecture | Separate Render services, with the frontend static site forwarding `/api` and `/sanctum` to a Docker backend (D7, ADR-09). Approved, **not validated** |
| Implemented and tested locally | Only the forwarding experiment, against a Node.js stand-in for Render. No WorkFlow application code exists |
| Validated on Render | Nothing yet |
| Unresolved | Whether Render's forwarding preserves cookies, headers and bodies. Whether the experiment's Docker image builds and fits the free instance. Corrections C1–C5 to the test harness, which are being made next |

**Next:** apply corrections C1–C5 on `spike/render-proxy-test`, re-run the local checks, and record the results.

---

## 2026-11-10 — Test-harness corrections C1–C6 and second local run

**Evidence:** commit `e922109` on `spike/render-proxy-test`. The details and both local runs are in the [experiment README](https://github.com/Martins-Code/workflow/tree/spike/render-proxy-test/experiments/render-proxy).

**Working on:** fixing the five issues found in the review, so each check reports only what it can actually establish before the experiment goes to Render.

**Changes:** all in the test page, except one option added to the local stand-in.

| Correction | What changed |
|---|---|
| C1 | P6 now needs evidence of a real wake-up, not just a recently started container |
| C2 | P2 sets, clears and re-sets cookies, so removal is tested on every run, in both browser storage and backend receipt |
| C3 | P3 judges `Origin` and `Referer` only when the browser sent them |
| C4 | P5 compares exact, normalised addresses, and reports loopback or private input as INCONCLUSIVE |
| C5 | The full run waits at most 120 s for the backend, and stops at once on a clearly misconfigured rewrite. The stand-in gained `SIMULATE=missing-rewrite` to test this |

The backend didn't change.

**Testing (second local run, 2026-11-10):**
- **Full run, twice:** P1–P4 PASS, P5 INCONCLUSIVE (loopback address), P6 INCONCLUSIVE (the backend never sleeps locally), P7 PASS on local loopback timing only.
- **C1:** the wake test run against a just-started backend that answered in 133 ms reported INCONCLUSIVE. The original code would have reported PASS.
- **C5, missing rewrite:** a simulated missing rewrite rule was reported in 0.1 s, with the cause.
- **C5, backend down:** a stopped backend was reported after 121.5 s and 25 attempts, at the 120 s cap.
- **C4:** exact matching was confirmed by calling the helpers directly in the page.

**Additional defect found (C6):** passing checks could display failure text in their details. Results were correct, but the diagnostics were misleading. I fixed it in the same commit, and recorded it rather than folding it silently into the other corrections.

**Where things stand:**

| Category | Status |
|---|---|
| Proposed architecture | Separate Render services with forwarding (D7, ADR-09). Approved, **not validated** |
| Implemented and tested locally | The experiment's test harness and echo backend, against a Node.js stand-in. Local results establish that the harness measures correctly. They don't establish Render's behaviour, visitor IP handling, cold starts or real latency |
| Validated on Render | Nothing yet |
| Unresolved | Render's forwarding behaviour (P1–P7). Whether the Docker image builds, which has never been tried. Cookie attributes on a real HTTPS deployment, which need manual inspection |

**What I learned:** a check has to be able to report "I couldn't tell". Two of the original checks could report PASS in conditions where the thing they test can't happen: an IP check on localhost, and a wake test against a backend that had only just started.

**Next:** understand the Dockerfile before its first build, deploy the experiment to Render, and run P1–P7 there.
