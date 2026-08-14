/**
 * Demo data.
 *
 * Wipes every piece of operational data and rebuilds a realistic office
 * network: eight CAG offices, their staff with working logins, projects, work
 * items, discussion threads, files, meetings, approvals and notifications.
 *
 * It is built so that every panel on every dashboard has something real to
 * show. That means the data is deliberately uneven: some work is overdue, some
 * is due today, some has been ignored for three weeks, some is blocked, some
 * has no lead, and some is finished early. A demo where everything is green
 * proves nothing.
 *
 *   npm run seed        (first, for permissions, roles and designations)
 *   npm run seed:demo   (this file)
 *
 * WARNING: this DELETES all offices, users, projects, work items, comments,
 * files, meetings and notifications. It is for a demo or test database. Do not
 * point it at anything carrying real work.
 */
import {
  CommentKind,
  MeetingMode,
  PrismaClient,
  ProjectRole,
  ProjectStatus,
  RequestScope,
  RequestState,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

/** Every demo login uses this. */
const PASSWORD = "Demo@12345";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** A date `n` days from now (negative = in the past), at a sensible hour. */
function day(n: number, hour = 11, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

/** Deterministic pseudo-random, so two runs produce the same demo. */
let seed = 20260813;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick<T>(list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)];
}
function chance(p: number): boolean {
  return rnd() < p;
}

// ---------------------------------------------------------------------------
// The office network
// ---------------------------------------------------------------------------

interface OfficeSpec {
  code: string;
  name: string;
  city: string;
  email: string;
  /** The demo puts most of its work in the "deep" offices. */
  depth: "deep" | "light";
  departments: { code: string; name: string }[];
}

const OFFICES: OfficeSpec[] = [
  {
    code: "COEFA",
    name: "Centre of Excellence for Financial Audit",
    city: "Hyderabad",
    email: "coefa@cag.gov.in",
    depth: "deep",
    departments: [
      { code: "COEFA-FA", name: "Financial Audit Wing" },
      { code: "COEFA-IS", name: "IS Audit Wing" },
      { code: "COEFA-TRG", name: "Training and Research" },
      { code: "COEFA-ADM", name: "Administration" },
    ],
  },
  {
    code: "CEDAR",
    name: "Centre of Excellence in Digital Audit of Revenue",
    city: "New Delhi",
    email: "cedar@cag.gov.in",
    depth: "deep",
    departments: [
      { code: "CEDAR-DA", name: "Digital Analytics" },
      { code: "CEDAR-REV", name: "Revenue Audit" },
      { code: "CEDAR-ADM", name: "Administration" },
    ],
  },
  {
    code: "CAG",
    name: "Comptroller and Auditor General of India",
    city: "New Delhi",
    email: "hq@cag.gov.in",
    depth: "deep",
    departments: [
      { code: "CAG-CO", name: "Coordination" },
      { code: "CAG-RC", name: "Report Central" },
      { code: "CAG-ADM", name: "Administration" },
    ],
  },
  {
    code: "DGA-AF-ND",
    name: "DG/PD OF AUDIT (AIR FORCE), NEW DELHI",
    city: "New Delhi",
    email: "dgaaf.delhi@cag.gov.in",
    depth: "deep",
    departments: [
      { code: "AF-DEF", name: "Defence Audit" },
      { code: "AF-STO", name: "Stores and Procurement" },
      { code: "AF-ADM", name: "Administration" },
    ],
  },
  {
    code: "BR-PAG-AU1-THRIS",
    name: "PAG/AG (AUDIT-I), KERALA, THRISSUR [BRANCH OFFICE]",
    city: "Thrissur",
    email: "pagau1.thrissur@cag.gov.in",
    depth: "light",
    departments: [
      { code: "THRIS-CIV", name: "Civil Audit" },
      { code: "THRIS-ADM", name: "Administration" },
    ],
  },
  {
    code: "BR-PAG-AU2-MUM",
    name: "PAG/AG (AUDIT-II), MAHARASHTRA AT MUMBAI [BRANCH OFFICE]",
    city: "Mumbai",
    email: "pagau2.mumbai@cag.gov.in",
    depth: "light",
    departments: [
      { code: "MUM-COM", name: "Commercial Audit" },
      { code: "MUM-ADM", name: "Administration" },
    ],
  },
  {
    code: "BR-PAG-AU2-PRYJ",
    name: "PAG/AG (AUDIT-II), UTTAR PRADESH, AT PRAYAGRAJ [BRANCH OFFICE]",
    city: "Prayagraj",
    email: "pagau2.prayagraj@cag.gov.in",
    depth: "light",
    departments: [
      { code: "PRYJ-CIV", name: "Civil Audit" },
      { code: "PRYJ-ADM", name: "Administration" },
    ],
  },
  {
    code: "BR-PAG-AU2-PURI",
    name: "PAG/AG (AUDIT-II), ODISHA, PURI [BRANCH OFFICE]",
    city: "Puri",
    email: "pagau2.puri@cag.gov.in",
    depth: "light",
    departments: [
      { code: "PURI-LB", name: "Local Bodies Audit" },
      { code: "PURI-ADM", name: "Administration" },
    ],
  },
  {
    code: "BR-PAG-AU2-PY",
    name: "PAG/AG (AUDIT-II), TAMIL NADU, PUDUCHERRY [BRANCH OFFICE]",
    city: "Puducherry",
    email: "pagau2.puducherry@cag.gov.in",
    depth: "light",
    departments: [
      { code: "PY-CIV", name: "Civil Audit" },
      { code: "PY-ADM", name: "Administration" },
    ],
  },
];

// ---------------------------------------------------------------------------
// People. Role = what you may do. Designation = the post you hold.
// ---------------------------------------------------------------------------

interface PersonSpec {
  key: string;
  fullName: string;
  email: string;
  role: "Super Admin" | "Office Admin" | "Head" | "Staff";
  desig: string;
  dept: string;
  cadre: string;
  mobile: string;
  /** key of this person's manager, within the same office */
  manager?: string;
}

/** Names used to populate the branch offices, kept plausible and regional. */
const HEAD_NAMES: Record<string, string> = {
  "BR-PAG-AU1-THRIS": "Leela Nambiar",
  "BR-PAG-AU2-MUM": "Sanjay Deshmukh",
  "BR-PAG-AU2-PRYJ": "Aruna Tripathi",
  "BR-PAG-AU2-PURI": "Bijay Mohanty",
  "BR-PAG-AU2-PY": "Kamala Rangarajan",
};

const STAFF_NAMES: Record<string, string[]> = {
  "BR-PAG-AU1-THRIS": ["Rajesh Pillai", "Anitha Menon", "Vivek Warrier"],
  "BR-PAG-AU2-MUM": ["Prakash Joshi", "Nisha Kulkarni", "Farhan Shaikh"],
  "BR-PAG-AU2-PRYJ": ["Sunita Yadav", "Alok Mishra", "Rehana Siddiqui"],
  "BR-PAG-AU2-PURI": ["Prasanta Sahu", "Jyoti Patnaik", "Debashis Rout"],
  "BR-PAG-AU2-PY": ["Murugan Selvam", "Divya Ramesh", "Antoine Fernandes"],
};

/** The four deep offices get a full, hand-written roster. */
const DEEP_PEOPLE: Record<string, PersonSpec[]> = {
  COEFA: [
    { key: "coefa.head", fullName: "Radhika Menon", email: "dg.coefa@cag.gov.in", role: "Head", desig: "Director General", dept: "COEFA-ADM", cadre: "IA&AS", mobile: "9840100001" },
    { key: "coefa.dag", fullName: "Krishnan Iyer", email: "dag.coefa@cag.gov.in", role: "Head", desig: "Deputy Accountant General", dept: "COEFA-ADM", cadre: "IA&AS", mobile: "9840100002", manager: "coefa.head" },
    { key: "coefa.sao1", fullName: "Sridhar Rao", email: "sao1.coefa@cag.gov.in", role: "Staff", desig: "Senior Audit Officer", dept: "COEFA-FA", cadre: "Group B (SOGE)", mobile: "9840100003", manager: "coefa.dag" },
    { key: "coefa.sao2", fullName: "Vasanthi Nair", email: "sao2.coefa@cag.gov.in", role: "Staff", desig: "Senior Audit Officer", dept: "COEFA-IS", cadre: "Group B (SOGE)", mobile: "9840100004", manager: "coefa.dag" },
    { key: "coefa.aao1", fullName: "Prakash Shetty", email: "aao1.coefa@cag.gov.in", role: "Staff", desig: "Assistant Audit Officer", dept: "COEFA-FA", cadre: "Group B", mobile: "9840100005", manager: "coefa.sao1" },
    { key: "coefa.aao2", fullName: "Meera Chandran", email: "aao2.coefa@cag.gov.in", role: "Staff", desig: "Assistant Audit Officer", dept: "COEFA-IS", cadre: "Group B", mobile: "9840100006", manager: "coefa.sao2" },
    { key: "coefa.aud1", fullName: "Vinod Kumar", email: "aud1.coefa@cag.gov.in", role: "Staff", desig: "Senior Auditor", dept: "COEFA-FA", cadre: "Group C", mobile: "9840100007", manager: "coefa.aao1" },
    { key: "coefa.aud2", fullName: "Shalini Gupta", email: "aud2.coefa@cag.gov.in", role: "Staff", desig: "Auditor", dept: "COEFA-IS", cadre: "Group C", mobile: "9840100008", manager: "coefa.aao2" },
    { key: "coefa.trg", fullName: "Nagesh Trivedi", email: "trg.coefa@cag.gov.in", role: "Staff", desig: "Supervisor", dept: "COEFA-TRG", cadre: "Group B", mobile: "9840100009", manager: "coefa.dag" },
    { key: "coefa.cons", fullName: "Ayesha Qureshi", email: "cons.coefa@cag.gov.in", role: "Staff", desig: "Consultant", dept: "COEFA-TRG", cadre: "Contract", mobile: "9840100010", manager: "coefa.trg" },
  ],
  CEDAR: [
    { key: "cedar.head", fullName: "Arun Bhattacharya", email: "dg.cedar@cag.gov.in", role: "Head", desig: "Director General", dept: "CEDAR-ADM", cadre: "IA&AS", mobile: "9840200001" },
    { key: "cedar.dir", fullName: "Tanvi Grewal", email: "dir.cedar@cag.gov.in", role: "Head", desig: "Director", dept: "CEDAR-DA", cadre: "IA&AS", mobile: "9840200002", manager: "cedar.head" },
    { key: "cedar.sao1", fullName: "Deepak Sharma", email: "sao1.cedar@cag.gov.in", role: "Staff", desig: "Senior Audit Officer", dept: "CEDAR-DA", cadre: "Group B (SOGE)", mobile: "9840200003", manager: "cedar.dir" },
    { key: "cedar.sao2", fullName: "Ritu Malhotra", email: "sao2.cedar@cag.gov.in", role: "Staff", desig: "Senior Audit Officer", dept: "CEDAR-REV", cadre: "Group B (SOGE)", mobile: "9840200004", manager: "cedar.dir" },
    { key: "cedar.aao1", fullName: "Imran Ansari", email: "aao1.cedar@cag.gov.in", role: "Staff", desig: "Assistant Audit Officer", dept: "CEDAR-DA", cadre: "Group B", mobile: "9840200005", manager: "cedar.sao1" },
    { key: "cedar.aao2", fullName: "Kavita Bansal", email: "aao2.cedar@cag.gov.in", role: "Staff", desig: "Assistant Audit Officer", dept: "CEDAR-REV", cadre: "Group B", mobile: "9840200006", manager: "cedar.sao2" },
    { key: "cedar.yp", fullName: "Rohit Verma", email: "yp.cedar@cag.gov.in", role: "Staff", desig: "Young Professional", dept: "CEDAR-DA", cadre: "Contract", mobile: "9840200007", manager: "cedar.aao1" },
  ],
  CAG: [
    { key: "cag.head", fullName: "Sudhir Raghavan", email: "hq.head@cag.gov.in", role: "Head", desig: "Principal Accountant General", dept: "CAG-ADM", cadre: "IA&AS", mobile: "9840300001" },
    { key: "cag.dir", fullName: "Neelam Kaushik", email: "dir.hq@cag.gov.in", role: "Head", desig: "Director", dept: "CAG-CO", cadre: "IA&AS", mobile: "9840300002", manager: "cag.head" },
    { key: "cag.sao", fullName: "Girish Patel", email: "sao.hq@cag.gov.in", role: "Staff", desig: "Senior Audit Officer", dept: "CAG-RC", cadre: "Group B (SOGE)", mobile: "9840300003", manager: "cag.dir" },
    { key: "cag.aao", fullName: "Lakshmi Subramanian", email: "aao.hq@cag.gov.in", role: "Staff", desig: "Assistant Audit Officer", dept: "CAG-RC", cadre: "Group B", mobile: "9840300004", manager: "cag.sao" },
    { key: "cag.co", fullName: "Harpreet Sandhu", email: "co.hq@cag.gov.in", role: "Staff", desig: "Administrative Officer", dept: "CAG-CO", cadre: "Group B", mobile: "9840300005", manager: "cag.dir" },
  ],
  "DGA-AF-ND": [
    { key: "af.head", fullName: "Vikram Chauhan", email: "dg.airforce@cag.gov.in", role: "Head", desig: "Director General", dept: "AF-ADM", cadre: "IA&AS", mobile: "9840400001" },
    { key: "af.dir", fullName: "Shobha Rani", email: "dir.airforce@cag.gov.in", role: "Head", desig: "Director", dept: "AF-DEF", cadre: "IA&AS", mobile: "9840400002", manager: "af.head" },
    { key: "af.sao", fullName: "Manish Dubey", email: "sao.airforce@cag.gov.in", role: "Staff", desig: "Senior Audit Officer", dept: "AF-DEF", cadre: "Group B (SOGE)", mobile: "9840400003", manager: "af.dir" },
    { key: "af.aao1", fullName: "Reena Thomas", email: "aao1.airforce@cag.gov.in", role: "Staff", desig: "Assistant Audit Officer", dept: "AF-STO", cadre: "Group B", mobile: "9840400004", manager: "af.sao" },
    { key: "af.aud", fullName: "Balbir Singh", email: "aud.airforce@cag.gov.in", role: "Staff", desig: "Senior Auditor", dept: "AF-STO", cadre: "Group C", mobile: "9840400005", manager: "af.aao1" },
  ],
};

// ---------------------------------------------------------------------------
// Work content. Written out rather than generated from word lists, because a
// demo full of "Task 17" tells a viewer nothing about what the system is for.
// ---------------------------------------------------------------------------

interface ProjectSpec {
  office: string;
  name: string;
  code: string;
  description: string;
  status: ProjectStatus;
  priority: TaskPriority;
  dept: string;
  startOffset: number;
  dueOffset: number;
  /** How long since anyone posted a project-level update. */
  quietDays: number;
  lead: string;
  second?: string;
  members: string[];
  observers?: string[];
  tasks: TaskSpec[];
}

interface TaskSpec {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** null means no due date at all, which the dashboards call out. */
  dueOffset: number | null;
  pct: number;
  /** Days since progress was last reported. Big numbers go stale. */
  updatedDaysAgo: number;
  lead?: string;
  second?: string;
  with?: string;
  dept?: string;
  createdDaysAgo: number;
}

const PROJECTS: ProjectSpec[] = [
  // ---------------- CoEFA Hyderabad ----------------
  {
    office: "COEFA",
    name: "Financial Attest Audit of Union Accounts 2025-26",
    code: "FAA-2026",
    description:
      "Attest audit of the Union Finance Accounts and Appropriation Accounts for 2025-26, covering consolidation, sample selection, substantive testing and the draft certificate.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.URGENT,
    dept: "COEFA-FA",
    startOffset: -70,
    dueOffset: 25,
    quietDays: 1,
    lead: "coefa.sao1",
    second: "coefa.aao1",
    members: ["coefa.aud1", "coefa.dag", "coefa.aao2"],
    observers: ["coefa.head"],
    tasks: [
      { title: "Consolidate Finance Accounts from all 28 field offices", description: "Collect, reconcile and consolidate the statement-wise returns. Two offices are still to respond.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.URGENT, dueOffset: -6, pct: 70, updatedDaysAgo: 1, lead: "coefa.sao1", with: "coefa.aao1", dept: "COEFA-FA", createdDaysAgo: 62 },
      { title: "Sample selection for substantive testing", description: "Draw the monetary-unit sample across grants above the materiality threshold and document the basis.", status: TaskStatus.FINISHED, priority: TaskPriority.HIGH, dueOffset: -20, pct: 100, updatedDaysAgo: 18, lead: "coefa.aao1", with: "coefa.aao1", dept: "COEFA-FA", createdDaysAgo: 60 },
      { title: "Test grant-in-aid expenditure above materiality", description: "Substantive testing of grant-in-aid releases, with utilisation certificate coverage.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffset: 2, pct: 45, updatedDaysAgo: 2, lead: "coefa.aud1", with: "coefa.aud1", dept: "COEFA-FA", createdDaysAgo: 40 },
      { title: "Reconcile suspense and remittance balances", description: "Outstanding suspense heads to be cleared or reported. Depends on the field office returns.", status: TaskStatus.ON_HOLD, priority: TaskPriority.NORMAL, dueOffset: 9, pct: 20, updatedDaysAgo: 16, lead: "coefa.aao1", with: "coefa.aud1", dept: "COEFA-FA", createdDaysAgo: 38 },
      { title: "Draft the audit certificate", description: "Prepare the draft certificate and the accompanying management letter.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.HIGH, dueOffset: 20, pct: 0, updatedDaysAgo: 4, dept: "COEFA-FA", createdDaysAgo: 12 },
      { title: "Quality review of working papers", description: "Independent review of the audit file before the certificate is signed.", status: TaskStatus.INITIATED, priority: TaskPriority.NORMAL, dueOffset: 18, pct: 5, updatedDaysAgo: 3, lead: "coefa.dag", with: "coefa.dag", dept: "COEFA-FA", createdDaysAgo: 10 },
      { title: "Compile prior-year audit observations status", description: "Track which of last year's observations have been settled.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.LOW, dueOffset: null, pct: 35, updatedDaysAgo: 23, lead: "coefa.aud1", with: "coefa.aud1", dept: "COEFA-FA", createdDaysAgo: 45 },
    ],
  },
  {
    office: "COEFA",
    name: "IS Audit of the Integrated Financial Management System",
    code: "ISA-IFMS",
    description:
      "General and application controls review of IFMS: access management, change control, interface integrity and the audit trail.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.HIGH,
    dept: "COEFA-IS",
    startOffset: -45,
    dueOffset: 40,
    quietDays: 3,
    lead: "coefa.sao2",
    second: "coefa.aao2",
    members: ["coefa.aud2", "coefa.cons"],
    observers: ["coefa.dag"],
    tasks: [
      { title: "Review user access and segregation of duties", description: "Extract the full role matrix and test for toxic combinations and dormant privileged accounts.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffset: 0, pct: 60, updatedDaysAgo: 0, lead: "coefa.sao2", with: "coefa.aao2", dept: "COEFA-IS", createdDaysAgo: 40 },
      { title: "Test change management controls", description: "Sample production changes and trace each back to an approved request.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.NORMAL, dueOffset: 11, pct: 30, updatedDaysAgo: 5, lead: "coefa.aud2", with: "coefa.aud2", dept: "COEFA-IS", createdDaysAgo: 35 },
      { title: "Validate interface integrity with the treasury system", description: "Reconcile record counts and control totals across the nightly interface for a sample month.", status: TaskStatus.ON_HOLD, priority: TaskPriority.HIGH, dueOffset: 6, pct: 15, updatedDaysAgo: 12, lead: "coefa.aao2", with: "coefa.aao2", dept: "COEFA-IS", createdDaysAgo: 30 },
      { title: "Assess audit trail completeness", description: "Confirm that the application log captures the fields the audit needs and that it cannot be edited.", status: TaskStatus.INITIATED, priority: TaskPriority.NORMAL, dueOffset: 25, pct: 0, updatedDaysAgo: 26, lead: "coefa.cons", with: "coefa.cons", dept: "COEFA-IS", createdDaysAgo: 28 },
      { title: "Draft IS audit findings", description: "Consolidate findings with risk ratings and recommendations.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.NORMAL, dueOffset: 35, pct: 0, updatedDaysAgo: 6, dept: "COEFA-IS", createdDaysAgo: 8 },
    ],
  },
  {
    office: "COEFA",
    name: "Capacity Building Programme on Financial Audit",
    code: "TRG-2026",
    description: "Design and deliver the residential programme on financial attest audit for field office staff.",
    status: ProjectStatus.PLANNING,
    priority: TaskPriority.NORMAL,
    dept: "COEFA-TRG",
    startOffset: -12,
    dueOffset: 65,
    quietDays: 8,
    lead: "coefa.trg",
    members: ["coefa.cons", "coefa.aao1"],
    tasks: [
      { title: "Finalise the course curriculum", description: "Six-day curriculum with case studies drawn from recent attest engagements.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.NORMAL, dueOffset: 14, pct: 50, updatedDaysAgo: 4, lead: "coefa.trg", with: "coefa.trg", dept: "COEFA-TRG", createdDaysAgo: 12 },
      { title: "Identify and confirm faculty", description: "Confirm internal and external faculty for each session.", status: TaskStatus.INITIATED, priority: TaskPriority.LOW, dueOffset: 30, pct: 10, updatedDaysAgo: 9, lead: "coefa.cons", with: "coefa.cons", dept: "COEFA-TRG", createdDaysAgo: 11 },
      { title: "Book venue and residential facilities", description: "Venue for 40 participants with accommodation.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.NORMAL, dueOffset: 22, pct: 0, updatedDaysAgo: 11, dept: "COEFA-TRG", createdDaysAgo: 11 },
    ],
  },
  {
    office: "COEFA",
    name: "Audit of Autonomous Bodies 2024-25",
    code: "AB-2025",
    description: "Certification audit of twelve autonomous bodies. Completed and closed; retained for the record.",
    status: ProjectStatus.COMPLETED,
    priority: TaskPriority.LOW,
    dept: "COEFA-FA",
    startOffset: -190,
    dueOffset: -30,
    quietDays: 32,
    lead: "coefa.sao1",
    members: ["coefa.aao1", "coefa.aud1"],
    tasks: [
      { title: "Certify accounts of all twelve bodies", description: "All certificates issued and transmitted.", status: TaskStatus.FINISHED, priority: TaskPriority.NORMAL, dueOffset: -35, pct: 100, updatedDaysAgo: 34, lead: "coefa.sao1", with: "coefa.sao1", dept: "COEFA-FA", createdDaysAgo: 180 },
      { title: "Issue separate audit reports", description: "Separate audit reports issued for each body.", status: TaskStatus.FINISHED, priority: TaskPriority.NORMAL, dueOffset: -31, pct: 100, updatedDaysAgo: 31, lead: "coefa.aao1", with: "coefa.aao1", dept: "COEFA-FA", createdDaysAgo: 170 },
    ],
  },

  // ---------------- CEDAR New Delhi ----------------
  {
    office: "CEDAR",
    name: "GST Revenue Analytics: Input Tax Credit Mismatch",
    code: "GST-ITC",
    description:
      "Data-driven audit of input tax credit claims, matching GSTR-2A against GSTR-3B at scale to identify systemic mismatch patterns.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.URGENT,
    dept: "CEDAR-DA",
    startOffset: -55,
    dueOffset: 12,
    quietDays: 0,
    lead: "cedar.sao1",
    second: "cedar.aao1",
    members: ["cedar.yp", "cedar.dir"],
    observers: ["cedar.head"],
    tasks: [
      { title: "Ingest and validate GSTN return extracts", description: "Load 14 months of return data and validate row counts and control totals against the source.", status: TaskStatus.FINISHED, priority: TaskPriority.HIGH, dueOffset: -25, pct: 100, updatedDaysAgo: 24, lead: "cedar.yp", with: "cedar.yp", dept: "CEDAR-DA", createdDaysAgo: 54 },
      { title: "Build the ITC mismatch detection model", description: "Rule set plus outlier detection to rank taxpayers by mismatch risk.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.URGENT, dueOffset: -2, pct: 80, updatedDaysAgo: 0, lead: "cedar.sao1", with: "cedar.sao1", dept: "CEDAR-DA", createdDaysAgo: 48 },
      { title: "Field verification of the top 50 flagged cases", description: "Physical verification through the jurisdictional commissionerates.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffset: 3, pct: 40, updatedDaysAgo: 1, lead: "cedar.aao1", with: "cedar.aao1", dept: "CEDAR-REV", createdDaysAgo: 30 },
      { title: "Quantify revenue impact", description: "Compute the money value of confirmed mismatches for the draft paragraph.", status: TaskStatus.INITIATED, priority: TaskPriority.HIGH, dueOffset: 8, pct: 5, updatedDaysAgo: 2, lead: "cedar.aao2", with: "cedar.aao2", dept: "CEDAR-REV", createdDaysAgo: 20 },
      { title: "Draft paragraph for the Audit Report", description: "Draft para with the methodology annexe.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.URGENT, dueOffset: 10, pct: 0, updatedDaysAgo: 2, dept: "CEDAR-REV", createdDaysAgo: 9 },
      { title: "Document the analytics methodology for reuse", description: "Write up the pipeline so other offices can repeat it.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.LOW, dueOffset: 45, pct: 25, updatedDaysAgo: 19, lead: "cedar.yp", with: "cedar.yp", dept: "CEDAR-DA", createdDaysAgo: 25 },
    ],
  },
  {
    office: "CEDAR",
    name: "Customs Duty Exemption Notification Review",
    code: "CUS-EXM",
    description: "Review of duty exemption notifications and their revenue forgone, with a focus on end-use conditions.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.NORMAL,
    dept: "CEDAR-REV",
    startOffset: -30,
    dueOffset: 55,
    quietDays: 14,
    lead: "cedar.sao2",
    members: ["cedar.aao2", "cedar.aao1"],
    tasks: [
      { title: "Compile revenue forgone by notification", description: "Three-year series of revenue forgone under each active notification.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.NORMAL, dueOffset: 16, pct: 55, updatedDaysAgo: 13, lead: "cedar.sao2", with: "cedar.sao2", dept: "CEDAR-REV", createdDaysAgo: 29 },
      { title: "Test end-use compliance for a sample of importers", description: "Verify that goods cleared at concessional rates were used as declared.", status: TaskStatus.INITIATED, priority: TaskPriority.NORMAL, dueOffset: 34, pct: 0, updatedDaysAgo: 15, lead: "cedar.aao2", with: "cedar.aao2", dept: "CEDAR-REV", createdDaysAgo: 22 },
      { title: "Review the bond and bank guarantee register", description: "Confirm bonds are live and guarantees adequate.", status: TaskStatus.ON_HOLD, priority: TaskPriority.LOW, dueOffset: null, pct: 10, updatedDaysAgo: 21, lead: "cedar.aao1", with: "cedar.aao1", dept: "CEDAR-REV", createdDaysAgo: 20 },
    ],
  },

  // ---------------- CAG Headquarters ----------------
  {
    office: "CAG",
    name: "Consolidation of Audit Report (Union Government) 2025-26",
    code: "AR-UNION",
    description:
      "Consolidate draft paragraphs from all field offices into the Audit Report for placement before Parliament.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.URGENT,
    dept: "CAG-RC",
    startOffset: -40,
    dueOffset: 8,
    quietDays: 2,
    lead: "cag.sao",
    second: "cag.aao",
    members: ["cag.co", "cag.dir"],
    observers: ["cag.head"],
    tasks: [
      { title: "Collect draft paragraphs from field offices", description: "38 paragraphs expected; 31 received so far.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.URGENT, dueOffset: -3, pct: 82, updatedDaysAgo: 1, lead: "cag.sao", with: "cag.sao", dept: "CAG-RC", createdDaysAgo: 39 },
      { title: "Editorial and consistency review", description: "House style, figures cross-checked against annexures.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffset: 1, pct: 45, updatedDaysAgo: 0, lead: "cag.aao", with: "cag.aao", dept: "CAG-RC", createdDaysAgo: 25 },
      { title: "Obtain departmental replies on outstanding paragraphs", description: "Chase replies from four ministries yet to respond.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.URGENT, dueOffset: -1, pct: 60, updatedDaysAgo: 2, lead: "cag.co", with: "cag.co", dept: "CAG-CO", createdDaysAgo: 30 },
      { title: "Prepare the printing and tabling schedule", description: "Coordinate with the press and the Ministry for the tabling date.", status: TaskStatus.INITIATED, priority: TaskPriority.HIGH, dueOffset: 5, pct: 10, updatedDaysAgo: 3, lead: "cag.co", with: "cag.co", dept: "CAG-CO", createdDaysAgo: 15 },
      { title: "Executive summary and highlights note", description: "Two-page summary for the press release.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.HIGH, dueOffset: 6, pct: 0, updatedDaysAgo: 3, dept: "CAG-RC", createdDaysAgo: 7 },
    ],
  },
  {
    office: "CAG",
    name: "Inter-office Coordination of Thematic Audits",
    code: "COORD-TH",
    description: "Coordinate thematic audits running across multiple field offices and track their milestones centrally.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.NORMAL,
    dept: "CAG-CO",
    startOffset: -60,
    dueOffset: 80,
    quietDays: 18,
    lead: "cag.dir",
    members: ["cag.co", "cag.sao"],
    tasks: [
      { title: "Publish the common audit guidelines", description: "Issue guidelines so every participating office applies the same criteria.", status: TaskStatus.FINISHED, priority: TaskPriority.NORMAL, dueOffset: -40, pct: 100, updatedDaysAgo: 40, lead: "cag.dir", with: "cag.dir", dept: "CAG-CO", createdDaysAgo: 58 },
      { title: "Monthly milestone tracking with field offices", description: "Standing monthly review of progress across offices.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.NORMAL, dueOffset: 30, pct: 40, updatedDaysAgo: 17, lead: "cag.co", with: "cag.co", dept: "CAG-CO", createdDaysAgo: 55 },
      { title: "Consolidate interim findings", description: "Pull interim findings into a single note for the DG.", status: TaskStatus.INITIATED, priority: TaskPriority.LOW, dueOffset: null, pct: 0, updatedDaysAgo: 29, lead: "cag.sao", with: "cag.sao", dept: "CAG-CO", createdDaysAgo: 30 },
    ],
  },

  // ---------------- DG Audit (Air Force) ----------------
  {
    office: "DGA-AF-ND",
    name: "Audit of Aircraft Spares Procurement",
    code: "AF-SPARES",
    description:
      "Audit of spares procurement contracts: tendering, price reasonableness, delivery performance and inventory holding.",
    status: ProjectStatus.ACTIVE,
    priority: TaskPriority.HIGH,
    dept: "AF-STO",
    startOffset: -50,
    dueOffset: 20,
    quietDays: 4,
    lead: "af.sao",
    second: "af.aao1",
    members: ["af.aud", "af.dir"],
    observers: ["af.head"],
    tasks: [
      { title: "Review tender files for contracts above the threshold", description: "Examine 24 contract files for competitive tendering and deviation approvals.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffset: -4, pct: 65, updatedDaysAgo: 3, lead: "af.sao", with: "af.sao", dept: "AF-STO", createdDaysAgo: 48 },
      { title: "Price reasonableness analysis against prior purchases", description: "Compare unit rates against the last three purchase orders for the same part numbers.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.NORMAL, dueOffset: 7, pct: 35, updatedDaysAgo: 4, lead: "af.aao1", with: "af.aao1", dept: "AF-STO", createdDaysAgo: 40 },
      { title: "Analyse inventory holding and non-moving items", description: "Quantify capital locked in non-moving spares over five years old.", status: TaskStatus.ON_HOLD, priority: TaskPriority.NORMAL, dueOffset: 14, pct: 20, updatedDaysAgo: 15, lead: "af.aud", with: "af.aud", dept: "AF-STO", createdDaysAgo: 35 },
      { title: "Verify delivery performance and liquidated damages", description: "Check whether LD was levied where deliveries were late.", status: TaskStatus.INITIATED, priority: TaskPriority.HIGH, dueOffset: 12, pct: 0, updatedDaysAgo: 5, lead: "af.aud", with: "af.aud", dept: "AF-STO", createdDaysAgo: 20 },
      { title: "Draft observations for the inspection report", description: "Consolidate into the draft inspection report.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.NORMAL, dueOffset: 18, pct: 0, updatedDaysAgo: 5, dept: "AF-DEF", createdDaysAgo: 10 },
    ],
  },
  {
    office: "DGA-AF-ND",
    name: "Review of Base Repair Depot Operations",
    code: "AF-BRD",
    description: "Performance review of the base repair depots: turnaround time, capacity use and outsourcing decisions.",
    status: ProjectStatus.ON_HOLD,
    priority: TaskPriority.NORMAL,
    dept: "AF-DEF",
    startOffset: -25,
    dueOffset: 60,
    quietDays: 22,
    lead: "af.dir",
    members: ["af.sao", "af.aao1"],
    tasks: [
      { title: "Obtain turnaround time data for three depots", description: "Awaiting formal clearance for the data request.", status: TaskStatus.ON_HOLD, priority: TaskPriority.NORMAL, dueOffset: 20, pct: 15, updatedDaysAgo: 21, lead: "af.dir", with: "af.dir", dept: "AF-DEF", createdDaysAgo: 24 },
      { title: "Scoping note for the performance review", description: "Audit objectives, criteria and scope.", status: TaskStatus.FINISHED, priority: TaskPriority.NORMAL, dueOffset: -14, pct: 100, updatedDaysAgo: 15, lead: "af.dir", with: "af.dir", dept: "AF-DEF", createdDaysAgo: 25 },
    ],
  },
];

/** Each branch office gets one modest project so its dashboard is not empty. */
const BRANCH_PROJECTS: { office: string; name: string; code: string; description: string; priority: TaskPriority }[] = [
  { office: "BR-PAG-AU1-THRIS", name: "Audit of Local Self Government Institutions", code: "THRIS-LSGI", description: "Certification and compliance audit of panchayats and municipalities in the district.", priority: TaskPriority.NORMAL },
  { office: "BR-PAG-AU2-MUM", name: "Commercial Audit of State Public Sector Undertakings", code: "MUM-PSU", description: "Supplementary audit of the accounts of state PSUs under section 619.", priority: TaskPriority.HIGH },
  { office: "BR-PAG-AU2-PRYJ", name: "Compliance Audit of Public Works Division", code: "PRYJ-PWD", description: "Compliance audit of road and building works executed by the division.", priority: TaskPriority.NORMAL },
  { office: "BR-PAG-AU2-PURI", name: "Audit of Urban Local Bodies", code: "PURI-ULB", description: "Audit of municipal receipts, property tax assessment and grant utilisation.", priority: TaskPriority.NORMAL },
  { office: "BR-PAG-AU2-PY", name: "Audit of Social Welfare Schemes", code: "PY-SW", description: "Compliance audit of centrally sponsored social welfare schemes in the UT.", priority: TaskPriority.HIGH },
];

const BRANCH_TASKS: { title: string; description: string; status: TaskStatus; priority: TaskPriority; dueOffset: number | null; pct: number; updatedDaysAgo: number }[] = [
  { title: "Entry conference with the auditee", description: "Hold the entry conference and record the scope agreed.", status: TaskStatus.FINISHED, priority: TaskPriority.NORMAL, dueOffset: -22, pct: 100, updatedDaysAgo: 22 },
  { title: "Examine records and vouchers for the sample period", description: "Substantive examination of the selected months.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffset: 4, pct: 55, updatedDaysAgo: 2 },
  { title: "Issue audit memos and obtain replies", description: "Issue memos on the observations raised and pursue replies.", status: TaskStatus.IN_PROGRESS, priority: TaskPriority.NORMAL, dueOffset: -2, pct: 40, updatedDaysAgo: 8 },
  { title: "Draft the inspection report", description: "Consolidate observations into the draft inspection report.", status: TaskStatus.INITIATED, priority: TaskPriority.NORMAL, dueOffset: 16, pct: 5, updatedDaysAgo: 12 },
  { title: "Exit conference and settlement of minor paras", description: "Settle minor paragraphs at the exit conference.", status: TaskStatus.YET_TO_BE_ASSIGNED, priority: TaskPriority.LOW, dueOffset: 28, pct: 0, updatedDaysAgo: 14 },
];

// ---------------------------------------------------------------------------
// Discussion content, per kind. Picked at random but written to sound like
// something an audit officer would actually type.
// ---------------------------------------------------------------------------

const REMARKS = [
  "Records for the second quarter have been received. Starting the examination tomorrow.",
  "The auditee has requested a week's extension for the reply. I have said no, given the tabling date.",
  "Cross-checked the figures against the annexure. Two entries differ by rounding only.",
  "Discussed with the section officer. The register was maintained manually until October, which explains the gap.",
  "I have kept a copy of the sanction order in the working papers.",
  "Reply received but it does not address the substance of the observation. Pursuing.",
  "Sample expanded from 30 to 45 cases after the error rate came out higher than expected.",
  "Noted. I will pick this up once the consolidation work is off my desk.",
  "The department has accepted the observation and says recovery is under way.",
  "Working papers indexed and filed. Ready for review whenever you are.",
];

const DIRECTIONS = [
  "Please complete this before the review meeting on Friday. It is on the critical path for the certificate.",
  "Priority. The tabling date will not move, so treat this as the first item every morning.",
  "Take the AAO's help on the sampling. Do not expand the sample further without discussing it with me.",
  "Route the memo through me before it goes to the department.",
  "Bring the working papers to the next review. I want to see the basis for the materiality figure.",
];

const DECISIONS = [
  "Decided in the review meeting: materiality is fixed at 2% of gross expenditure for this engagement.",
  "We will report the mismatch cases in aggregate rather than individually, given the volume.",
  "Agreed that the interface testing will cover one full month rather than a sample of days.",
  "The paragraph will be dropped. The department's reply is satisfactory and supported by evidence.",
  "Decided to carry this forward to next year's programme rather than rush it now.",
];

const BLOCKERS = [
  "Blocked: the two field offices have still not sent their returns despite three reminders. Consolidation cannot be completed without them.",
  "Blocked: read-only access to the production database has not been granted. The request has been pending with the department for eleven days.",
  "Blocked: awaiting formal clearance for the data request. Nothing can move until it comes.",
  "Blocked: the auditee says the original files are with the vigilance wing and cannot be produced.",
];

const UPDATES = [
  "Examination of the sample is roughly two thirds done. No significant issues so far beyond the ones already flagged.",
  "Made good progress this week. The remaining work is mostly documentation.",
  "Slower than planned because the records arrived incomplete. Should recover the time next week.",
  "All fieldwork is complete. Moving on to drafting.",
  "Half the cases are verified. The error rate is holding at about 8%, which is higher than last year.",
  "Picked this up today and got through the preliminary scrutiny.",
];

const PROJECT_UPDATES = [
  "Weekly position: fieldwork is broadly on schedule, but the consolidation task is the constraint. Everything else can absorb a few days' slip; that one cannot.",
  "Position this week: two tasks moved to finished, one new blocker raised on data access. Overall we are about four days behind where I wanted to be.",
  "Good week. The analytics pipeline is producing usable output and the field verification has started ahead of plan.",
  "Progress has been slow this fortnight because two of the team were on other duty. I have reallocated the substantive testing.",
];

/** Files written to the upload directory so download and preview actually work. */
const DEMO_FILES: { fileName: string; mimeType: string; body: string }[] = [
  {
    fileName: "sample-selection-basis.md",
    mimeType: "text/markdown",
    body:
      "# Sample selection basis\n\n" +
      "Population: all grant-in-aid releases above the materiality threshold.\n\n" +
      "| Parameter | Value |\n|---|---|\n| Materiality | 2% of gross expenditure |\n" +
      "| Population size | 1,842 releases |\n| Sample size | 45 |\n| Method | Monetary unit sampling |\n\n" +
      "Sample expanded from 30 to 45 after the initial error rate exceeded expectations.\n",
  },
  {
    fileName: "observation-register.csv",
    mimeType: "text/csv",
    body:
      "sl,observation,money_value_lakh,status,reply_received\n" +
      "1,Utilisation certificates not obtained,412.50,Pursued,No\n" +
      "2,Excess payment against contract rates,88.20,Accepted,Yes\n" +
      "3,Non-levy of liquidated damages,156.75,Pursued,Yes\n" +
      "4,Idle inventory beyond five years,2310.00,Under examination,No\n" +
      "5,Short recovery of licence fee,19.40,Settled,Yes\n",
  },
  {
    fileName: "working-notes.txt",
    mimeType: "text/plain",
    body:
      "Working notes\n=============\n\n" +
      "- Register maintained manually until October; entries after that are in the system.\n" +
      "- Section officer confirmed the gap is a records issue, not a transaction issue.\n" +
      "- Copy of sanction order placed in the file at flag A.\n" +
      "- Figures reconciled with the annexure; differences are rounding only.\n",
  },
  {
    fileName: "audit-memo-draft.md",
    mimeType: "text/markdown",
    body:
      "# Draft audit memo\n\n" +
      "**To:** The Head of Office\n\n**Subject:** Non-obtainment of utilisation certificates\n\n" +
      "During test check of grant-in-aid releases it was noticed that utilisation certificates\n" +
      "in respect of 23 releases aggregating Rs. 412.50 lakh were not on record.\n\n" +
      "The reply of the department is requested within fifteen days.\n",
  },
  {
    fileName: "meeting-minutes.txt",
    mimeType: "text/plain",
    body:
      "Minutes of the review meeting\n\n" +
      "1. Materiality fixed at 2% of gross expenditure.\n" +
      "2. Consolidation identified as the critical path item.\n" +
      "3. Two field offices to be issued a final reminder.\n" +
      "4. Next review in one week.\n",
  },
];

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

/**
 * Deletes operational data in dependency order.
 *
 * Most of these would cascade anyway, but doing it explicitly means the script
 * fails loudly on a schema change rather than silently leaving orphans behind.
 * Permissions, roles and designations are deliberately NOT touched: they are
 * configuration, and `npm run seed` owns them.
 */
async function wipe(): Promise<void> {
  console.log("Clearing existing data...");

  await prisma.attachment.deleteMany({});
  await prisma.taskComment.deleteMany({});
  await prisma.projectComment.deleteMany({});
  await prisma.meetingParticipant.deleteMany({});
  await prisma.meeting.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.activityLog.deleteMany({});
  await prisma.taskRequest.deleteMany({});
  await prisma.projectMember.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.project.deleteMany({});

  // Break the pointers that would otherwise block deleting users and offices.
  await prisma.office.updateMany({ data: { headId: null } });
  await prisma.department.updateMany({ data: { headId: null } });
  await prisma.user.updateMany({ data: { managerId: null, createdById: null } });

  await prisma.user.deleteMany({});
  await prisma.department.deleteMany({});
  // Office-scoped role and designation clones go with their office; the
  // platform-wide templates (officeId null) stay.
  await prisma.role.deleteMany({ where: { officeId: { not: null } } });
  await prisma.designation.deleteMany({ where: { officeId: { not: null } } });
  await prisma.office.deleteMany({});

  console.log("  cleared.");
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // The platform-wide roles and designations must already exist. This script
  // builds a world on top of that configuration; it does not own it.
  const roleRows = await prisma.role.findMany({ where: { officeId: null }, select: { id: true, name: true } });
  const roleByName = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
  for (const needed of ["Super Admin", "Office Admin", "Head", "Staff"]) {
    if (!roleByName[needed]) {
      throw new Error(
        `Role "${needed}" does not exist. Run "npm run seed" first: it creates the permissions, roles and designations this demo builds on.`
      );
    }
  }

  const desigRows = await prisma.designation.findMany({ where: { officeId: null }, select: { id: true, name: true } });
  const desigByName = Object.fromEntries(desigRows.map((d) => [d.name, d.id]));
  if (!Object.keys(desigByName).length) {
    throw new Error('No designations found. Run "npm run seed" first.');
  }

  await wipe();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  let employeeSeq = 1000;
  const nextEmployeeId = () => `CAG-${++employeeSeq}`;

  // ---- Organisation branding ----
  await prisma.orgSettings.upsert({
    where: { id: "org" },
    update: { name: "CAG Work Management" },
    create: { id: "org", name: "CAG Work Management", primaryColor: "#0B2447", accentColor: "#C1922B" },
  });

  // ---- Offices and departments ----
  console.log("Creating offices and departments...");
  const officeId: Record<string, string> = {};
  const deptId: Record<string, string> = {};

  for (const o of OFFICES) {
    const office = await prisma.office.create({
      data: { name: o.name, code: o.code, city: o.city, email: o.email, isActive: true },
    });
    officeId[o.code] = office.id;

    for (const d of o.departments) {
      const dept = await prisma.department.create({
        data: { name: d.name, code: d.code, officeId: office.id, description: `${d.name}, ${o.city}` },
      });
      deptId[d.code] = dept.id;
    }
  }
  console.log(`  ${OFFICES.length} offices, ${Object.keys(deptId).length} departments.`);

  // ---- People ----
  console.log("Creating people and logins...");
  const userId: Record<string, string> = {};
  async function createPerson(
    p: PersonSpec,
    office: string
  ): Promise<string> {
    const u = await prisma.user.create({
      data: {
        fullName: p.fullName,
        email: p.email,
        passwordHash,
        employeeId: nextEmployeeId(),
        mobile: p.mobile,
        roleId: roleByName[p.role],
        designationId: desigByName[p.desig] ?? undefined,
        cadre: p.cadre,
        wing: OFFICES.find((o) => o.code === office)?.departments.find((d) => d.code === p.dept)?.name,
        officeId: officeId[office],
        departmentId: deptId[p.dept],
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: day(-Math.floor(rnd() * 5), 9, 30),
      },
    });
    userId[p.key] = u.id;
    return u.id;
  }

  // The one platform operator.
  const superAdmin = await prisma.user.create({
    data: {
      fullName: "System Administrator",
      email: "superadmin@cag.gov.in",
      passwordHash,
      employeeId: "CAG-0001",
      roleId: roleByName["Super Admin"],
      designationId: desigByName["System Administrator"] ?? undefined,
      cadre: "IA&AS",
      officeId: officeId["CAG"],
      departmentId: deptId["CAG-ADM"],
      isActive: true,
      lastLoginAt: day(0, 9, 15),
    },
  });
  userId["superadmin"] = superAdmin.id;

  // One Office Admin per office: administers people, does not carry work.
  for (const o of OFFICES) {
    const admin = await prisma.user.create({
      data: {
        fullName: `Office Admin (${o.city})`,
        email: `admin.${o.code.toLowerCase().replace(/[^a-z0-9]/g, "")}@cag.gov.in`,
        passwordHash,
        employeeId: nextEmployeeId(),
        roleId: roleByName["Office Admin"],
        designationId: desigByName["Administrative Officer"] ?? undefined,
        cadre: "Group B",
        officeId: officeId[o.code],
        departmentId: deptId[o.departments[o.departments.length - 1].code],
        isActive: true,
        createdById: superAdmin.id,
        lastLoginAt: day(-1, 10, 0),
      },
    });
    userId[`admin.${o.code}`] = admin.id;
  }

  // The four deep offices get their hand-written roster.
  for (const [office, roster] of Object.entries(DEEP_PEOPLE)) {
    for (const p of roster) await createPerson(p, office);
    // Reporting lines, once everyone in the office exists.
    for (const p of roster) {
      if (p.manager && userId[p.manager]) {
        await prisma.user.update({ where: { id: userId[p.key] }, data: { managerId: userId[p.manager] } });
      }
    }
  }

  // The five branch offices get a head plus three staff each.
  for (const o of OFFICES.filter((x) => x.depth === "light")) {
    const headName = HEAD_NAMES[o.code];
    const slug = o.code.toLowerCase().replace(/[^a-z0-9]/g, "");
    const head = await createPerson(
      {
        key: `${o.code}.head`,
        fullName: headName,
        email: `head.${slug}@cag.gov.in`,
        role: "Head",
        desig: "Accountant General",
        dept: o.departments[o.departments.length - 1].code,
        cadre: "IA&AS",
        mobile: `98505${o.code.length}0001`,
      },
      o.code
    );

    const desigs = ["Senior Audit Officer", "Assistant Audit Officer", "Senior Auditor"];
    const cadres = ["Group B (SOGE)", "Group B", "Group C"];
    for (let i = 0; i < STAFF_NAMES[o.code].length; i++) {
      const id = await createPerson(
        {
          key: `${o.code}.staff${i}`,
          fullName: STAFF_NAMES[o.code][i],
          email: `staff${i + 1}.${slug}@cag.gov.in`,
          role: "Staff",
          desig: desigs[i],
          dept: o.departments[0].code,
          cadre: cadres[i],
          mobile: `98505${o.code.length}000${i + 2}`,
        },
        o.code
      );
      await prisma.user.update({ where: { id }, data: { managerId: head } });
    }
  }

  // ---- Office heads and department heads ----
  const headKeyFor: Record<string, string> = {
    COEFA: "coefa.head",
    CEDAR: "cedar.head",
    CAG: "cag.head",
    "DGA-AF-ND": "af.head",
  };
  for (const o of OFFICES) {
    const key = headKeyFor[o.code] ?? `${o.code}.head`;
    if (userId[key]) {
      await prisma.office.update({ where: { id: officeId[o.code] }, data: { headId: userId[key] } });
    }
  }

  // A department head for each department: the most senior person sitting in it.
  for (const [code, id] of Object.entries(deptId)) {
    const member = await prisma.user.findFirst({
      where: { departmentId: id, deletedAt: null },
      orderBy: [{ role: { level: "desc" } }, { designation: { rank: "desc" } }],
      select: { id: true },
    });
    if (member) await prisma.department.update({ where: { id }, data: { headId: member.id } });
  }

  const totalPeople = await prisma.user.count();
  console.log(`  ${totalPeople} people, all with logins.`);

  // ---- Files on disk, so download and preview genuinely work ----
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const storedFiles = DEMO_FILES.map((f) => ({ ...f, size: Buffer.byteLength(f.body, "utf8") }));

  // ---- Projects, work items and everything hanging off them ----
  console.log("Creating projects, work items and discussion...");

  let taskCount = 0;
  let postCount = 0;
  let fileCount = 0;
  /** Work items that make good demo targets for approvals and meetings. */
  const featured: { id: string; title: string; office: string; leadId: string | null }[] = [];

  /**
   * Attaches a file, writing its own copy to disk.
   *
   * Every attachment row gets a distinct storagePath even though the contents
   * repeat. Sharing one file between rows looks harmless until somebody deletes
   * an attachment in the demo: the delete route unlinks the file from disk, and
   * every other row pointing at it silently turns into a broken download.
   */
  async function attachFile(
    target: { taskId?: string; projectId?: string; taskCommentId?: string; projectCommentId?: string },
    uploaderId: string,
    createdAt: Date
  ): Promise<void> {
    const f = pick(storedFiles);
    const storagePath = `demo-${String(++fileCount).padStart(4, "0")}-${f.fileName}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storagePath), f.body, "utf8");
    await prisma.attachment.create({
      data: {
        ...target,
        storagePath,
        fileName: f.fileName,
        size: f.size,
        mimeType: f.mimeType,
        uploadedById: uploaderId,
        createdAt,
      },
    });
  }

  /** Builds a thread on one work item: remarks, updates, a reply, sometimes a blocker. */
  async function buildTaskThread(
    taskId: string,
    spec: { status: TaskStatus; pct: number; updatedDaysAgo: number },
    participants: string[],
    blocked: boolean
  ): Promise<void> {
    if (!participants.length) return;

    const posts = 2 + Math.floor(rnd() * 4);
    let firstPostId: string | null = null;

    for (let i = 0; i < posts; i++) {
      const author = pick(participants);
      const daysAgo = Math.max(spec.updatedDaysAgo, 1) + (posts - i) * 2;
      const createdAt = day(-daysAgo, 10 + (i % 6), (i * 17) % 60);

      // Most posts are ordinary remarks; the rest are directions and decisions.
      const kind = chance(0.55)
        ? CommentKind.REMARK
        : chance(0.5)
          ? CommentKind.DIRECTION
          : CommentKind.DECISION;
      const body =
        kind === CommentKind.REMARK ? pick(REMARKS) : kind === CommentKind.DIRECTION ? pick(DIRECTIONS) : pick(DECISIONS);

      const author2 = await prisma.user.findUnique({
        where: { id: author },
        select: { designation: { select: { name: true } } },
      });

      const post = await prisma.taskComment.create({
        data: {
          taskId,
          authorId: author,
          authorRole: author2?.designation?.name ?? null,
          kind,
          body,
          isPinned: kind === CommentKind.DIRECTION && i === 0,
          createdAt,
        },
      });
      postCount++;
      if (!firstPostId) firstPostId = post.id;

      if (chance(0.25)) await attachFile({ taskId, taskCommentId: post.id }, author, createdAt);
    }

    // A reply, so threading is visible in the demo.
    if (firstPostId && participants.length > 1) {
      await prisma.taskComment.create({
        data: {
          taskId,
          authorId: participants[1],
          kind: CommentKind.REMARK,
          body: "Understood. I will take this forward and report back at the next review.",
          parentId: firstPostId,
          createdAt: day(-Math.max(spec.updatedDaysAgo, 1) - 1, 15, 20),
        },
      });
      postCount++;
    }

    // The progress update that set the item's current position.
    if (spec.status !== TaskStatus.YET_TO_BE_ASSIGNED) {
      const author = participants[0];
      const at = day(-spec.updatedDaysAgo, 16, 40);
      await prisma.taskComment.create({
        data: {
          taskId,
          authorId: author,
          kind: CommentKind.STATUS_UPDATE,
          body: pick(UPDATES),
          meta: {
            statusFrom: spec.status === TaskStatus.FINISHED ? TaskStatus.IN_PROGRESS : TaskStatus.INITIATED,
            statusTo: spec.status,
            pctFrom: Math.max(0, spec.pct - 20),
            pctTo: spec.pct,
          },
          createdAt: at,
        },
      });
      postCount++;
      await prisma.activityLog.create({
        data: {
          taskId,
          actorId: author,
          action: "progress_reported",
          detail: { statusTo: spec.status, pctFrom: Math.max(0, spec.pct - 20), pctTo: spec.pct },
          createdAt: at,
        },
      });
    }

    // An open blocker, pinned, which the dashboards raise as critical.
    if (blocked) {
      const author = participants[0];
      const at = day(-Math.max(1, spec.updatedDaysAgo), 12, 10);
      await prisma.taskComment.create({
        data: {
          taskId,
          authorId: author,
          kind: CommentKind.BLOCKER,
          body: pick(BLOCKERS),
          isPinned: true,
          createdAt: at,
        },
      });
      postCount++;
      await prisma.activityLog.create({
        data: { taskId, actorId: author, action: "blocker_raised", detail: { kind: "BLOCKER" }, createdAt: at },
      });
    }
  }

  async function buildProject(
    spec: ProjectSpec,
    resolve: (key: string) => string | undefined
  ): Promise<void> {
    const leadId = resolve(spec.lead);
    const office = officeId[spec.office];
    const createdAt = day(spec.startOffset, 9, 30);

    const project = await prisma.project.create({
      data: {
        name: spec.name,
        code: spec.code,
        description: spec.description,
        status: spec.status,
        priority: spec.priority,
        officeId: office,
        departmentId: deptId[spec.dept],
        createdById: leadId,
        startDate: day(spec.startOffset),
        dueDate: day(spec.dueOffset),
        lastUpdateAt: day(-spec.quietDays, 17, 0),
        createdAt,
      },
    });

    // Membership: one primary lead, an optional second, members and observers.
    const rows = new Map<string, ProjectRole>();
    for (const k of spec.observers ?? []) {
      const id = resolve(k);
      if (id) rows.set(id, ProjectRole.OBSERVER);
    }
    for (const k of spec.members) {
      const id = resolve(k);
      if (id) rows.set(id, ProjectRole.MEMBER);
    }
    if (spec.second) {
      const id = resolve(spec.second);
      if (id) rows.set(id, ProjectRole.SECONDARY_LEAD);
    }
    if (leadId) rows.set(leadId, ProjectRole.PRIMARY_LEAD);

    for (const [uid, role] of rows) {
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: uid, role, addedById: leadId, addedAt: createdAt },
      });
    }

    const contributors = [...rows.entries()]
      .filter(([, role]) => role !== ProjectRole.OBSERVER)
      .map(([uid]) => uid);

    // Project-level thread.
    if (contributors.length) {
      await prisma.projectComment.create({
        data: {
          projectId: project.id,
          authorId: leadId,
          kind: CommentKind.STATUS_UPDATE,
          body: pick(PROJECT_UPDATES),
          createdAt: day(-spec.quietDays, 17, 0),
        },
      });
      postCount++;

      const kickoff = await prisma.projectComment.create({
        data: {
          projectId: project.id,
          authorId: leadId,
          kind: CommentKind.DIRECTION,
          body:
            "Team, please post a short progress note against your own work items every week rather than waiting for the review. " +
            "If something is blocking you, raise it as a blocker so it shows on the dashboard.",
          isPinned: true,
          createdAt,
        },
      });
      postCount++;

      await prisma.projectComment.create({
        data: {
          projectId: project.id,
          authorId: contributors[contributors.length - 1],
          kind: CommentKind.REMARK,
          body: "Noted. I have started posting weekly against my items.",
          parentId: kickoff.id,
          createdAt: day(spec.startOffset + 1, 11, 0),
        },
      });
      postCount++;

      await attachFile({ projectId: project.id }, leadId ?? contributors[0], createdAt);
      if (chance(0.6)) await attachFile({ projectId: project.id }, contributors[0], day(-spec.quietDays - 2));
    }

    await prisma.activityLog.create({
      data: { projectId: project.id, actorId: leadId, action: "created", detail: { name: spec.name }, createdAt },
    });

    // Work items.
    for (const t of spec.tasks) {
      const tLead = t.lead ? resolve(t.lead) : null;
      const tWith = t.with ? resolve(t.with) : tLead;
      const tSecond = t.second ? resolve(t.second) : null;
      const tCreated = day(-t.createdDaysAgo, 10, 0);

      const task = await prisma.task.create({
        data: {
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          projectId: project.id,
          owningOfficeId: office,
          executingOfficeId: office,
          departmentId: deptId[t.dept ?? spec.dept],
          primaryLeadId: tLead,
          secondaryLeadId: tSecond,
          currentlyWithId: tWith,
          createdById: leadId,
          assignedDate: tLead ? tCreated : null,
          dueDate: t.dueOffset === null ? null : day(t.dueOffset, 17, 0),
          pctComplete: t.pct,
          lastUpdateAt: day(-t.updatedDaysAgo, 16, 40),
          createdAt: tCreated,
        },
      });
      taskCount++;
      featured.push({ id: task.id, title: task.title, office: spec.office, leadId: tLead ?? null });

      await prisma.activityLog.create({
        data: {
          taskId: task.id,
          projectId: project.id,
          actorId: leadId,
          action: "created",
          detail: { title: t.title },
          createdAt: tCreated,
        },
      });

      // Two files on roughly half the items.
      if (chance(0.5) && (tLead ?? contributors[0])) {
        await attachFile({ taskId: task.id }, tLead ?? contributors[0], day(-t.updatedDaysAgo - 1));
      }

      const people = [tLead, tWith, tSecond, ...contributors].filter(Boolean) as string[];
      const unique = [...new Set(people)];
      const blocked = t.status === TaskStatus.ON_HOLD && chance(0.8);
      await buildTaskThread(task.id, t, unique, blocked);
    }
  }

  // The four deep offices, from their hand-written specs.
  for (const spec of PROJECTS) {
    await buildProject(spec, (key) => userId[key]);
  }

  // The five branch offices, from the shared template.
  for (const bp of BRANCH_PROJECTS) {
    const office = OFFICES.find((o) => o.code === bp.office)!;
    const staffKeys = [0, 1, 2].map((i) => `${bp.office}.staff${i}`).filter((k) => userId[k]);
    await buildProject(
      {
        office: bp.office,
        name: bp.name,
        code: bp.code,
        description: bp.description,
        status: ProjectStatus.ACTIVE,
        priority: bp.priority,
        dept: office.departments[0].code,
        startOffset: -35,
        dueOffset: 30,
        quietDays: 5,
        lead: staffKeys[0],
        second: staffKeys[1],
        members: [staffKeys[2], `${bp.office}.head`].filter(Boolean),
        tasks: BRANCH_TASKS.map((t, i) => ({
          ...t,
          lead: staffKeys[i % staffKeys.length],
          with: staffKeys[i % staffKeys.length],
          createdDaysAgo: 34 - i * 3,
        })),
      },
      (key) => userId[key]
    );
  }

  console.log(`  ${PROJECTS.length + BRANCH_PROJECTS.length} projects, ${taskCount} work items, ${postCount} posts, ${fileCount} files.`);

  // ---- A few work items outside any project ----
  // Not everything belongs to a programme, and the dashboards must cope.
  const looseItems = [
    { title: "Reply to the Parliamentary Question on audit coverage", office: "CAG", lead: "cag.co", dept: "CAG-CO", due: 1, priority: TaskPriority.URGENT, status: TaskStatus.IN_PROGRESS, pct: 50, updated: 0 },
    { title: "Annual property return scrutiny", office: "COEFA", lead: "coefa.trg", dept: "COEFA-ADM", due: -9, priority: TaskPriority.NORMAL, status: TaskStatus.IN_PROGRESS, pct: 30, updated: 19 },
    { title: "Office inspection of the records section", office: "CEDAR", lead: "cedar.aao2", dept: "CEDAR-ADM", due: 21, priority: TaskPriority.LOW, status: TaskStatus.INITIATED, pct: 0, updated: 7 },
    { title: "Prepare the budget estimate for the next financial year", office: "DGA-AF-ND", lead: "af.dir", dept: "AF-ADM", due: 5, priority: TaskPriority.HIGH, status: TaskStatus.IN_PROGRESS, pct: 60, updated: 2 },
  ];
  for (const l of looseItems) {
    const t = await prisma.task.create({
      data: {
        title: l.title,
        description: "Standalone work item, not attached to any project.",
        status: l.status,
        priority: l.priority,
        owningOfficeId: officeId[l.office],
        executingOfficeId: officeId[l.office],
        departmentId: deptId[l.dept],
        primaryLeadId: userId[l.lead],
        currentlyWithId: userId[l.lead],
        createdById: userId[l.lead],
        assignedDate: day(-20),
        dueDate: day(l.due, 17, 0),
        pctComplete: l.pct,
        lastUpdateAt: day(-l.updated, 15, 0),
        createdAt: day(-25),
      },
    });
    taskCount++;
    await buildTaskThread(t.id, { status: l.status, pct: l.pct, updatedDaysAgo: l.updated }, [userId[l.lead]], false);
  }

  // ---- Assignments and approvals, so the Approvals screen has content ----
  console.log("Creating assignments, approvals and meetings...");

  /** Waiting for the assignee to accept: shows on their dashboard as an alert. */
  const pendingAcceptance: [string, string, string][] = [
    ["coefa.sao1", "coefa.aud1", "Please take this over, I am tied up with the consolidation."],
    ["cedar.sao1", "cedar.yp", "Handing the documentation work to you. Shout if the scope is unclear."],
    ["cag.sao", "cag.aao", "Over to you for the editorial pass."],
    ["af.sao", "af.aud", "Please pick up the delivery performance verification."],
  ];
  let reqCount = 0;
  for (const [from, to, message] of pendingAcceptance) {
    const t = featured.find((f) => f.leadId === userId[from]);
    if (!t || !userId[to]) continue;
    await prisma.taskRequest.create({
      data: {
        taskId: t.id,
        fromId: userId[from],
        toId: userId[to],
        message,
        scope: RequestScope.USER,
        state: RequestState.PENDING_ACCEPTANCE,
        requiresApproval: false,
        createdAt: day(-2, 14, 0),
      },
    });
    reqCount++;
    await prisma.notification.create({
      data: {
        userId: userId[to],
        kind: "assigned",
        payload: { title: `New work assigned: ${t.title}`, body: message, taskId: t.id, url: `/tasks/${t.id}` },
        isRead: false,
        createdAt: day(-2, 14, 0),
      },
    });
  }

  /** Cross-department, waiting on a department head's approval. */
  const crossDept = featured.find((f) => f.office === "COEFA" && f.leadId === userId["coefa.sao2"]);
  if (crossDept) {
    await prisma.taskRequest.create({
      data: {
        taskId: crossDept.id,
        fromId: userId["coefa.sao2"],
        toId: userId["coefa.aud1"],
        toDepartmentId: deptId["COEFA-FA"],
        message: "This needs a financial audit view. Requesting the Financial Audit Wing take it on.",
        scope: RequestScope.DEPARTMENT,
        state: RequestState.PENDING_APPROVAL,
        requiresApproval: true,
        createdAt: day(-3, 11, 0),
      },
    });
    reqCount++;
  }

  /** Cross-office: CAG headquarters asking a branch office to take work on. */
  const hqTask = featured.find((f) => f.office === "CAG");
  if (hqTask) {
    await prisma.taskRequest.create({
      data: {
        taskId: hqTask.id,
        fromId: userId["cag.dir"],
        toOfficeId: officeId["BR-PAG-AU2-MUM"],
        message:
          "Requesting the Mumbai branch office to take on the state PSU portion of this thematic audit, as the records are held locally.",
        scope: RequestScope.OFFICE,
        state: RequestState.PENDING_APPROVAL,
        requiresApproval: true,
        createdAt: day(-4, 15, 30),
      },
    });
    reqCount++;
    if (userId["BR-PAG-AU2-MUM.head"]) {
      await prisma.notification.create({
        data: {
          userId: userId["BR-PAG-AU2-MUM.head"],
          kind: "office_request",
          payload: {
            title: `Work request from CAG headquarters: ${hqTask.title}`,
            body: "Approve or reject, and nominate a staff member if you accept.",
            taskId: hqTask.id,
            url: `/tasks/${hqTask.id}`,
          },
          isRead: false,
          createdAt: day(-4, 15, 30),
        },
      });
    }
  }

  /** One already accepted, so the history is not entirely pending. */
  const settled = featured.find((f) => f.leadId === userId["coefa.aao1"]);
  if (settled) {
    await prisma.taskRequest.create({
      data: {
        taskId: settled.id,
        fromId: userId["coefa.dag"],
        toId: userId["coefa.aao1"],
        message: "Assigning the sample selection to you.",
        scope: RequestScope.USER,
        state: RequestState.ACCEPTED,
        requiresApproval: false,
        resolvedAt: day(-28, 10, 0),
        createdAt: day(-30, 10, 0),
      },
    });
    reqCount++;
  }

  // ---- Meetings: today, this week, and in the past with minutes ----
  interface MeetingSpec {
    title: string;
    agenda: string;
    office: string;
    organiser: string;
    attendees: string[];
    startOffset: number;
    hour: number;
    durationMins: number;
    mode: MeetingMode;
    location?: string;
    projectCode?: string;
    minutes?: string;
  }

  const MEETINGS: MeetingSpec[] = [
    { title: "Daily stand-up: Union Accounts attest audit", agenda: "Position on consolidation, blockers, plan for the day.", office: "COEFA", organiser: "coefa.sao1", attendees: ["coefa.aao1", "coefa.aud1", "coefa.dag"], startOffset: 0, hour: 10, durationMins: 30, mode: MeetingMode.ONLINE, projectCode: "FAA-2026" },
    { title: "Review of IS audit findings", agenda: "Walk through the access control findings and agree risk ratings.", office: "COEFA", organiser: "coefa.sao2", attendees: ["coefa.aao2", "coefa.aud2", "coefa.cons"], startOffset: 0, hour: 15, durationMins: 90, mode: MeetingMode.PHYSICAL, location: "Conference Room 2, CoEFA Hyderabad", projectCode: "ISA-IFMS" },
    { title: "GST analytics: model walkthrough", agenda: "Demonstrate the mismatch model and agree the field verification list.", office: "CEDAR", organiser: "cedar.sao1", attendees: ["cedar.dir", "cedar.aao1", "cedar.yp"], startOffset: 0, hour: 16, durationMins: 60, mode: MeetingMode.ONLINE, projectCode: "GST-ITC" },
    { title: "Audit Report consolidation: weekly review", agenda: "Status of the 38 paragraphs, outstanding replies, printing schedule.", office: "CAG", organiser: "cag.dir", attendees: ["cag.sao", "cag.aao", "cag.co", "cag.head"], startOffset: 1, hour: 11, durationMins: 90, mode: MeetingMode.PHYSICAL, location: "Committee Room, CAG Bhawan", projectCode: "AR-UNION" },
    { title: "Entry conference: aircraft spares procurement", agenda: "Scope, records required, points of contact.", office: "DGA-AF-ND", organiser: "af.sao", attendees: ["af.dir", "af.aao1", "af.aud"], startOffset: 2, hour: 11, durationMins: 60, mode: MeetingMode.PHYSICAL, location: "Air HQ, New Delhi", projectCode: "AF-SPARES" },
    { title: "Training programme planning", agenda: "Curriculum sign-off, faculty confirmation, venue options.", office: "COEFA", organiser: "coefa.trg", attendees: ["coefa.cons", "coefa.aao1"], startOffset: 3, hour: 14, durationMins: 60, mode: MeetingMode.ONLINE, projectCode: "TRG-2026" },
    { title: "Inter-office coordination call", agenda: "Milestone position from each participating office.", office: "CAG", organiser: "cag.co", attendees: ["cag.dir", "cag.sao"], startOffset: 5, hour: 15, durationMins: 45, mode: MeetingMode.ONLINE, projectCode: "COORD-TH" },
    { title: "Materiality and sampling review", agenda: "Fix materiality and approve the sampling basis.", office: "COEFA", organiser: "coefa.dag", attendees: ["coefa.sao1", "coefa.aao1"], startOffset: -7, hour: 11, durationMins: 60, mode: MeetingMode.PHYSICAL, location: "Conference Room 1, CoEFA Hyderabad", projectCode: "FAA-2026", minutes: "Materiality fixed at 2% of gross expenditure. Consolidation identified as the critical path. Two field offices to receive a final reminder. Next review in one week." },
    { title: "Customs exemption review: scoping", agenda: "Agree the notifications in scope and the data required.", office: "CEDAR", organiser: "cedar.sao2", attendees: ["cedar.aao2", "cedar.aao1"], startOffset: -12, hour: 15, durationMins: 45, mode: MeetingMode.ONLINE, projectCode: "CUS-EXM", minutes: "Scope limited to notifications in force for the full three-year period. Data request to be raised with the Directorate of Systems." },
  ];

  const projectIdByCode = Object.fromEntries(
    (await prisma.project.findMany({ select: { id: true, code: true } }))
      .filter((p) => p.code)
      .map((p) => [p.code as string, p.id])
  );

  let meetingCount = 0;
  for (const m of MEETINGS) {
    const organiser = userId[m.organiser];
    if (!organiser) continue;
    const attendees = [organiser, ...m.attendees.map((k) => userId[k]).filter(Boolean)];
    const startsAt = day(m.startOffset, m.hour, 0);

    await prisma.meeting.create({
      data: {
        title: m.title,
        agenda: m.agenda,
        startsAt,
        endsAt: new Date(startsAt.getTime() + m.durationMins * 60 * 1000),
        mode: m.mode,
        location: m.mode === MeetingMode.ONLINE ? "https://meet.gov.in/cag-demo" : m.location,
        minutes: m.minutes,
        projectId: m.projectCode ? projectIdByCode[m.projectCode] : undefined,
        createdById: organiser,
        createdAt: day(m.startOffset - 5, 9, 0),
        participants: { create: [...new Set(attendees)].map((uid) => ({ userId: uid })) },
      },
    });
    meetingCount++;

    // Invitations for the meetings that have not happened yet.
    if (m.startOffset >= 0) {
      for (const uid of new Set(attendees)) {
        if (uid === organiser) continue;
        await prisma.notification.create({
          data: {
            userId: uid,
            kind: "meeting_invite",
            payload: {
              title: `Meeting: ${m.title}`,
              body: `${startsAt.toLocaleString("en-GB")} (${m.mode.toLowerCase()})`,
              url: "/meetings",
            },
            isRead: chance(0.4),
            createdAt: day(m.startOffset - 5, 9, 0),
          },
        });
      }
    }
  }

  // ---- A few unread notifications, so the bell has something in it ----
  for (const key of ["coefa.sao1", "cedar.sao1", "cag.sao", "af.sao"]) {
    if (!userId[key]) continue;
    await prisma.notification.create({
      data: {
        userId: userId[key],
        kind: "due_soon",
        payload: { title: "Work due within the next three days", body: "Two of your items are approaching their due date.", url: "/tasks?filter=due-soon" },
        isRead: false,
        createdAt: day(0, 8, 0),
      },
    });
  }

  console.log(`  ${reqCount} assignments/approvals, ${meetingCount} meetings.`);

  // ---- Summary ----
  const [offices, users, projects, tasks, comments, pcomments, files, meetings] = await Promise.all([
    prisma.office.count(),
    prisma.user.count(),
    prisma.project.count(),
    prisma.task.count(),
    prisma.taskComment.count(),
    prisma.projectComment.count(),
    prisma.attachment.count(),
    prisma.meeting.count(),
  ]);

  console.log("");
  console.log("=".repeat(66));
  console.log("  DEMO DATA READY");
  console.log("=".repeat(66));
  console.log(`  Offices ${offices}   People ${users}   Projects ${projects}   Work items ${tasks}`);
  console.log(`  Posts ${comments + pcomments}   Files ${files}   Meetings ${meetings}`);
  console.log("");
  console.log(`  Every account uses the password:  ${PASSWORD}`);
  console.log("");
  console.log("  START HERE, in this order:");
  console.log("");
  console.log("   1. dg.coefa@cag.gov.in       Radhika Menon, Director General, CoEFA");
  console.log("      Office head. Sees the whole office: the richest dashboard,");
  console.log("      alerts, blockers, project health across four projects.");
  console.log("");
  console.log("   2. sao1.coefa@cag.gov.in     Sridhar Rao, Senior Audit Officer");
  console.log("      Working level. Leads the attest audit, holds overdue work,");
  console.log("      has an item waiting to be accepted, posts progress updates.");
  console.log("");
  console.log("   3. aud1.coefa@cag.gov.in     Vinod Kumar, Senior Auditor");
  console.log("      A project member, not a lead. Proves the point of the change:");
  console.log("      he can report progress because he is on the project.");
  console.log("");
  console.log("   4. dg.cedar@cag.gov.in       Arun Bhattacharya, DG, CEDAR");
  console.log("      A second office, so cross-office isolation is visible.");
  console.log("");
  console.log("   5. head.brpagau2mum@cag.gov.in  Sanjay Deshmukh, AG, Mumbai");
  console.log("      Has an incoming cross-office work request to approve.");
  console.log("");
  console.log("   6. superadmin@cag.gov.in     Platform operator, all nine offices.");
  console.log("");
  console.log("   Office admins: admin.coefa@cag.gov.in, admin.cedar@cag.gov.in,");
  console.log("   admin.cag@cag.gov.in, admin.dgaafnd@cag.gov.in and one per branch.");
  console.log("=".repeat(66));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });



