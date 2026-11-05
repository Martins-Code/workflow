# 01 — Product Requirements

**Status:** Draft for review · **Date:** 2026-11-05 · **Applies to:** WorkFlow Version 1

Related: [Architecture](02-system-architecture.md) · [Database](03-database-design.md) · [Permissions](04-permissions-matrix.md) · [API](05-api-specification.md) · [Testing](06-testing-strategy.md) · [Roadmap](07-development-roadmap.md)

---

## 1. Summary

WorkFlow is a multi-tenant project and workflow management platform. Organisations each get a private **workspace** containing their members, projects, tasks, comments, notifications and activity history. One organisation must never be able to read or change another's private data.

The project also has to work as a portfolio piece. So V1 favours a small feature set built to a high engineering standard: provable tenant isolation, a tested permission model, and a real deployment. It does not try to match the feature breadth of commercial products.

### Success measures

1. A recruiter can open a live demo and understand the product within a few minutes.
2. A reviewer can read the code and find tenant isolation enforced at several layers, with automated tests proving it.
3. You can explain every major design decision in these documents and defend it in an interview.

### Users

| Persona | Workspace role | Main need |
|---|---|---|
| Operations lead | Administrator | Control who belongs to the workspace and what they can do |
| Delivery lead | Project Manager | Plan projects, assign work, see what is late |
| Contributor | Team Member | See assigned work, update status, discuss it |
| Invitee | none yet | Join a workspace safely from an emailed link |

---

## 2. Decisions that need your confirmation

The brief left these points open, or I am recommending something different from what it proposed. All seven documents **assume the recommendation**, so a different answer means revising them. Please confirm or change each one.

| ID | Question | Recommendation | Why | Cost of the alternative |
|---|---|---|---|---|
| **D1** | Is "Project Manager" a workspace-wide power or per-project? The brief lists it as a workspace role but also says "assign project managers" to a project. | **Both layers.** The workspace role grants the right to *create* projects and be *eligible* to manage them. A person manages only projects where `project_members.role = manager`. Only Administrators have automatic access to every project. | Otherwise any PM could read every project in the organisation, which makes project membership meaningless. | Workspace-wide PM access is simpler to code but removes confidentiality between projects. |
| **D2** | What can a Team Member see and change inside a project? The brief says "views assigned tasks" and also "participates in project activities". | They **view all tasks** in projects they belong to and comment on any of them. They **change status only on tasks assigned to them**. | A Kanban board showing only your own cards is not a useful board. Limiting writes keeps accountability clear. | Assigned-only visibility requires a second, filtered board and blocks collaboration. |
| **D3** | Can Team Members mark their own work Completed? | **No.** They can move their tasks between To Do, In Progress and In Review. Only a project manager or Administrator moves a task to Completed. | If the assignee can complete their own work, "In Review" has no meaning. | Free movement is simpler and suits small teams, but then "In Review" is only a label. This is a one-line policy change. |
| **D4** | One assignee per task, or several? | **One** (`tasks.assignee_id`, nullable). | Clear ownership and simpler notifications, "my tasks" and reports. | Multiple assignees need a join table and an answer to "who can complete it?". Moving to a join table later is a contained migration. |
| **D5** | How is the active workspace identified on API requests? The brief implies a selected "active" workspace. | **In the URL path:** `/api/v1/workspaces/{slug}/...`. "Active workspace" is then a frontend idea, not server session state. | A workspace stored in the session breaks when two tabs show different workspaces: a user can act on the wrong organisation's data without noticing. See ADR-03. | A header works technically but is less visible, less testable and does not fit Laravel's route binding as well. |
| **D6** | Require email verification? It is not in the brief. | **Yes, in V1.** | Without it, someone can register with another person's address before that person is invited (account pre-hijacking). | Skipping it removes one flow but leaves that attack open and makes invitation matching less trustworthy. |
| **D7** | Which hosting provider and domain? The brief says one provider but names none. | **A small Linux VPS and a purchased custom domain**, using `app.<domain>` and `api.<domain>`. | Sanctum cookie authentication needs both apps on the same registrable domain. Shared platform domains generally will not work (Risk R1 in the architecture document). Queue workers need a long-running process. | A PaaS is less operational work but may cost more. Shared hosting cannot reliably run workers. |
| **D8** | One repository or two? | **One repository** (monorepo) with `backend/` and `frontend/`, still built and deployed independently. | You already have one repo. A feature branch can contain its API and UI together, and recruiters find everything in one place. | Two repos show stricter separation but split every feature across two branches and two pull requests. |
| **D9** | Should workspaces, projects and user accounts be deletable? The brief only says "archive" for projects. | **Not in V1.** Projects archive. Tasks and comments soft-delete. Workspace and account deletion move to V1.1. | Correct deletion cascades, retention and privacy handling are a substantial feature. | Real users would need this, and **UK/EU privacy law may require account erasure in production**. It must be built before WorkFlow holds real customer data. |
| **D10** | Should descriptions and comments support rich text? | **Plain text** in V1, displayed with preserved line breaks. | Removes the largest source of stored XSS. | Markdown needs a sanitising pipeline. It is a good V1.1 feature. |
| **D11** | The brief says Administrators "manage workspace-level permissions". Does that mean configurable permissions? | **Fixed roles defined in code.** In V1 this responsibility means assigning roles and editing workspace settings. | A configurable permission editor multiplies the states you must test, with no demo value. | Custom roles would add tables, UI and a much larger test matrix. |

### Other gaps identified

These have sensible defaults and don't need a decision now, but the brief did not specify them.

| Gap | Default in this specification |
|---|---|
| Ordering of cards in a Kanban column | A `position` column, calculated by the server |
| Time zones for "overdue" | Due dates are calendar dates, evaluated in a per-workspace time zone |
| Definition of dashboard metrics | Defined in section 6 |
| Two people editing the same task | Last write wins in V1, documented as a known limitation |
| Live updates | Polling and refetch-on-focus, no WebSockets |
| Email notifications | Authentication and invitation emails only. Task events are in-app only |
| Removing a member who has assigned tasks | Their tasks become unassigned, and comment history stays attributed to them |
| Removing the last Administrator | Blocked |
| Platform-wide support or super-admin access | None in V1. Support would use audited database procedures |
| Public demo abuse | Seeded demo workspace, nightly reset, email disabled for demo accounts |

---

## 3. Functional requirements

Priority is **M** (must have for V1) or **S** (should have, may slip without failing the release).

### A. Authentication and user management

| ID | Requirement | Pri |
|---|---|---|
| FR-A1 | Register with name, email and password | M |
| FR-A2 | Verify email through a signed, expiring link (D6) | M |
| FR-A3 | Log in and log out using a secure session cookie | M |
| FR-A4 | Request a password reset and complete it with an expiring token. Doing so ends the user's other sessions | M |
| FR-A5 | View and edit own profile, and change password with the current password | M |
| FR-A6 | Login, registration and reset responses must not unnecessarily reveal whether an account exists (see the accepted limitation in the architecture document, section 7) | M |

### B. Workspace management

| ID | Requirement | Pri |
|---|---|---|
| FR-B1 | A verified user can create a workspace and becomes its Administrator | M |
| FR-B2 | A user can belong to several workspaces, with a different role in each | M |
| FR-B3 | Switch workspaces from a switcher in the app. Different tabs can show different workspaces | M |
| FR-B4 | Administrators edit the workspace name, description and time zone | M |
| FR-B5 | Administrators change member roles and remove members | M |
| FR-B6 | A workspace can never have zero Administrators | M |
| FR-B7 | A member can leave a workspace, unless they are its last Administrator | S |

### C. Project management

| ID | Requirement | Pri |
|---|---|---|
| FR-C1 | Administrators and Project Managers create projects. The creator becomes a project manager | M |
| FR-C2 | Edit name, description, status, priority, start date and due date | M |
| FR-C3 | Statuses: Planning, Active, On Hold, Completed. Priorities: Low, Medium, High, Urgent | M |
| FR-C4 | Archive and unarchive. Archived projects are read-only for everyone until unarchived | M |
| FR-C5 | Add and remove project members from existing workspace members only | M |
| FR-C6 | Assign project managers from members whose workspace role is Administrator or Project Manager | M |
| FR-C7 | Show progress calculated from tasks (section 6) | M |
| FR-C8 | Setting a project to Completed while tasks are open is allowed, with a warning in the UI | S |

### D. Task management and Kanban

| ID | Requirement | Pri |
|---|---|---|
| FR-D1 | Create and edit tasks: title, description, priority, due date, assignee | M |
| FR-D2 | Statuses: To Do, In Progress, In Review, Completed | M |
| FR-D3 | Only project members can be assigned to a task | M |
| FR-D4 | Kanban board with drag and drop, plus a **keyboard-accessible alternative** for changing status | M |
| FR-D5 | Task list with filters (status, priority, assignee, due date), title search and sorting | M |
| FR-D6 | Add, edit and delete own comments. Project managers and Administrators can remove any comment | M |
| FR-D7 | Soft-delete tasks, with restore available to managers | S |
| FR-D8 | "My tasks" view across every project visible to the user | M |

### E. Team management

| ID | Requirement | Pri |
|---|---|---|
| FR-E1 | View workspace members and their roles | M |
| FR-E2 | View project members | M |
| FR-E3 | View an individual's task assignments, limited to projects the viewer can access | M |
| FR-E4 | Administrators invite by email, choose a role, and resend or revoke invitations | M |
| FR-E5 | Invitations expire after 7 days and work only once | M |
| FR-E6 | New and existing users can both accept. The accepting account's email must match the invited address | M |

### F. Dashboard and reporting

| ID | Requirement | Pri |
|---|---|---|
| FR-F1 | Workspace dashboard showing the metrics in section 6, limited to projects the viewer can access | M |
| FR-F2 | Project report: status breakdown, overdue tasks, workload per assignee | M |
| FR-F3 | Recent activity on the dashboard | M |

### G. Activity history and notifications

| ID | Requirement | Pri |
|---|---|---|
| FR-G1 | Record project, task, membership and invitation changes, including who acted and what changed | M |
| FR-G2 | Activity records cannot be edited or deleted through the application | M |
| FR-G3 | Show activity history on projects and tasks | M |
| FR-G4 | Notify in-app on: assigned to a task, comment on a task you're assigned to or created, status change on a task you created, added to a project, role changed | M |
| FR-G5 | Mark one or all notifications read, and show an unread count per workspace in the switcher | M |
| FR-G6 | Removing a person from a workspace deletes their notifications from it | M |

---

## 4. Version 1 scope

**In scope:** authentication with email verification, multi-tenant workspaces, membership and roles, invitations, project management, task management, single assignment, Kanban, comments, dashboard, basic reporting, activity history, in-app notifications, automated tests, one production deployment and one demo workspace.

### Postponed

| Target | Feature | Reason for postponing |
|---|---|---|
| V1.1 | Workspace and account deletion, data export | Needs retention and privacy design (D9). **Required before real customer use** |
| V1.1 | Markdown in descriptions and comments | Needs sanitising (D10) |
| V1.1 | Email notifications and preferences | Needs digesting to avoid spamming users |
| V1.1 | Two-factor authentication | Valuable, but not needed to prove the core design |
| V1.2 | File attachments | Adds storage, malware and access-control concerns |
| V1.2 | Sub-tasks, labels, multiple assignees | Each changes the task model and reports |
| V1.2 | Live updates through WebSockets | Polling is enough at this scale |
| V1.2 | Custom workflows or statuses per project | Affects Kanban, reports and permissions |
| Later | Custom roles, SSO, audit export, public API tokens | Enterprise features |
| Later | Time tracking, Gantt charts, calendar, task dependencies | Each is a separate product area |
| Excluded by the brief | AI assistants, payments, chat, video conferencing, mobile apps | Out of scope |

---

## 5. Non-functional requirements

Targets are deliberately modest and measurable on the seeded dataset: 10 workspaces, 100 projects and 20,000 tasks.

| Area | Requirement |
|---|---|
| Performance | API reads under 300 ms at the 95th percentile on the production server. No N+1 queries on list endpoints, enforced in tests |
| Scalability | Stateless API, with sessions, cache and queue in the database. Every tenant query uses an index that starts with a tenant or parent key. Scale vertically first |
| Reliability | State changes and their activity records commit in one transaction. Notifications and emails are queued after commit and retried |
| Maintainability | One place for each rule: policies for permissions, actions for business operations. Linting and formatting enforced in CI |
| Accessibility | Target WCAG 2.2 AA: keyboard operation, visible focus, labelled forms, sufficient contrast. Kanban has a non-drag alternative |
| Responsive design | Usable from 360 px wide upwards. On small screens Kanban shows one column at a time |
| Error handling | Consistent API error format with a `request_id`. The UI always shows a loading, empty, error or success state |
| Logging | Structured logs with request ID, user ID and workspace ID. Passwords, tokens and session IDs are never logged |
| Backup and recovery | Nightly encrypted off-server backups kept for 14 days. Recovery point 24 hours, recovery time 4 hours. **One restore rehearsal before release** |
| Deployment | Backend and frontend deploy independently. Pending migrations run as an explicit deployment step |
| Documentation | README with setup instructions, these documents kept current, architecture decisions recorded |

---

## 6. Metric definitions

Every metric covers only projects the viewer can access, and excludes archived projects and soft-deleted tasks unless stated otherwise.

| Metric | Definition |
|---|---|
| Total projects | All non-archived projects |
| Active projects | Status is Active |
| Completed projects | Status is Completed |
| Pending tasks | Status is To Do, In Progress or In Review |
| Overdue tasks | Pending, and `due_date` is before today **in the workspace time zone** |
| Task completion rate | Completed tasks ÷ all tasks. Shown as "no data", not 0%, when there are no tasks |
| Project progress | The completion rate for one project |

---

## 7. Acceptance criteria for the first release

V1 is ready to merge and release only when **all** of these are true.

**Tenant isolation and security**

1. The automated isolation suite covers every workspace route, and a guard test fails if a new route is added without coverage.
2. A user cannot read or change another workspace's resource by changing any ID or slug. The response is 404 and matches the response for a resource that does not exist.
3. Every cell of the permission matrix has a passing automated test.
4. The database rejects cross-workspace references inserted directly, bypassing the application.
5. The session cookie is `HttpOnly`, `Secure` and `SameSite=Lax` in production, and state-changing requests without a valid CSRF token are rejected.
6. Rate limits are verified on login, password reset and invitation sending.
7. The security checklist in the architecture document has been reviewed item by item, with remaining risks written down.

**Product**

8. A new user can register, verify their email, create a workspace, invite a colleague, create a project, assign a task, and move it through to Completed.
9. The invited colleague receives the notification and sees the activity history.
10. Dashboard values match the definitions in section 6, including the workspace time zone boundary for overdue tasks.
11. The Kanban board can be fully operated using only the keyboard.
12. All main screens work at 360 px, 768 px and 1280 px, and include loading, empty and error states.

**Engineering**

13. CI passes on `main`: backend tests against real MySQL, frontend tests, linting and dependency audit.
14. Three end-to-end smoke flows pass against a production-like build.
15. A backup has been restored successfully to a separate database.
16. The live demo works over HTTPS, and a new developer can follow the README to run the project locally.
