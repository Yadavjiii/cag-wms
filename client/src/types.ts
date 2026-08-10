export type TaskStatus = "YET_TO_BE_ASSIGNED" | "INITIATED" | "IN_PROGRESS" | "FINISHED" | "ON_HOLD";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface Designation {
  id: string;
  name: string;
  code?: string | null;
  /** Ordering for lists and reports only. Grants nothing: power comes from Role. */
  rank: number;
  /** null = platform-wide, maintained by the Super Admin. */
  officeId?: string | null;
  isActive?: boolean;
  _count?: { users: number };
}

export interface RoleRef {
  id: string;
  name: string;
  level: number;
  officeId?: string | null;
  templateId?: string | null;
  isSystem?: boolean;
  isDefault?: boolean;
  description?: string | null;
  permissions?: { permission: { id: string; key: string; description?: string | null } }[];
  _count?: { users: number };
}

export interface Department {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  officeId?: string | null;
  parentId?: string | null;
  office?: { id: string; name: string } | null;
  parent?: { id: string; name: string } | null;
  head?: { id: string; fullName: string; designation?: string | null } | null;
  members?: { id: string; fullName: string; designation?: string | null; email: string }[];
  children?: { id: string; name: string }[];
  _count?: { members: number; children: number };
}

export interface Office {
  id: string;
  name: string;
  code?: string | null;
  city?: string | null;
  isActive?: boolean;
  /** The IAAS-rank officer who approves work arriving from other offices. */
  head?: { id: string; fullName: string; designation?: string | null; email?: string } | null;
  departments?: { id: string; name: string; code?: string | null }[];
  createdAt?: string;
  _count?: { departments: number; users: number; owningTasks?: number; projects?: number };
}

/** A staff account as the admin screens see it. */
export interface StaffAccount {
  id: string;
  fullName: string;
  email: string;
  employeeId?: string | null;
  mobile?: string | null;
  designation?: Designation | null;
  wing?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  role?: RoleRef | null;
  office?: { id: string; name: string; code?: string | null } | null;
  department?: { id: string; name: string } | null;
  manager?: { id: string; fullName: string } | null;
  createdBy?: { id: string; fullName: string } | null;
}

/** Response from any account-creation endpoint. The temp password is shown once. */
export interface CreatedAccount {
  user: StaffAccount;
  temporaryPassword?: string;
}

export interface AssignableRole {
  id: string;
  name: string;
  description?: string | null;
  level: number;
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  officeId: string | null;
  officeName?: string | null;
  role?: RoleRef | null;
  roleName?: string | null;
  level?: number;
  isActive?: boolean;
  mustChangePassword?: boolean;
  /** Offices this user heads. Non-empty means they decide on incoming office requests. */
  headsOfficeIds?: string[];
  headsDepartmentIds?: string[];
  permissions?: string[];
  employeeId?: string | null;
  mobile?: string | null;
  designation?: Designation | null;
  wing?: string | null;
  avatarUrl?: string | null;
  departmentId?: string | null;
  department?: { id: string; name: string } | null;
  office?: { id: string; name: string; code?: string | null } | null;
}

export interface Person {
  id: string;
  fullName: string;
  designation?: Designation | null;
  wing?: string | null;
  email?: string;
  role?: RoleRef | null;
  department?: { id: string; name: string } | null;
  office?: { id: string; name: string } | null;
}

export interface Comment {
  id: string;
  body: string;
  authorRole?: string | null;
  author?: Person | null;
  createdAt: string;
}

export interface Task {
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  archivedAt?: string | null;
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  primaryLead?: Person | null;
  secondaryLead?: Person | null;
  currentlyWith?: Person | null;
  /** Accountable for the outcome. Never changes. */
  owningOfficeId?: string | null;
  /** Actually doing the work. Changes when another office accepts a request. */
  executingOfficeId?: string | null;

  assignedDate?: string | null;
  dueDate?: string | null;
  pctComplete: number | null;
  createdAt: string;
  updatedAt: string;
  comments?: Comment[];
  attachments?: Attachment[];
  createdBy?: Person | null;
}

export type RequestState =
  | "PENDING_APPROVAL"
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "DECLINED"
  | "REJECTED"
  | "CANCELLED";

export type RequestScope = "USER" | "DEPARTMENT" | "OFFICE";

export interface Assignment {
  id: string;
  state: RequestState;
  scope: RequestScope;
  requiresApproval: boolean;
  message?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  from?: Person | null;
  to?: Person | null;
  toDepartment?: { id: string; name: string; headId?: string | null } | null;
  toOffice?: { id: string; name: string; code?: string | null; headId?: string | null } | null;
  approvedBy?: Person | null;
  task?: { id: string; title: string; owningOfficeId?: string | null; executingOfficeId?: string | null; dueDate?: string | null; priority?: TaskPriority };
}

export interface AppNotification {
  id: string;
  kind: string;
  isRead: boolean;
  createdAt: string;
  payload?: { title?: string; body?: string | null; taskId?: string | null } | null;
}

export interface Attachment {
  id: string;
  fileName: string;
  storagePath?: string;
  createdAt: string;
  uploadedBy?: Person | null;
}

export type MeetingMode = "PHYSICAL" | "ONLINE";

export interface MeetingParticipant {
  userId: string;
  user: { id: string; fullName: string };
}

export interface Meeting {
  id: string;
  title: string;
  agenda?: string | null;
  startsAt: string;
  mode: MeetingMode;
  location?: string | null;
  createdBy?: { id: string; fullName: string } | null;
  task?: { id: string; title: string } | null;

  participants?: MeetingParticipant[];
}

export interface SearchResults {
  tasks: { id: string; title: string; status: TaskStatus }[];
  people: { id: string; fullName: string; designation?: string | null; email: string }[];
  projects: { id: string; name: string }[];
  meetings: { id: string; title: string; startsAt: string }[];
}

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  detail?: Record<string, unknown> | null;
  actor?: { id: string; fullName: string } | null;
  task?: { id: string; title: string } | null;
}

export interface ReportSummary {
  totals: { total: number; active: number; finished: number; overdue: number; dueSoon: number };
  byStatus: { status: string; count: number }[];
  byLead: { name: string; active: number; overdue: number }[];
  byDepartment: { name: string; active: number }[];
}

// ---------------------------------------------------------------------------
// Projects. There are no standing teams: a project forms its own working group
// with a primary lead, an optional secondary lead, members and observers.
// ---------------------------------------------------------------------------

export type ProjectStatus = "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
export type ProjectRoleKind = "PRIMARY_LEAD" | "SECONDARY_LEAD" | "MEMBER" | "OBSERVER";

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRoleKind;
  addedAt: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    designation?: Designation | null;
    avatarUrl?: string | null;
    department?: { id: string; name: string } | null;
  };
}

export interface Project {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  status: ProjectStatus;
  officeId: string;
  startDate?: string | null;
  dueDate?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  members: ProjectMember[];
  office?: { id: string; name: string; code?: string | null } | null;
  department?: { id: string; name: string } | null;
  createdBy?: { id: string; fullName: string } | null;
  tasks?: Task[];
  canManage?: boolean;
  _count?: { tasks: number };
}

export interface CalendarEvent {
  id: string;
  kind: "task" | "project" | "meeting";
  title: string;
  start: string;
  end?: string | null;
  status?: string | null;
  priority?: string | null;
  url: string;
  meta?: string | null;
}
