# 07 — Development Roadmap

**Status:** Revised, awaiting final approval · **Date:** 2026-11-10

Each phase ends with something working and tested, merged into a stable `main`. Sizes are relative: **S** small, **M** medium, **L** large. Calendar estimates are left out, as they depend on your available time.

---

## 1. Delivery order and why

```mermaid
flowchart LR
    P1["1 Planning<br/>docs"] --> P2["2 Foundation and<br/>hosting validation"]
    P2 --> P3["3 Authentication<br/>+ first deployment"]
    P3 --> P4["4 Tenancy core"]
    P4 --> P5["5 Members and<br/>invitations"]
    P5 --> P6["6 Projects"]
    P6 --> P7["7 Tasks and<br/>Kanban"]
    P7 --> P8["8 Comments and<br/>activity"]
    P8 --> P9["9 Notifications"]
    P9 --> P10["10 Dashboard<br/>and reports"]
    P10 --> P11["11 Hardening"]
    P11 --> P12["12 Release"]
```

Two choices in this order are deliberate:

- **Free hosting is validated in Phase 2, and deployment happens at Phase 3, not at the end.** Session cookies, CSRF and proxies behave differently on real HTTPS hosting, and free plans have limits that only show on real accounts. Finding that early is far cheaper.
- **Tenancy comes before any business feature.** Adding tenant isolation to existing features is where leaks are born. The isolation test harness exists before the first project is created.

---

## 2. Phases

### Phase 2: Foundation and hosting validation (M)

**Branches:** `chore/project-foundation`, then `chore/hosting-validation`

- Repository layout, `.gitignore`, and a corrected README. *The current README is UTF-16 encoded, so Git treats it as binary. It needs re-saving as UTF-8 so it displays and diffs properly.*
- Laravel API scaffold with Sanctum, and React/Vite/Tailwind scaffold.
- Local environment, following [environment parity](02-system-architecture.md#local-development-on-windows):
  - PHP 8.3 from Laragon, with `pdo_pgsql` and `pgsql` enabled. **`php` isn't currently on your terminal's PATH, so that needs fixing first.**
  - PostgreSQL 18 from the official EDB Windows installer, which includes pgAdmin.
- `.env.example` files, health endpoint, error format, request ID, Pint, ESLint and Prettier.
- Vite proxy, so local development is same-origin.
- CI: backend on PostgreSQL 18, and frontend jobs.
- **First, the proxy validation check** (P1–P7 in [the architecture document](02-system-architecture.md#what-isnt-verified-yet)): a minimal Laravel service behind a Render static site. If it fails, you choose a fallback before Phase 3.
- `backend/Dockerfile`, Render static site configuration, and GitHub Actions workflows with deploy hooks for each service.
- **You** create free Render and Neon accounts, both in the same region. No secrets ever go in the repository, and they're entered only in provider settings.
- Run the checks in [hosting validation](02-system-architecture.md#phase-2-hosting-validation) that don't need authentication.

**Exit:** a fresh clone runs by following the README, the SPA shows the API health status on the live platform URL, CI is green, and each validation result is recorded. If a check fails, the documented fallback is agreed with you before Phase 3.

**Learning:** monorepo structure, `.env` handling, GitHub Actions, Docker, reverse proxies, origins and the Public Suffix List, PostgreSQL basics and TLS certificate verification.

### Phase 3: Authentication and first deployment (M)

**Branches:** `feature/authentication`, then `chore/first-deployment`

- Register, verify email, login, logout, reset password, profile.
- CSRF and session cookie flow, rate limits, frontend auth pages and protected routes.
- Deploy both services (D7): the frontend forwards to the backend, and migrations run from GitHub Actions before the backend deploys.
- Demo mode: reserved-domain rule and demo mailbox (D13).
- Complete the remaining hosting validation: real cookie flow, client IP and the demo mailbox.

**Exit:** all authentication tests pass, including the real cookie flow, login works on the live URL, and registration with verification works through the demo mailbox.

**Learning:** sessions versus tokens, cookies, CSRF, CORS and why the proxy avoids it, `SameSite`, the Public Suffix List, trusted proxies, signed URLs, HTTPS deployment.

### Phase 4: Tenancy core (M) — the most important phase

**Branch:** `feature/workspace-tenancy`

- `workspaces` and `workspace_members`.
- `TenantContext`, `ResolveWorkspace`, `BelongsToWorkspace`, the fail-closed scope, and middleware priority.
- Create, list and view workspaces; workspace switcher; onboarding.
- Isolation harness and guard tests, `TwoTenantWorld` fixture, architecture tests.

**Exit:** Part B and Part D of the isolation suite are active. A temporary test model demonstrates the 404 behaviour across tenants.

**Learning:** global scopes, middleware order, route model binding, failing closed.

### Phase 5: Members and invitations (M)

**Branch:** `feature/workspace-members-invitations`

- Member list, role changes, removal, leaving, last-Administrator protection.
- Invitation lifecycle, emails through Laravel's mail system (the demo mailbox on the demo), accept flow for new and existing users.
- Team pages.

**Exit:** two real browser sessions complete the invite flow, and all invitation security tests pass.

**Learning:** token hashing, transactions, row locks, queues, partial unique indexes, PostgreSQL transaction errors.

### Phase 6: Projects (M)

**Branch:** `feature/projects`

- Project CRUD, archive, project members, composite FKs.
- `ProjectPolicy`, `ProjectAccess`, the `can` object.
- Project list and detail pages.

**Exit:** the project rows of the matrix have passing tests, and project routes are in the isolation table.

**Learning:** composite foreign keys, policies, API resources.

### Phase 7: Tasks and Kanban (L)

Split into two branches, so each pull request stays reviewable.

**Branch:** `feature/tasks`: task CRUD, assignment, list view, filters, search, my tasks.
**Branch:** `feature/kanban-board`: move endpoint, positions, board with dnd-kit, keyboard alternative, optimistic updates, mobile view.

**Exit:** a task can be taken through the complete workflow under D3's rules, using only the keyboard if needed.

**Learning:** query optimisation with composite indexes, optimistic UI, accessible drag and drop.

### Phase 8: Comments and activity (M)

**Branches:** `feature/task-comments`, `feature/activity-history`

- Comments with edit and soft delete, and the XSS tests.
- `ActivityLogger` wired into existing actions, including those from earlier phases.
- History on tasks and projects, and the workspace feed.

**Exit:** every action listed in FR-G1 records an entry in the same transaction, with no feed leaks.

**Learning:** audit design, polymorphic relations, transaction boundaries.

### Phase 9: Notifications (S–M)

**Branch:** `feature/notifications`

- Custom notification storage, created after commit without a queue worker (ADR-11), the events in FR-G4.
- Bell, list, mark-read, per-workspace unread count, polling.

**Exit:** the right people are notified, and removed members lose access to old notifications.

**Learning:** after-commit events, queues and why V1 doesn't need a worker, polling.

### Phase 10: Dashboard and reports (M)

**Branch:** `feature/dashboard-reports`

- Metric queries, time zone handling, workspace dashboard and project report, seed data for performance checks.

**Exit:** values match hand-calculated test fixtures, the performance targets are met on the seeded dataset, and data is limited to visible projects.

**Learning:** aggregate queries, `EXPLAIN`, indexes.

### Phase 11: Hardening (M)

**Branch:** `chore/release-hardening`

- Accessibility pass, responsive review, Playwright flows.
- Security checklist review, headers and CSP, dependency audit.
- **Rebuild rehearsal** from empty, dump restored to a separate database, log review.
- Hosting runbook: wake-up, Neon compute-hour usage, re-enabling scheduled workflows, rebuilding data, switching to the fallback database.

**Exit:** every criterion in [requirements, section 7](01-product-requirements.md#7-acceptance-criteria-for-the-first-release) passes.

### Phase 12: Release (S)

**Branch:** `chore/v1-release`

- Demo accounts and seed data, nightly reset through GitHub Actions, demo banner, and mail disabled for demo accounts.
- README for recruiters: screenshots or short video, live link, demo logins, limitations, architecture summary, how to run the tests.
- Tag `v1.0.0`.

### After V1: only if commercial use becomes likely

Move to a custom domain and paid hosting, split the worker, add real backups and monitoring, and build the V1.1 deletion features. See the [upgrade path](02-system-architecture.md#moving-to-a-custom-domain-later). **Nothing here is committed or budgeted now.**

---

## 3. Git and GitHub workflow

**You perform Git operations yourself as part of your learning. I will not create, switch, rename or delete branches, or run commits, pushes, pulls, merges or anything else that changes the repository or remote.** At each point where one is needed, I'll recommend the branch, give you the exact PowerShell commands, explain what each does, then wait for you to confirm before continuing with dependent work. I may run read-only commands such as `git status`, `git log` and `git diff`. I'll run a Git operation only if you explicitly authorise that particular operation.

### Branch names

| Prefix | Use | Example |
|---|---|---|
| `feature/` | New functionality | `feature/kanban-board` |
| `fix/` | Bug fix | `fix/overdue-timezone` |
| `chore/` | Tooling, setup, deployment | `chore/project-foundation` |
| `docs/` | Documentation only | `docs/phase-1-architecture` |

### Standard cycle for a feature

```powershell
# 1. Move to main and update it from GitHub, so the branch starts from the latest code
git switch main
git pull origin main

# 2. Create the branch and move onto it
git switch -c feature/projects

# 3. See what changed, and review the actual differences before staging
git status
git diff

# 4. Stage specific paths. Reviewing what you stage helps keep secrets out of commits
git add backend/app/Models/Project.php

# 5. Save a snapshot on your local branch
git commit -m "feat(projects): add project model and policy"

# 6. Publish the branch. -u links it to GitHub, so later a plain git push works
git push -u origin feature/projects
```

Then open a pull request on GitHub, or use `gh pr create`. Check that CI has passed, review your own diff, and merge.

```powershell
# 7. After merging on GitHub, update main and delete the finished local branch
git switch main
git pull origin main
git branch -d feature/projects
```

`-d` refuses to delete unmerged work, which makes it safer than `-D`. Squash merges can make Git consider a branch unmerged, so confirm the pull request merged on GitHub before using `-D` in that case.

### Commit messages

Conventional Commits: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, with an optional area. Example: `fix(tasks): compute overdue in workspace time zone`. Make small commits, each with one purpose.

### Protecting `main`

Set this up yourself on GitHub, under **Settings → Branches**, once CI exists at Phase 2:

- Require a pull request before merging.
- Require CI status checks to pass.
- Block force pushes.

**Merge method:** I recommend **Squash and merge**, which gives `main` one clear commit per feature, and is easy for a recruiter to read. Enable GitHub's secret scanning and Dependabot alerts too, particularly if the repository is public.

---

## 4. Definition of done

A pull request can merge when:

1. Its scope matches one branch purpose and is small enough to review.
2. Tests from [the testing strategy, section 9](06-testing-strategy.md#9-acceptance-criteria-for-tests) are in place and CI passes.
3. Documentation is updated if behaviour or a decision changed.
4. No secrets, debug output or commented-out code are in the diff.
5. **You can explain what changed and why.**

---

## 5. Learning requirements

This project is also how you build your engineering knowledge, so finishing a feature without understanding it doesn't count as done.

**Whenever an important concept, technology, decision or pattern is introduced, I will explain:**

1. What it is.
2. What problem it solves.
3. Why WorkFlow uses it.
4. What alternatives exist.
5. The advantages and disadvantages of those alternatives.
6. A practical example from WorkFlow.
7. How you could explain and defend the decision in a technical interview.

**Working rules**

- Explanations use WorkFlow's own code and data, not only abstract definitions.
- No technical term is assumed to be understood just because you've used the technology.
- I won't simply implement a feature and report it complete. Each phase ends by walking you through what changed and why.
- Test explanations cover what each test verifies, why it matters, and how to read the result.

**Explanations planned by area**

| Area | Topics |
|---|---|
| Database | Foreign keys, one-to-many and many-to-many relationships, composite keys, indexes including partial and expression indexes, transactions, locks, PostgreSQL versus MySQL |
| API | REST, HTTP methods, status codes, request validation, response design, authentication |
| Authentication | Sessions, cookies, CSRF, CORS, origins and sites, how Sanctum works |
| Tenant isolation | The security risks, and how the protection layers work together |
| Authorisation | Roles, policies, and two-layer permissions |
| Testing | What each test proves, feature versus unit tests, reading failures |
| Frontend | Routing, server state, forms, accessibility |
| Deployment | Docker, reverse proxies, environment variables, migrations, free-tier limitations |

---

## 6. Immediately after Phase 1 approval

1. D1–D11 are recorded as confirmed, and you approve or change D12 and D13, in [the requirements](01-product-requirements.md#2-confirmed-decisions).
2. You commit these revisions on `docs/phase-1-architecture`, push them, and merge the pull request.
3. You confirm, and I give you the commands for the Phase 2 branch, `chore/project-foundation`.
4. You create the branch and confirm.
5. Phase 2 begins only after your explicit approval.
