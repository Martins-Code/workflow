# 05 — API Specification

**Status:** Revised, awaiting final approval · **Date:** 2026-11-05 · **Base URL:** `/api/v1`, on the same origin as the SPA

This is the V1 API contract. Permission names refer to the [permissions matrix](04-permissions-matrix.md). On the demo, the full URL is `https://<service>.onrender.com/api/v1`. The contract doesn't change if the API later moves to its own hostname.

---

## 1. Conventions

- **Format:** JSON. Clients send `Accept: application/json`.
- **Authentication:** Sanctum session cookie, plus an `X-XSRF-TOKEN` header on `POST`, `PUT`, `PATCH` and `DELETE`. On the demo, no CORS is involved, as the SPA and API share one origin.
- **Health check:** `GET /up` (outside `/api/v1`) reports whether the application is running.
- **Demo availability:** after idle time, the first request can take about a minute and may receive a non-JSON platform page. The SPA handles this as "waking up". It isn't part of the API contract.
- **Dates:** `YYYY-MM-DD` for calendar dates. ISO 8601 UTC for timestamps.
- **Versioning:** `/api/v1`. Breaking changes require `/v2`.
- **Pagination:** `?page=2&per_page=25`, with a maximum `per_page` of 100.
- **Filtering and sorting:** `?status=todo&assignee=me&q=login&sort=-due_date`. Only documented fields are accepted. Anything else returns 422.
- **Writes:** only fields validated by the Form Request are used. Other input fields are ignored.

### How the active workspace is identified and validated

Tenant routes all start with `/workspaces/{slug}`. For every such request:

1. `auth:sanctum` confirms who the user is, or returns 401.
2. `ResolveWorkspace` finds the workspace by slug and the user's membership, or returns **404**.
3. `TenantContext` stores the workspace and the user's role for this request only.
4. Child records in the URL are resolved within that workspace, or return **404**.
5. The policy checks the role, returning 403 or 404.

The server doesn't remember a selected workspace between requests. No request body or header can override the workspace.

### Response format

**Single resource**

```json
{
  "data": {
    "id": 12,
    "name": "Website Redesign",
    "can": { "update": true, "archive": true, "manage_members": true, "create_task": true }
  }
}
```

**Collection**

```json
{
  "data": [{ "id": 12, "name": "Website Redesign" }],
  "meta": { "current_page": 1, "per_page": 25, "total": 1, "last_page": 1 },
  "links": { "next": null, "prev": null }
}
```

**Error**

```json
{
  "message": "The given data was invalid.",
  "code": "validation_failed",
  "errors": { "due_date": ["The due date must be after the start date."] },
  "request_id": "01JABCXYZ"
}
```

`errors` appears only on 422. `code` is stable for programs to use, while `message` is for people. Stack traces never appear in production.

### Status codes

| Code | `code` value | When |
|---|---|---|
| 200 / 201 / 204 | | Success / created / success with no body |
| 400 | `bad_request` | Malformed request |
| 401 | `unauthenticated` | No valid session |
| 403 | `forbidden` | Authenticated and may see the resource, but may not perform this action |
| 403 | `email_not_verified` | The action requires a verified email |
| 403 | `demo_restricted` | A seeded demo account attempted a restricted action |
| 403 | `registration_disabled` | Public registration is off because the email fallback is active |
| 404 | `not_found` | Doesn't exist, **or the user isn't allowed to know that it exists** |
| 409 | `last_administrator`, `project_archived`, `last_project_manager`, `already_member`, `invitation_pending` | Valid request that conflicts with current state |
| 410 | `invitation_invalid` | Token expired, revoked or already used |
| 419 | `csrf_mismatch` | Missing or expired CSRF token |
| 422 | `validation_failed` | Input validation errors |
| 429 | `rate_limited` | Too many requests. Includes `Retry-After` |
| 500 | `server_error` | Unexpected error. A generic message with `request_id` |

---

## 2. Authentication

| Method | Endpoint | Purpose | Auth | Limit |
|---|---|---|---|---|
| GET | `/sanctum/csrf-cookie` (outside `/api/v1`) | Set the CSRF cookie | Public | |
| POST | `/auth/register` | Create an account | Guest | 5/hour per IP |
| POST | `/auth/login` | Start a session | Guest | 5/min per email + IP |
| POST | `/auth/logout` | End the session | User | |
| POST | `/auth/forgot-password` | Email a reset link | Guest | 3/hour per email + IP |
| POST | `/auth/reset-password` | Set a new password | Guest | 5/hour per IP |
| GET | `/auth/email/verify/{id}/{hash}` | Confirm email through a signed link, then redirect to the SPA | Signed URL | |
| POST | `/auth/email/resend` | Resend verification | User | 3/hour per user |
| GET | `/me` | Current user and workspaces | User | |
| PATCH | `/me` | Update profile | User | |
| PUT | `/me/password` | Change password | User | 5/hour per user |
| GET | `/me/notifications/summary` | Unread count per workspace | User | |

### `POST /auth/login`

```json
// Request
{ "email": "ada@example.com", "password": "..." }

// 200: the session cookie is set
{
  "data": {
    "user": { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "email_verified": true },
    "workspaces": [
      { "slug": "acme", "name": "Acme Ltd", "role": "administrator", "last_accessed_at": "2026-11-05T09:12:00Z" }
    ]
  }
}
```

**Errors:** 422 with the same message for a wrong password or an unknown email; 419; 429.

### `POST /auth/forgot-password`

Always returns **200** with the same message, whether or not the account exists.

---

## 3. Workspaces and members

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces` | My workspaces | User |
| POST | `/workspaces` | Create a workspace | Verified user (5/hour) |
| GET | `/workspaces/{slug}` | Details, my role and `can` | Member |
| PATCH | `/workspaces/{slug}` | Update settings | Administrator |
| GET | `/workspaces/{slug}/members` | List members | Member |
| PATCH | `/workspaces/{slug}/members/{id}` | Change role | Administrator |
| DELETE | `/workspaces/{slug}/members/{id}` | Remove member | Administrator |
| POST | `/workspaces/{slug}/leave` | Leave | Member |
| GET | `/workspaces/{slug}/members/{id}/tasks` | Assignments visible to the viewer | Member, filtered |

### `POST /workspaces`

```json
// Request
{ "name": "Acme Ltd", "timezone": "Europe/London" }

// 201
{
  "data": {
    "slug": "acme-ltd",
    "name": "Acme Ltd",
    "timezone": "Europe/London",
    "my_role": "administrator",
    "can": { "update": true, "invite": true, "create_project": true }
  }
}
```

**Errors:** 401; 403 `email_not_verified`; 422; 429.

### `PATCH /workspaces/{slug}/members/{id}`

```json
// Request
{ "role": "project_manager" }

// 200
{ "data": { "id": 7, "user": { "id": 3, "name": "Grace Hopper" }, "role": "project_manager" } }
```

**Errors:** 403 not an Administrator; 404 not a member of this workspace or the workspace isn't accessible; 409 `last_administrator`; 422 unknown role.

---

## 4. Invitations

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces/{slug}/invitations` | List | Administrator |
| POST | `/workspaces/{slug}/invitations` | Invite | Administrator (20/hour per workspace) |
| POST | `/workspaces/{slug}/invitations/{id}/resend` | New token, new expiry | Administrator |
| DELETE | `/workspaces/{slug}/invitations/{id}` | Revoke | Administrator |
| POST | `/invitations/lookup` | Preview from a token | Public (10/min per IP) |
| POST | `/invitations/accept` | Accept | See flow below |

Tokens travel in the request **body**, and in the frontend link's URL **fragment** (`/invitations/accept#token=...`). Browsers don't send fragments to servers or in `Referer`, so tokens stay out of access logs.

### `POST /workspaces/{slug}/invitations`

```json
// Request
{ "email": "new.person@example.com", "role": "member" }

// 201: the raw token is emailed and never returned by the API
{
  "data": {
    "id": 44,
    "email": "new.person@example.com",
    "role": "member",
    "status": "pending",
    "expires_at": "2026-11-12T10:00:00Z"
  }
}
```

**Errors:** 403, including `demo_restricted`; 409 `already_member`; 409 `invitation_pending`; 422; 429.

### Accept flow

| Situation | Behaviour |
|---|---|
| Signed in, verified email matches | `POST /invitations/accept` with `{ "token": "..." }` creates the membership and returns 200 with the workspace |
| Signed in, email differs | 403 `forbidden`. The UI suggests switching account |
| Not signed in, account exists | The SPA sends the user to log in, then retries |
| No account | Register with the invited email fixed, sending the token too. Holding the token proves mailbox access, so the email is marked verified |
| Token expired, revoked or used | 410 `invitation_invalid` |
| Already a member | 409 `already_member` |

`lookup` returns only the workspace name, inviter's name, invited email and role, and only for a valid token.

Acceptance locks the invitation row in a transaction. It reads the role from that row and ignores any role in the request.

---

## 5. Projects and project members

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces/{slug}/projects` | List visible projects | Member, filtered |
| POST | `/workspaces/{slug}/projects` | Create | Administrator or PM |
| GET | `/workspaces/{slug}/projects/{id}` | Detail and progress | Project access |
| PATCH | `/workspaces/{slug}/projects/{id}` | Update | Manager |
| POST | `/workspaces/{slug}/projects/{id}/archive` | Archive | Manager |
| POST | `/workspaces/{slug}/projects/{id}/unarchive` | Unarchive | Manager |
| GET | `/workspaces/{slug}/projects/{id}/members` | List | Project access |
| POST | `/workspaces/{slug}/projects/{id}/members` | Add | Manager |
| PATCH | `/workspaces/{slug}/projects/{id}/members/{userId}` | Change project role | Manager |
| DELETE | `/workspaces/{slug}/projects/{id}/members/{userId}` | Remove | Manager |

**List filters:** `status`, `priority`, `archived` (default false), `q`, `sort` (`name`, `due_date`, `created_at`).

### `POST /workspaces/{slug}/projects`

```json
// Request
{
  "name": "Website Redesign",
  "description": "Replace the marketing site.",
  "status": "planning",
  "priority": "high",
  "start_date": "2026-11-10",
  "due_date": "2027-02-01"
}

// 201
{
  "data": {
    "id": 12,
    "name": "Website Redesign",
    "status": "planning",
    "priority": "high",
    "start_date": "2026-11-10",
    "due_date": "2027-02-01",
    "archived_at": null,
    "progress": { "total_tasks": 0, "completed_tasks": 0, "percentage": null },
    "my_access": "manager",
    "can": { "update": true, "archive": true, "manage_members": true, "create_task": true }
  }
}
```

**Errors:** 403 Team Member; 404 not a member; 422 such as `due_date` before `start_date`.

### `POST /workspaces/{slug}/projects/{id}/members`

```json
// Request
{ "user_id": 3, "role": "contributor" }

// 201
{ "data": { "user": { "id": 3, "name": "Grace Hopper" }, "role": "contributor" } }
```

**Errors:** 403; 404 project not visible; 409 `project_archived`; 409 `already_member`; 422 when `user_id` isn't a member of **this** workspace, or a Team Member is proposed as `manager`.

The 422 message is the same for a nonexistent user and a user in another workspace, so the endpoint can't be used to discover other tenants' users.

---

## 6. Tasks

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces/{slug}/tasks` | Across visible projects, such as `?assignee=me` | Member, filtered |
| GET | `/workspaces/{slug}/projects/{id}/tasks` | List with filters | Project access |
| GET | `/workspaces/{slug}/projects/{id}/board` | Tasks grouped by status | Project access |
| POST | `/workspaces/{slug}/projects/{id}/tasks` | Create | Manager |
| GET | `/workspaces/{slug}/tasks/{id}` | Detail | Project access |
| PATCH | `/workspaces/{slug}/tasks/{id}` | Edit details and assignee | Manager |
| PATCH | `/workspaces/{slug}/tasks/{id}/move` | Change status and/or position | Manager, or assignee within limits |
| DELETE | `/workspaces/{slug}/tasks/{id}` | Soft delete | Manager |
| POST | `/workspaces/{slug}/tasks/{id}/restore` | Restore | Manager |

**List filters:** `status`, `priority`, `assignee` (a user ID, `me` or `none`), `due_before`, `due_after`, `overdue`, `q`, `sort` (`due_date`, `priority`, `created_at`, `updated_at`).

### `POST /workspaces/{slug}/projects/{id}/tasks`

```json
// Request
{
  "title": "Design the login page",
  "description": "Include error states.",
  "priority": "medium",
  "due_date": "2026-11-20",
  "assignee_id": 3
}

// 201
{
  "data": {
    "id": 301,
    "project_id": 12,
    "title": "Design the login page",
    "status": "todo",
    "priority": "medium",
    "position": 65536,
    "due_date": "2026-11-20",
    "is_overdue": false,
    "assignee": { "id": 3, "name": "Grace Hopper" },
    "can": { "update": true, "change_status": true, "delete": true, "comment": true }
  }
}
```

**Errors:** 403 contributor; 404; 409 `project_archived`; 422, including when `assignee_id` isn't a member of **this project**.

### `PATCH /workspaces/{slug}/tasks/{id}/move`

The endpoint behind Kanban. The server calculates the position from neighbouring cards, so a client can't supply arbitrary positions.

```json
// Request: move to In Review, between two cards. Either neighbour may be null.
{ "status": "in_review", "after_task_id": 288, "before_task_id": 295 }

// 200
{ "data": { "id": 301, "status": "in_review", "position": 131072, "completed_at": null } }
```

**Errors:**

- 403: contributor moving someone else's task, moving to Completed, or moving out of Completed.
- 404: task not visible.
- 409: `project_archived`.
- 422: unknown status, or a neighbouring task from another column or project.

Concurrent moves resolve as last write wins, and the board refetches afterwards.

---

## 7. Comments

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces/{slug}/tasks/{id}/comments` | List | Project access |
| POST | `/workspaces/{slug}/tasks/{id}/comments` | Add | Project access |
| PATCH | `/workspaces/{slug}/comments/{id}` | Edit | Author |
| DELETE | `/workspaces/{slug}/comments/{id}` | Soft delete | Author or Manager |

### `POST /workspaces/{slug}/tasks/{id}/comments`

```json
// Request
{ "body": "I've pushed the first draft." }

// 201
{
  "data": {
    "id": 900,
    "body": "I've pushed the first draft.",
    "author": { "id": 3, "name": "Grace Hopper" },
    "edited_at": null,
    "created_at": "2026-11-05T10:15:00Z",
    "can": { "update": true, "delete": true }
  }
}
```

**Errors:** 404; 409 `project_archived`; 422 empty or over 5,000 characters.

---

## 8. Notifications

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces/{slug}/notifications` | My notifications, `?unread=true` | Member, own only |
| POST | `/workspaces/{slug}/notifications/{id}/read` | Mark read | Owner |
| POST | `/workspaces/{slug}/notifications/read-all` | Mark all read | Member, own only |

Another user's notification ID returns 404.

```json
{
  "data": [{
    "id": 77,
    "type": "task.assigned",
    "title": "Ada assigned you a task",
    "body": "Design the login page",
    "target": { "kind": "task", "id": 301 },
    "read_at": null,
    "created_at": "2026-11-05T10:00:00Z"
  }],
  "meta": { "current_page": 1, "per_page": 25, "total": 1, "last_page": 1, "unread_count": 1 },
  "links": { "next": null, "prev": null }
}
```

---

## 9. Dashboard, reports and activity

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/workspaces/{slug}/dashboard` | Metrics for visible projects | Member, filtered |
| GET | `/workspaces/{slug}/reports/projects` | Project comparison | Administrator (all), PM (managed) |
| GET | `/workspaces/{slug}/projects/{id}/report` | Project report | Manager |
| GET | `/workspaces/{slug}/activity` | Feed | Member, filtered |
| GET | `/workspaces/{slug}/projects/{id}/activity` | Project history | Project access |
| GET | `/workspaces/{slug}/tasks/{id}/activity` | Task history | Project access |

### `GET /workspaces/{slug}/dashboard`

```json
{
  "data": {
    "projects": { "total": 8, "active": 5, "completed": 2 },
    "tasks": { "pending": 42, "overdue": 3, "completed": 95, "completion_rate": 69.3 },
    "project_progress": [{ "id": 12, "name": "Website Redesign", "percentage": 40.0 }],
    "scope": "accessible_projects",
    "as_of_date": "2026-11-05",
    "timezone": "Europe/London"
  }
}
```

Definitions are in [the requirements, section 6](01-product-requirements.md#6-metric-definitions). `completion_rate` is `null` when there are no tasks. Recent activity comes from the activity endpoint, so a slow query in one can't delay the other.

### Activity entry

```json
{
  "id": 5001,
  "action": "task.status_changed",
  "actor": { "id": 3, "name": "Grace Hopper" },
  "subject": { "type": "task", "id": 301, "label": "Design the login page" },
  "changes": { "status": { "from": "in_progress", "to": "in_review" } },
  "created_at": "2026-11-05T10:20:00Z"
}
```

The activity feed is read-only. There are no create, update or delete endpoints.

---

## 10. Cross-tenant behaviour examples

User Ada belongs only to `acme`. Project 99 belongs to `globex`.

| Request | Result | Stopped by |
|---|---|---|
| `GET /workspaces/globex` | 404 | Membership check |
| `GET /workspaces/globex/projects/99` | 404 | Membership check |
| `GET /workspaces/acme/projects/99` | 404 | Global scope and binding |
| `POST /workspaces/acme/projects/12/tasks` with `assignee_id` from globex | 422 | Scoped validation, then the composite FK |
| `PATCH /workspaces/acme/projects/12` with `"workspace_id": 2` in the body | 200, value ignored | Input whitelist |
| `POST /workspaces/acme/projects/12/members` with a user from globex | 422 | Scoped validation, then the composite FK |
| A Team Member in `acme` requests a project they're not on | 404 | Project policy |
