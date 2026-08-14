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
  members?: { id: string; fullName: string; designation?: Designation | null; email: string }[];
  children?: { id: string; name: string }[];
  _count?: { members: number; children: number };
}

export interface Office {
  id: string;
  name: string;
  code?: string | null;
  city?: string | null;
  /** The office mailbox. Doubles as the Office Admin username. */
  email?: string | null;
  isActive?: boolean;
  /** The IAAS-rank officer who approves work arriving from other offices. */
  head?: { id: string; fullName: string; designation?: Designation | null; email?: string } | null;
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
  /** Service cadre. Free text. */
  cadre?: string | null;
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
  /** Did the credentials email actually go out? */
  emailed?: boolean;
  /** Why it did not, when it did not. */
  emailError?: string;
}

/** POST /api/superadmin/offices returns the office AND its new admin login. */
export interface CreatedOffice {
  office: Office;
  admin: StaffAccount;
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

// ---------------------------------------------------------------------------
// Discussion. One shape for the thread on a work item and the thread on a
// project, so a single component can render both.
// ---------------------------------------------------------------------------

export type CommentKind = "REMARK" | "STATUS_UPDATE" | "DIRECTION" | "DECISION" | "BLOCKER";

/** Frozen on a STATUS_UPDATE at the moment it was posted. */
export interface StatusMeta {
  statusFrom?: TaskStatus;
  statusTo?: TaskStatus;
  pctFrom?: number;
  pctTo?: number;
}

export interface Comment {
  id: string;
  body: string;
  kind: CommentKind;
  authorRole?: string | null;
  author?: Person | null;
  meta?: StatusMeta | null;
  parentId?: string | null;
  isPinned?: boolean;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  attachments?: Attachment[];
}

/** What GET /tasks/:id/discussion and /projects/:id/discussion return. */
export interface Thread {
  canPost: boolean;
  canReportProgress: boolean;
  pinned: Comment[];
  posts: Comment[];
}

/** Where a thread lives. Drives every URL the discussion component builds. */
export type ThreadScope = "task" | "project";

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
  /** When progress was last reported. Drives the staleness warning. */
  lastUpdateAt?: string | null;
  createdAt: string;
  updatedAt: string;
  comments?: Comment[];
  attachments?: Attachment[];
  createdBy?: Person | null;
  department?: { id: string; name: string } | null;
  owningOffice?: { id: string; name: string; code?: string | null } | null;
  executingOffice?: { id: string; name: string; code?: string | null } | null;
  /** Set by the server so the UI never offers a control the API will refuse. */
  canEdit?: boolean;
  canReportProgress?: boolean;
  _count?: { comments?: number; attachments?: number; meetings?: number; activities?: number };
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
  size?: number | null;
  mimeType?: string | null;
  createdAt: string;
  taskId?: string | null;
  projectId?: string | null;
  taskCommentId?: string | null;
  projectCommentId?: string | null;
  uploadedBy?: Person | null;
  task?: { id: string; title: string } | null;
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
  endsAt?: string | null;
  mode: MeetingMode;
  location?: string | null;
  minutes?: string | null;
  createdBy?: { id: string; fullName: string } | null;
  task?: { id: string; title: string } | null;
  project?: { id: string; name: string } | null;
  participants?: MeetingParticipant[];
  _count?: { participants: number };
}

export interface SearchResults {
  tasks: { id: string; title: string; status: TaskStatus }[];
  people: { id: string; fullName: string; designation?: Designation | null; email: string }[];
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
  project?: { id: string; name: string } | null;
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
  priority?: TaskPriority;
  officeId: string;
  lastUpdateAt?: string | null;
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
  canContribute?: boolean;
  _count?: { tasks: number; members?: number; comments?: number; attachments?: number; meetings?: number; activities?: number };
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

// ---------------------------------------------------------------------------
// Dashboards. The server computes every figure in one pass and sends a single
// snapshot, so nothing on screen can disagree with anything else on screen.
// These interfaces mirror what /api/dashboard, /api/projects/:id/dashboard and
// /api/tasks/:id/dashboard return.
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  severity: Severity;
  kind: string;
  title: string;
  detail?: string;
  count?: number;
  url: string;
  at?: string | null;
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
}

export interface WorkTotals {
  total: number;
  open: number;
  finished: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  urgent: number;
  unassigned: number;
  onHold: number;
  stale: number;
  noDueDate: number;
  avgCompletion: number;
  completionRate: number;
  onTimeRate: number | null;
}

export interface WorkloadRow {
  userId: string;
  name: string;
  open: number;
  overdue: number;
  urgent: number;
  finished: number;
  avgCompletion: number;
}

export interface DeptRow {
  name: string;
  open: number;
  overdue: number;
  finished: number;
}

export interface TrendPoint {
  date: string;
  created: number;
  finished: number;
  open: number;
}

export interface Health {
  score: number;
  label: "On track" | "Needs attention" | "At risk" | "Not started";
  reasons: string[];
}

export interface BlockerRef {
  id: string;
  taskId: string | null;
  taskTitle: string;
  body: string;
  createdAt: string;
  author?: { id: string; fullName: string } | null;
}

export interface ProjectCard {
  id: string;
  name: string;
  code?: string | null;
  status: ProjectStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  lastUpdateAt?: string | null;
  lead?: { id: string; fullName: string } | null;
  department?: { id: string; name: string } | null;
  counts: { tasks: number; members: number; posts: number; files: number };
  totals: WorkTotals;
  completion: number;
  health: Health;
}

/** GET /api/dashboard */
export interface DashboardSnapshot {
  generatedAt: string;
  thresholds: { staleDays: number; dueSoonDays: number };
  totals: WorkTotals;
  mine: {
    totals: WorkTotals;
    awaitingMyAcceptance: number;
    awaitingMyApproval: number;
    unreadNotifications: number;
  };
  alerts: Alert[];
  urgent: Task[];
  overdue: Task[];
  dueSoon: Task[];
  stale: Task[];
  unassigned: Task[];
  myWork: Task[];
  blockers: BlockerRef[];
  meetings: { today: Meeting[]; upcoming: Meeting[] };
  projects: ProjectCard[];
  statusMix: Bucket[];
  priorityMix: Bucket[];
  workload: WorkloadRow[];
  byDepartment: DeptRow[];
  trend: TrendPoint[];
  recentActivity: ActivityEntry[];
}

/** GET /api/projects/:id/dashboard */
export interface ProjectDashboard {
  project: Project;
  generatedAt: string;
  thresholds: { staleDays: number; dueSoonDays: number };
  health: Health;
  totals: WorkTotals;
  completion: number;
  schedule: {
    startDate?: string | null;
    dueDate?: string | null;
    daysToDue: number | null;
    elapsedPct: number | null;
  };
  counts: { tasks: number; members: number; posts: number; files: number; meetings: number; blockers: number };
  statusMix: Bucket[];
  priorityMix: Bucket[];
  byDepartment: DeptRow[];
  trend: TrendPoint[];
  team: {
    userId: string;
    role: ProjectRoleKind;
    user: ProjectMember["user"];
    open: number;
    overdue: number;
    urgent: number;
    finished: number;
    avgCompletion: number;
  }[];
  lists: {
    urgent: Task[];
    overdue: Task[];
    dueSoon: Task[];
    stale: Task[];
    unassigned: Task[];
    finished: Task[];
    all: Task[];
  };
  blockers: BlockerRef[];
  updates: { id: string; body: string; createdAt: string; author?: { id: string; fullName: string } | null }[];
  files: Attachment[];
  meetings: { upcoming: Meeting[]; past: Meeting[] };
  activity: ActivityEntry[];
}

/** GET /api/tasks/:id/dashboard */
export interface TaskDashboard {
  task: Task;
  canEdit: boolean;
  canReportProgress: boolean;
  health: {
    rag: "done" | "red" | "amber" | "green" | "none";
    overdue: boolean;
    urgent: boolean;
    stale: boolean;
    daysToDue: number | null;
    ageDays: number;
    daysSinceUpdate: number;
    staleAfterDays: number;
  };
  counts: {
    posts: number;
    updates: number;
    blockers: number;
    directions: number;
    files: number;
    meetings: number;
    handovers: number;
    activity: number;
  };
  timeInStatus: { status: string; days: number }[];
  statusHistory: { at: string; status: string }[];
  contributors: { id: string; name: string; posts: number; lastAt: string }[];
  lastUpdate: Comment | null;
  openBlockers: Comment[];
  pinned: Comment[];
  recentUpdates: Comment[];
  files: Attachment[];
  meetings: { past: Meeting[]; upcoming: Meeting[] };
  activity: ActivityEntry[];
}
