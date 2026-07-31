export type TaskStatus = "YET_TO_BE_ASSIGNED" | "INITIATED" | "IN_PROGRESS" | "FINISHED" | "ON_HOLD";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface RoleRef {
  id: string;
  name: string;
  level: number;
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
  _count?: { departments: number; users: number };
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  officeId: string | null;
  role?: RoleRef | null;
  permissions?: string[];
  cagId?: string | null;
  designation?: string | null;
  wing?: string | null;
  avatarUrl?: string | null;
  departmentId?: string | null;
  department?: { id: string; name: string } | null;
  office?: { id: string; name: string; code?: string | null } | null;
}

export interface Person { id: string; fullName: string; designation?: string | null; wing?: string | null; }

export interface Comment {
  id: string;
  body: string;
  authorRole?: string | null;
  author?: Person | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  primaryLead?: Person | null;
  secondaryLead?: Person | null;
  currentlyWith?: Person | null;
  team?: { id: string; name: string } | null;
  assignedDate?: string | null;
  dueDate?: string | null;
  pctComplete: number | null;
  createdAt: string;
  updatedAt: string;
  comments?: Comment[];
  attachments?: Attachment[];
  createdBy?: Person | null;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  roleInTeam: string;
  user: Person;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  owner?: Person | null;
  members?: TeamMember[];
  _count?: { members: number; tasks: number };
}

export type RequestState =
  | "PENDING_APPROVAL"
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "DECLINED"
  | "REJECTED"
  | "CANCELLED";

export interface Assignment {
  id: string;
  state: RequestState;
  requiresApproval: boolean;
  message?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  from?: Person | null;
  to?: Person | null;
  toDepartment?: { id: string; name: string; headId?: string | null } | null;
  approvedBy?: Person | null;
  task?: { id: string; title: string };
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
  team?: { id: string; name: string } | null;
  participants?: MeetingParticipant[];
}

export interface SearchResults {
  tasks: { id: string; title: string; status: TaskStatus }[];
  people: { id: string; fullName: string; designation?: string | null; email: string }[];
  teams: { id: string; name: string }[];
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
