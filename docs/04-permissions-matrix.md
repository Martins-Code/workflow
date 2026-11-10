# 04 — Permissions Matrix

**Status:** Revised, awaiting final approval · **Date:** 2026-11-08 · **Depends on:** confirmed decisions D1, D2, D3, D9, D11

---

## 1. Two layers of role

Permissions come from two independent layers, and both must be checked.

| Layer | Stored in | Values | Question it answers |
|---|---|---|---|
| Workspace role | `workspace_members.role` | `administrator`, `project_manager`, `member` | What can this person do across the organisation? |
| Project role | `project_members.role` | `manager`, `contributor` | What can this person do in this project? |

**Naming matters.** "Project Manager" the workspace role means "may create projects and be made a manager". `manager` the project role means "does manage this project". They're deliberately separate, so one PM can manage Project A, contribute to Project B, and have no access to Project C.

### Effective access to a project

Exactly one result applies, resolved in this order by a single helper, `ProjectAccess`:

| Situation | Effective access |
|---|---|
| Workspace role is Administrator | **Manager** on every project, with no `project_members` row needed |
| `project_members.role = manager` | **Manager** |
| `project_members.role = contributor` | **Contributor** |
| Anything else | **None**. The project appears not to exist (404) |

### Eligibility rules

- Only workspace **Administrators and Project Managers** can hold the project `manager` role.
- Any workspace member can be a `contributor`.
- Anyone on a project must be a workspace member. The database enforces this.

**Key:** ✅ allowed · ❌ denied (403) · 🔒 hidden (404) · 🟡 allowed with a stated limit

---

## 2. Workspace-level permissions

| Action | Administrator | Project Manager | Team Member | Non-member |
|---|---|---|---|---|
| View workspace details | ✅ | ✅ | ✅ | 🔒 |
| Edit workspace name, description and time zone | ✅ | ❌ | ❌ | 🔒 |
| View member list (name, email, role) | ✅ | ✅ | ✅ | 🔒 |
| Change a member's role | ✅ 🟡¹ | ❌ | ❌ | 🔒 |
| Remove a member | ✅ 🟡¹ | ❌ | ❌ | 🔒 |
| Leave the workspace | ✅ 🟡¹ | ✅ | ✅ | 🔒 |
| View pending invitations | ✅ | ❌ | ❌ | 🔒 |
| Send, resend or revoke invitations | ✅ | ❌ | ❌ | 🔒 |
| Create a project | ✅ | ✅ | ❌ | 🔒 |
| List projects | ✅ all | 🟡 own² | 🟡 own² | 🔒 |
| View dashboard | ✅ all | 🟡 own² | 🟡 own² | 🔒 |
| View workspace-wide project report | ✅ all | 🟡 managed³ | ❌ | 🔒 |
| View workspace-level activity⁴ | ✅ | ❌ | ❌ | 🔒 |
| View an individual's task assignments | ✅ all | 🟡 own² | 🟡 own² | 🔒 |
| View and manage own notifications | ✅ | ✅ | ✅ | 🔒 |

¹ Blocked with 409 if it would leave the workspace with no Administrator.
² Only projects where they have a `project_members` row.
³ Only projects where they are `manager`.
⁴ Events with no project: membership changes, invitations, workspace settings.

A verified user can create a new workspace regardless of roles elsewhere. Accepting an invitation requires the matching verified email and a valid token, not a role.

---

## 3. Project-level permissions

The columns show **effective access** from section 1. Workspace Administrators use the Manager column.

| Action | Manager | Contributor | No access |
|---|---|---|---|
| View project, board and task list | ✅ | ✅ | 🔒 |
| View project members | ✅ | ✅ | 🔒 |
| View project activity | ✅ | ✅ | 🔒 |
| View project report | ✅ | ❌ | 🔒 |
| Edit project details, status, priority and dates | ✅ | ❌ | 🔒 |
| Archive or unarchive | ✅ | ❌ | 🔒 |
| Add or remove project members | ✅ 🟡⁵ | ❌ | 🔒 |
| Grant or remove the `manager` role | ✅ 🟡⁵ | ❌ | 🔒 |
| Create a task | ✅ | ❌ | 🔒 |
| Edit task details (title, description, priority, due date) | ✅ | ❌ | 🔒 |
| Assign or reassign a task | ✅ | ❌ | 🔒 |
| Delete or restore a task | ✅ | ❌ | 🔒 |
| Change task status | ✅ any | 🟡 assigned to them, up to In Review⁶ | 🔒 |
| Reorder a task on the board | ✅ any | 🟡 assigned to them | 🔒 |
| View a task and its comments | ✅ | ✅ | 🔒 |
| Add a comment | ✅ | ✅ | 🔒 |
| Edit a comment | 🟡 own | 🟡 own | 🔒 |
| Delete a comment | ✅ any | 🟡 own | 🔒 |

⁵ New managers must hold the Administrator or Project Manager workspace role. The action is refused with 409 if it would leave an active project with no manager.
⁶ A contributor can't move a task to Completed or reopen a Completed task (D3).

### Archived projects

Archived projects are read-only for **everyone, including Administrators**. The only write allowed is unarchiving. Other writes return 409 with code `project_archived`. This is a state rule, not a permission, which is why it can't be bypassed by a blanket admin override.

### Demo accounts

Seeded demo accounts follow the same matrix for their role, plus these restrictions in every workspace: they cannot change their email or password, and cannot send or resend invitations. These attempts return 403 with code `demo_restricted`. Demo restrictions only ever remove abilities, and they never bypass tenant checks.

The demo mailbox (D13) is deliberately public, but only in demo mode, and it only ever contains messages to reserved `workflow.test` addresses. It is not a permission exception for any workspace data.

---

## 4. Conflicts found in the brief and how they are resolved

| # | Conflict | Resolution |
|---|---|---|
| 1 | PM is both a workspace role and something assigned per project | Two layers (D1) |
| 2 | PM "creates and manages projects" could imply access to all projects | Only those where they are `manager` (D1) |
| 3 | Team Member "views assigned tasks" versus Kanban participation | View all in their projects, write only their own (D2) |
| 4 | "Updates task status" versus the In Review stage | Completion requires a manager (D3) |
| 5 | Admin "has access to all projects" versus the archived state | Admin has full *access*, but state rules still apply |
| 6 | "Manages workspace-level permissions" | Means assigning roles, as permissions are fixed (D11) |
| 7 | PM "adds project members": could they invite people into the organisation? | No. Only from existing workspace members. Only Administrators invite |

---

## 5. Consequences of role changes

These are the edge cases where permission systems usually go wrong.

| Event | What happens, in one transaction |
|---|---|
| Project Manager demoted to Team Member | Their `manager` rows become `contributor`. Projects left without a manager show a "No manager" badge |
| Administrator demoted | Blocked if they're the last. They lose implicit project access and keep only explicit project rows |
| Team Member promoted to Project Manager | Can now create projects. Existing project roles don't change |
| Member removed from workspace | See [database design, section 6](03-database-design.md#6-multi-step-operation-removing-a-workspace-member) |
| Contributor removed from a project | Their tasks in that project are unassigned, and that project's notifications to them are deleted |
| Project's final manager removed through the project screen | Refused with 409. Offboarding through member removal or demotion is allowed, so offboarding can't deadlock |

**Permission changes apply on the next request.** Roles are read from the database on each request, not stored in the session.

---

## 6. Security risks in the permission model

| Risk | Scenario | Control |
|---|---|---|
| **Privilege escalation** | A member sends `role=administrator` in a profile or membership request | Roles change only through one Administrator endpoint. `role` is never mass-assignable |
| **Cross-tenant admin** | An Administrator of A uses that role in B | Roles are read from the membership for the workspace in the URL. Role isn't a property of the user |
| **IDOR** (changing IDs in a request) | Changing a task ID in the URL or `assignee_id` in the body | Scoped binding, global scope, scoped validation and composite FKs |
| **Field-level escalation** | A contributor sends `{ "status": "in_review", "assignee_id": 5 }` to get a task reassigned | Contributors can only use the dedicated status endpoint. The general update endpoint requires Manager access |
| **Status bypass** | A contributor moves a task to Completed through the move endpoint | The same `changeStatus` policy check covers every path that changes status |
| **Last admin lockout** | Two Administrators demote each other at the same moment | Row lock in the transaction |
| **Removed user's old session** | An open tab keeps working after removal | Membership is checked on every request |
| **Information leak in read models** | The dashboard, activity feed, notifications or an individual's assignments reveal a project the viewer can't access | All use `visibleTo($user)`, with dedicated tests |
| **Snapshot leak** | Old notification text reveals a task title after removal | Notifications deleted on removal |
| **Existence oracle** | Different responses for "doesn't exist" and "no access" | Same 404 response for both |
| **Frontend trust** | Hidden button, but the endpoint is callable directly | The `can` object only affects display. The server always enforces |
| **Invitation role abuse** | An invitee edits the role during acceptance | The role is read from the invitation row, never from the request |

---

## 7. How this maps to code

| Policy | Covers |
|---|---|
| `WorkspacePolicy` | View, update, viewActivity, viewReports |
| `WorkspaceMemberPolicy` | View, updateRole, remove, leave |
| `InvitationPolicy` | ViewAny, create, resend, revoke |
| `ProjectPolicy` | View (returns 404 on denial), create, update, archive, manageMembers, viewReport |
| `TaskPolicy` | View, create, update, assign, changeStatus, move, delete, restore |
| `CommentPolicy` | Create, update, delete |
| `NotificationPolicy` | View, markRead (only your own) |

Every table above becomes a data-driven test, and **each row of this document should map to a test case**. If the document and tests disagree, one of them is a bug. See [the testing strategy](06-testing-strategy.md#5-authorisation-matrix-tests).
