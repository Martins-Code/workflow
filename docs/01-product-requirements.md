# 01 — Product Requirements

**Status:** Approved on 2026-11-10 (Phase 1). This describes planned behaviour; none of it is implemented yet · **Last reviewed:** 2026-11-10 · **Applies to:** WorkFlow Version 1

Related: [Documentation guide](00-documentation-guide.md) · [Architecture](02-system-architecture.md) · [Database](03-database-design.md) · [Permissions](04-permissions-matrix.md) · [API](05-api-specification.md) · [Testing](06-testing-strategy.md) · [Roadmap](07-development-roadmap.md) · [Journal](08-development-journal.md)

---

## 1. Summary

WorkFlow is a multi-tenant project and workflow management platform. Organisations each get a private **workspace** containing their members, projects, tasks, comments, notifications and activity history. One organisation must never be able to read or change another's private data.

I'm building WorkFlow as a personal project, with a public demonstration deployment. It may become a commercial SaaS product later. V1 therefore favours a small feature set built carefully, over feature breadth: tenant isolation that can be shown to hold, a tested permission model, and a demo that costs little or nothing to host. The demo's hosting is a demonstration environment, not production infrastructure for customer data.

### Success measures

1. A first-time visitor to the demo can understand what the product does within a few minutes.
2. Tenant isolation is enforced at several layers, and automated tests prove it.
3. Every major design decision is documented with its reasoning and trade-offs.

### Users

| Persona | Workspace role | Main need |
|---|---|---|
| Operations lead | Administrator | Control who belongs to the workspace and what they can do |
| Delivery lead | Project Manager | Plan projects, assign work, see what is late |
| Contributor | Team Member | See assigned work, update status, discuss it |
| Invitee | none yet | Join a workspace safely from an emailed link |

---

## 2. Confirmed decisions

I confirmed D1–D11 on 2026-11-05, including D7's low-cost direction. By 2026-11-08, Aiven had stopped offering new free MySQL services, so D7's database provider changed, and I added D12 and D13. On 2026-11-10 I confirmed separate frontend and backend services for D7, and approved D12 and D13 with the rest of Phase 1. The history of each change is in the [development journal](08-development-journal.md).

**D7 is approved but not validated.** It depends on Render's static-site forwarding, which is being tested in the [Render forwarding experiment](https://github.com/Martins-Code/workflow/tree/spike/render-proxy-test/experiments/render-proxy). The hosting providers named in D7 and D12 are confirmed only once the Phase 2 hosting validation passes.

| ID | Question | Confirmed decision | Why | Cost of the alternative |
|---|---|---|---|---|
| **D1** | Is "Project Manager" a workspace-wide power or per-project? My original brief lists it as a workspace role but also says "assign project managers" to a project. | **Both layers.** The workspace role grants the right to *create* projects and be *eligible* to manage them. A person manages only projects where `project_members.role = manager`. Only Administrators have automatic access to every project. | Otherwise any PM could read every project in the organisation, which makes project membership meaningless. | Workspace-wide PM access is simpler to code but removes confidentiality between projects. |
| **D2** | What can a Team Member see and change inside a project? My original brief says "views assigned tasks" and also "participates in project activities". | They **view all tasks** in projects they belong to and comment on any of them. They **change status only on tasks assigned to them**. | A Kanban board that shows each person only their own cards is not a useful board. Limiting writes keeps accountability clear. | Assigned-only visibility requires a second, filtered board and blocks collaboration. |
| **D3** | Can Team Members mark their own work Completed? | **No.** They can move their tasks between To Do, In Progress and In Review. Only a project manager or Administrator moves a task to Completed. | If the assignee can complete their own work, "In Review" has no meaning. | Free movement is simpler and suits small teams, but then "In Review" is only a label. This is a one-line policy change. |
| **D4** | One assignee per task, or several? | **One** (`tasks.assignee_id`, nullable). | Clear ownership and simpler notifications, "my tasks" and reports. | Multiple assignees need a join table and an answer to "who can complete it?". Moving to a join table later is a contained migration. |
| **D5** | How is the active workspace identified on API requests? My original brief implies a selected "active" workspace. | **In the URL path:** `/api/v1/workspaces/{slug}/...`. "Active workspace" is then a frontend idea, not server session state. | A workspace stored in the session breaks when two tabs show different workspaces: a user can act on the wrong organisation's data without noticing. See ADR-03. | A header works technically but is less visible, less testable and does not fit Laravel's route binding as well. |
| **D6** | Require email verification? It wasn't in my original brief. | **Yes, in V1.** | Without it, someone can register with another person's address before that person is invited (account pre-hijacking). | Skipping it removes one flow but leaves that attack open and makes invitation matching less trustworthy. |
| **D7** | Where is the demo hosted, with no purchased domain or paid VPS? | **Separate free Render services.** The frontend is a static site and the backend is a Docker web service, with PostgreSQL on Neon (D12). The static site forwards `/api` and `/sanctum` to the backend, so the browser sees one origin. No permanent queue worker. Subject to Phase 2 proxy validation. | Keeps separate deployment while keeping Sanctum cookie authentication first-party, which Render's two default domains otherwise prevent. See [architecture, section 10](02-system-architecture.md#10-hosting-strategy). | The backend sleeps after 15 minutes idle and takes about a minute to wake. The proxy adds latency. It isn't production hosting. If the forwarding fails validation, choosing a fallback is a new, recorded decision. A paid domain is one of the fallbacks |
| **D12** | Which database engine, now that free MySQL hosting is unavailable? | **PostgreSQL 18 everywhere:** locally, in CI and on Neon's free plan, with Aiven's free PostgreSQL as the fallback. | It keeps hosting free while preserving every database-level tenant safeguard, and it improves two of them. See [database design, section 7](03-database-design.md#7-postgresql-design-notes). | Paying $5 a month for Aiven's MySQL Developer plan would keep MySQL. PostgreSQL means learning its differences in case handling, locking errors and indexing. |
| **D13** | How does the free demo show email-based features without a domain or email provider? | **An in-app demo mailbox.** In demo mode, sign-up accepts only addresses on the reserved `workflow.test` domain, which can never receive real mail, and verification and invitation emails appear in a demo mailbox page. | No email provider or domain is needed, and no real email addresses are ever collected. The real flows can still be demonstrated. | The mailbox is public, so any visitor can read demo messages. That's acceptable only because the addresses and data are fictional and reset nightly. Real email delivery is still built and tested, but not used on the demo. |
| **D8** | One repository or two? | **One repository** (monorepo) with `backend/` and `frontend/`, still built and deployed independently. | The repository already existed. A feature branch can contain its API and UI changes together, and all code and documentation live in one place. | Two repos show stricter separation but split every feature across two branches and two pull requests. |
| **D9** | Should workspaces, projects and user accounts be deletable? My original brief only says "archive" for projects. | **Not in V1.** Projects archive. Tasks and comments soft-delete. Workspace and account deletion move to V1.1. | Correct deletion cascades, retention and privacy handling are a substantial feature. | Real users would need this, and **UK/EU privacy law may require account erasure in production**. It must be built before WorkFlow holds real customer data. |
| **D10** | Should descriptions and comments support rich text? | **Plain text** in V1, displayed with preserved line breaks. | Removes the largest source of stored XSS. | Markdown needs a sanitising pipeline. It is a good V1.1 feature. |
| **D11** | My original brief says Administrators "manage workspace-level permissions". Does that mean configurable permissions? | **Fixed roles defined in code.** In V1 this responsibility means assigning roles and editing workspace settings. | A configurable permission editor multiplies the states that need testing, with little benefit in V1. | Custom roles would add tables, UI and a much larger test matrix. |

### Other gaps identified

My original brief didn't specify these. Each has a default, which stands until a later decision changes it.

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
| Public demo abuse | Seeded demo accounts, nightly reset of all data, email disabled for demo accounts |
| Email without an owned domain | Demo mailbox on the live demo (D13). Real email delivery remains in the application for later use with a domain |

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

### H. Public demo

| ID | Requirement | Pri |
|---|---|---|
| FR-H1 | Seeded demo accounts cover all three roles, and a second workspace demonstrates isolation | M |
| FR-H2 | Demo accounts cannot change their email or password, and cannot send invitations | M |
| FR-H3 | All demo data resets nightly. The reset refuses to run unless demo mode is explicitly enabled | M |
| FR-H4 | A permanent banner and the sign-up page state that data is deleted nightly and that real or sensitive data must not be entered | M |
| FR-H5 | If the API is waking up, the SPA shows a clear "waking up" message and retries, not an error | M |
| FR-H6 | In demo mode, registration and invitations accept only addresses on the reserved `workflow.test` domain, so no real email address is collected (D13) | M |
| FR-H7 | In demo mode, emails are stored in a demo mailbox page instead of being sent. Outside demo mode the mailbox doesn't exist, and emails are delivered normally | M |

---

## 4. Version 1 scope

**In scope:** authentication with email verification, multi-tenant workspaces, membership and roles, invitations, project management, task management, single assignment, Kanban, comments, dashboard, basic reporting, activity history, in-app notifications, automated tests, and one public demo deployment with seeded data.

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
| Before any commercial use | Paid hosting, custom domain, real backups, monitoring, separate queue worker | The free demo environment must not hold customer data |
| Later | Custom roles, SSO, audit export, public API tokens | Enterprise features |
| Later | Time tracking, Gantt charts, calendar, task dependencies | Each is a separate product area |
| Excluded from the start | AI assistants, payments, chat, video conferencing, mobile apps | Out of scope |

---

## 5. Non-functional requirements

Targets are deliberately modest and measurable on the seeded dataset: 10 workspaces, 100 projects and 20,000 tasks.

| Area | Requirement |
|---|---|
| Performance | API reads under 300 ms at the 95th percentile, measured locally in the production container on the seeded dataset. No N+1 queries on list endpoints, enforced in tests. **The free live demo has no speed target**: it is slower, with about a minute's wake-up after idle |
| Scalability | Stateless API, with sessions, cache and queue in the database. Every tenant query uses an index that starts with a tenant or parent key. Scale vertically first |
| Reliability | State changes and their activity records commit in one transaction. Notifications and demo emails are created after commit, with failures logged. No permanent queue worker in V1 (ADR-11). No uptime target for the free demo |
| Maintainability | One place for each rule: policies for permissions, actions for business operations. Linting and formatting enforced in CI |
| Accessibility | Target WCAG 2.2 AA: keyboard operation, visible focus, labelled forms, sufficient contrast. Kanban has a non-drag alternative |
| Responsive design | Usable from 360 px wide upwards. On small screens Kanban shows one column at a time |
| Error handling | Consistent API error format with a `request_id`. The UI always shows a loading, empty, error or success state |
| Logging | Structured logs with request ID, user ID and workspace ID. Passwords, tokens and session IDs are never logged |
| Backup and recovery | Demo data is disposable, so recovery means rebuilding from migrations and seeders, **rehearsed before release**. Neon's 6-hour restore window on its free plan is a bonus, not relied on. Real backups with recovery targets are required before commercial use |
| Deployment | Backend and frontend are separate Render services with separate code, dependencies, configuration, tests, CI workflows and deploy hooks. Either can be deployed alone. Migrations run from GitHub Actions before the backend deploys |
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
5. On the live demo, the session cookie is host-only, `HttpOnly`, `Secure` and `SameSite=Lax`, and state-changing requests without a valid CSRF token are rejected.
6. Rate limits are verified on login, password reset and invitation sending.
7. The security checklist in the architecture document has been reviewed item by item, with remaining risks written down.

**Product**

8. A new user can register, verify their email, create a workspace, invite a colleague, create a project, assign a task, and move it through to Completed.
9. The invited colleague receives the notification and sees the activity history.
10. Dashboard values match the definitions in section 6, including the workspace time zone boundary for overdue tasks.
11. The Kanban board can be fully operated using only the keyboard.
12. All main screens work at 360 px, 768 px and 1280 px, and include loading, empty and error states.

**Engineering**

13. CI passes on `main`: backend tests against real PostgreSQL 18, frontend tests, linting and dependency audit.
14. Three end-to-end smoke flows pass against a production-like build.
15. The demo database has been rebuilt from empty using migrations and seeders, and a dump has been restored to a separate database.
16. The live demo works over HTTPS on its platform URL, and a new developer can follow the README to run the project locally.
17. The README states the demo's limitations honestly, including the wake-up delay and nightly reset, and links to a short video or screenshots for when the demo is unavailable.
