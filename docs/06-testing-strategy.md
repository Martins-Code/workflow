# 06 — Testing Strategy

**Status:** Draft for review · **Date:** 2026-11-05

---

## 1. Principles

1. **Security rules get written as tests first.** Tenant isolation and permissions are specified as tests before or alongside the feature, never added later.
2. **Most confidence comes from API feature tests.** They exercise routing, middleware, validation, policies and the database together, which is where this application's risk sits.
3. **Tests run on MySQL, not SQLite.** Composite foreign keys, generated columns, `CHECK` constraints and locking are central to the design and differ between engines.
4. **Guard tests catch what people forget.** A new route should fail CI automatically until it has isolation coverage.
5. **A passing test suite doesn't prove the system is secure.** It proves the listed scenarios behave as specified.

---

## 2. Tools and organisation

| Level | Tool | What it covers | Approx. share |
|---|---|---|---|
| Unit | Pest | Position calculation, status rules, metric calculations | 15% |
| Feature and API | Pest with Laravel's HTTP helpers | Endpoints from middleware to database | 60% |
| Architecture | Pest `arch()` | Banned patterns, structural rules | Small, high value |
| Frontend component and integration | Vitest, React Testing Library, MSW | Forms, states, role-based display, API error handling | 20% |
| End to end | Playwright | Three smoke flows through the real stack | 5% |

**Why Pest:** Laravel's default test tool, with data-driven tests and built-in architecture tests, both of which suit this project. The ideas transfer directly to PHPUnit, which Pest runs on.

```
backend/tests/
├── Unit/
├── Feature/
│   ├── Auth/
│   ├── Workspaces/
│   ├── Invitations/
│   ├── Projects/
│   ├── Tasks/
│   ├── Comments/
│   ├── Notifications/
│   └── Reports/
├── Tenancy/          Isolation suite and database constraint tests
├── Authorization/    Permission matrix tests
└── Architecture/     Banned-pattern rules

frontend/src/features/**/__tests__/   Next to the feature they test
e2e/                                  Playwright flows
```

**Fixtures:** a shared `TwoTenantWorld` helper creates workspaces A and B, each with users in every role, projects, tasks, comments and notifications. **Isolation and authorisation tests always run with a second tenant holding similar data**, as a bug can't appear in a world containing only one tenant.

---

## 3. Coverage by test type

### Unit

- Position midpoint, first and last positions, and when rebalance triggers.
- Overdue calculation at the midnight boundary in different time zones.
- Completion rate with zero tasks returns `null`.
- Which status transitions a contributor may make.

### Authentication

| Scenario | Expected |
|---|---|
| Login with correct credentials | 200, session established |
| Wrong password versus unknown email | Identical response |
| Sixth login attempt in a minute | 429 |
| Request after logout | 401 |
| **Real cookie flow: CSRF cookie, then login, then a write, without `actingAs`** | Succeeds |
| **Write without a CSRF token using a session cookie** | 419 |
| Session ID before and after login | Differs |
| Password reset | Old password fails, and other sessions end |
| Reset token reused or expired | Rejected |
| Forgot password for an unknown email | Same response as a known email |
| Unverified user creates a workspace | 403 `email_not_verified` |
| Tampered or expired verification link | Rejected |

### Invitations

| Scenario | Expected |
|---|---|
| Raw token in the database | Absent, only the hash |
| Raw token in API responses | Absent |
| Expired, revoked or already-used token | 410 |
| Token accepted by a differently emailed account | 403 |
| Role changed in the accept request | Ignored |
| Same token accepted twice | Exactly one membership, second call rejected |
| Invite someone already a member | 409 |
| Re-invite after expiry | Old token stops working |

### Validation

For each write endpoint, a dataset covering missing required fields, wrong types, over-long strings, unknown enum values, invalid date order, and unknown filter or sort fields. All return 422 with errors under the correct field.

**Hostile input:**

- SQL fragments in `q` and `sort`: treated as text, or 422.
- `%` and `_` in search: matched literally.
- `<script>` in comments: stored as text, returned unchanged, and rendered inert by the frontend (a frontend test verifies this).

### Business rules

- Removing a member with tasks, including soft-deleted ones, unassigns them and keeps their comments.
- The last Administrator can't be removed or demoted, and can't leave.
- PM demotion downgrades their manager roles.
- Archived projects reject all writes except unarchive, **including from Administrators**.
- Changes and activity records commit or roll back together.
- Notifications are sent only to the right people, and not to the actor.
- Members can't reach a Completed task through any route except those allowed.

### Performance guard

List endpoints run with `preventLazyLoading` enabled, and key endpoints assert a query count that doesn't grow with the number of rows.

---

## 4. Multi-tenant isolation suite

This is the most important suite in the project. It has four parts.

### Part A: route-driven cross-tenant tests

A table lists every workspace route. For each, a user from Workspace A attempts access in three ways:

| Attempt | Example | Expected |
|---|---|---|
| Other tenant's slug | `GET /workspaces/b-slug/projects/{b-project}` | 404 |
| Own slug, other tenant's child ID | `GET /workspaces/a-slug/projects/{b-project}` | 404 |
| Own slug, other tenant's ID in the body | `POST ...tasks` with a `b-user` as assignee | 422 |

Each attempt also asserts two more things: **the response body contains nothing from Workspace B**, and **for writes, Workspace B's data is unchanged**.

**Your scenario is a named test in this part:** *a user belonging to Workspace A cannot retrieve a project belonging to Workspace B by changing the project ID in an API request.*

The 404 body must also be **identical** to the response for an ID that doesn't exist, so a response can't confirm that a record exists elsewhere.

### Part B: guard tests

| Guard | Fails when |
|---|---|
| Route coverage | A route containing `{workspace}` isn't listed in the Part A table |
| Middleware presence | A workspace route lacks `auth:sanctum` or `ResolveWorkspace` |
| Schema coverage | A table with neither `workspace_id` nor an explicit entry on the global-table allow-list exists |
| Model coverage | A model with a `workspace_id` column lacks the `BelongsToWorkspace` trait |

### Part C: database constraint tests

Using direct inserts, bypassing the application, the database must reject:

- a task whose `workspace_id` differs from its project's,
- a project member who isn't in that workspace,
- a task assignee who isn't on that project,
- a comment whose `workspace_id` differs from its task's,
- a notification for a person not in that workspace,
- duplicate memberships.

### Part D: failure and non-HTTP paths

- A tenant model queried with no `TenantContext` **throws an exception**.
- A queued job runs under the workspace it was dispatched for and doesn't inherit another's context.
- Two consecutive jobs for different tenants don't leak context.
- Cached values for Workspace A are not returned for Workspace B.
- Data aggregated by reports, the dashboard and activity feeds contains only the current tenant's data.
- Middleware order: a test proves the tenant is resolved before route model binding.

---

## 5. Authorisation matrix tests

Each row in the [permissions matrix](04-permissions-matrix.md) becomes a data-driven case:

```php
// Illustrative
dataset('project_update', [
    'administrator'             => ['administrator', null,          200],
    'pm managing the project'   => ['project_manager', 'manager',   200],
    'pm contributing'           => ['project_manager', 'contributor', 403],
    'pm not on the project'     => ['project_manager', null,        404],
    'member contributing'       => ['member', 'contributor',        403],
    'member not on the project' => ['member', null,                 404],
]);
```

**Read-model leak tests** verify that a user not on Project X can't see any trace of it in project lists, the dashboard totals, the activity feed, task search, an individual's assignment view, or notifications.

**`can` consistency tests:** the `can` flags in a response match what actually happens when that action is attempted.

**Architecture rules:**

- No `DB::table()` on tenant tables outside the reporting namespace.
- No `withoutGlobalScopes()` outside the tenancy module.
- No `$request->all()` in controllers or actions.
- Models don't use `$guarded = []`.

---

## 6. Frontend tests

| Area | Example scenarios |
|---|---|
| Forms | Required-field feedback; a 422 response appears on the correct fields; submit disabled while saving |
| States | Each list renders its loading, empty, error and populated states |
| Role-based display | Controls follow the `can` object, for example no "Archive" when `archive` is false |
| Routing | Guest redirected to login with a return URL; an unknown workspace shows not-found |
| Session errors | 401 redirects; 419 refreshes the CSRF cookie and retries once |
| Workspace cache | Switching workspace never shows the previous workspace's data, even briefly. Logout clears the cache |
| Kanban | Failed move reverts with a message; keyboard alternative changes status |
| XSS | A comment containing `<img onerror=...>` renders as text |
| Accessibility | Labels and roles asserted through Testing Library queries; `jest-axe` on main pages |

---

## 7. End-to-end smoke flows

Against a production-like build on separate origins, with real cookies.

1. **Onboarding:** register, verify, create a workspace, invite a colleague, accept the invitation from a second browser context.
2. **Delivery:** the PM creates a project and task and assigns it; the contributor moves it to In Review and sees the notification; the PM completes it; the dashboard updates.
3. **Isolation:** a user from Workspace A opens a Workspace B URL directly and sees not-found.

Backend tests can't catch cookie, CORS or CSRF misconfiguration, which is why these flows run through a real browser.

---

## 8. Continuous integration

GitHub Actions runs on every pull request to `main`.

| Job | Steps |
|---|---|
| Backend | PHP 8.3, MySQL 8.4 service, `composer audit`, Pint check, migrate from empty, full test suite |
| Frontend | Node 22, `npm audit --audit-level=high`, ESLint, Vitest, production build |
| End to end | Playwright smoke flows on pull requests to `main` |

---

## 9. Acceptance criteria for tests

### A feature is done when

- [ ] Happy path and validation failures are tested.
- [ ] Every new workspace route appears in the isolation table.
- [ ] Each role has a test for each new action, including users with no project access.
- [ ] Read-model effects are checked for leaks if the feature adds visible data.
- [ ] Frontend loading, empty and error states exist and are tested.
- [ ] CI passes, and the pull request has been reviewed by you and you can explain it.

### The release is ready when

- The full suite passes on the commit being released.
- All guard tests are active, none skipped.
- There are no `skip` or `todo` markers in the `Tenancy` or `Authorization` folders.
- Every row in the permissions matrix has a matching test.
- No high or critical unresolved dependency vulnerabilities.
- Backend coverage is at least 80%, with the tenancy module and policies at 100% of branches. **Coverage is a floor, not evidence of quality.** The matrix and isolation suites are what demonstrate the rules.

Flaky security tests are treated as defects, not retried until they pass.

**Known test limits:** true concurrency, such as two Administrators demoting each other simultaneously, is hard to reproduce in tests that run inside a transaction. Those cases get code review, unique constraints as a backstop, and a dedicated two-connection test if practical.
