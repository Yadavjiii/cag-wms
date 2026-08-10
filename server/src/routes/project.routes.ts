import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, ProjectStatus, ProjectRole } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, isGlobalAdmin } from "../middleware/auth";
import { notify } from "../services/notify";
import { broadcast } from "../realtime";

/**
 * Projects are the containers that gather people and work. There are no
 * standing teams: each project forms its own working group, with a primary
 * lead, an optional secondary lead, members and read-only observers, all of
 * which stay editable for the life of the project.
 */
export const projectRouter = Router();
projectRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

const memberInclude = {
  members: {
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          designation: { select: { id: true, name: true, code: true, rank: true } },
          avatarUrl: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { addedAt: "asc" },
  },
  office: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { tasks: true } },
} as const;

/**
 * Which projects may this user see? Office members see their office's projects;
 * everyone always sees projects they are a member of. Archived projects are
 * hidden unless explicitly requested.
 */
function projectVisibility(user: ReqUser): Prisma.ProjectWhereInput {
  if (isGlobalAdmin(user)) return {};
  const or: Prisma.ProjectWhereInput[] = [{ members: { some: { userId: user.id } } }, { createdById: user.id }];
  if (user.officeId) or.push({ officeId: user.officeId });
  return { OR: or };
}

/** May this user change the project itself (rename, archive, add members)? */
function canManage(user: ReqUser, project: { officeId: string; createdById: string | null; members?: { userId: string; role: ProjectRole }[] }): boolean {
  if (isGlobalAdmin(user)) return true;
  if (user.headsOfficeIds.includes(project.officeId)) return true;
  if (project.officeId !== user.officeId) return false;
  if (project.createdById === user.id) return true;
  if (user.permissions.includes("project.manage_any") || user.permissions.includes("team.manage_any")) return true;
  const me = project.members?.find((m) => m.userId === user.id);
  return me?.role === ProjectRole.PRIMARY_LEAD || me?.role === ProjectRole.SECONDARY_LEAD;
}

async function loadProject(id: string) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: { ...memberInclude },
  });
  if (!project) throw new HttpError(404, "Project not found");
  return project;
}

// GET /api/projects  -  projects I can see
projectRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters: Prisma.ProjectWhereInput[] = [projectVisibility(req.user!)];

    if (req.query.includeArchived !== "true") filters.push({ archivedAt: null });
    const status = req.query.status as string | undefined;
    if (status && status in ProjectStatus) filters.push({ status: status as ProjectStatus });
    if (req.query.mine === "true") filters.push({ members: { some: { userId: req.user!.id } } });

    const projects = await prisma.project.findMany({
      where: { AND: filters },
      include: memberInclude,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
    res.json(projects);
  })
);

// GET /api/projects/:id  -  detail, with members and work items
projectRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { AND: [{ id: req.params.id }, projectVisibility(req.user!)] },
      include: {
        ...memberInclude,
        tasks: {
          where: { archivedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            pctComplete: true,
            primaryLead: { select: { id: true, fullName: true } },
            currentlyWith: { select: { id: true, fullName: true } },
          },
          orderBy: [{ dueDate: "asc" }],
        },
      },
    });
    if (!project) throw new HttpError(404, "Project not found or not visible to you");
    res.json({ ...project, canManage: canManage(req.user!, project) });
  })
);

const createSchema = z.object({
  name: z.string().min(2, "Give the project a name"),
  code: z.string().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  departmentId: z.string().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  primaryLeadId: z.string().nullable().optional(),
  secondaryLeadId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).optional(),
  observerIds: z.array(z.string()).optional(),
});

/** Everyone named on a project must belong to the project's office. */
async function assertSameOffice(officeId: string, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const found = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, officeId: true, isActive: true },
  });
  for (const id of ids) {
    const u = found.find((f) => f.id === id);
    if (!u) throw new HttpError(404, "One of the people you selected does not exist");
    if (u.officeId !== officeId) throw new HttpError(400, `${u.fullName} belongs to a different office`);
    if (!u.isActive) throw new HttpError(400, `${u.fullName}'s account is deactivated`);
  }
}

// POST /api/projects  -  create a project and its working group in one go
projectRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const officeId = req.user!.officeId;
    if (!officeId) throw new HttpError(400, "Your account is not attached to an office");

    if (data.primaryLeadId && data.primaryLeadId === data.secondaryLeadId) {
      throw new HttpError(400, "The primary and secondary lead must be different people");
    }

    const everyone = [
      ...(data.primaryLeadId ? [data.primaryLeadId] : []),
      ...(data.secondaryLeadId ? [data.secondaryLeadId] : []),
      ...(data.memberIds ?? []),
      ...(data.observerIds ?? []),
    ];
    await assertSameOffice(officeId, everyone);

    // Build the membership rows, letting the more senior standing win if
    // somebody appears in more than one list.
    const rows = new Map<string, ProjectRole>();
    for (const id of data.observerIds ?? []) rows.set(id, ProjectRole.OBSERVER);
    for (const id of data.memberIds ?? []) rows.set(id, ProjectRole.MEMBER);
    if (data.secondaryLeadId) rows.set(data.secondaryLeadId, ProjectRole.SECONDARY_LEAD);
    if (data.primaryLeadId) rows.set(data.primaryLeadId, ProjectRole.PRIMARY_LEAD);
    // The creator is always on their own project.
    if (!rows.has(req.user!.id)) rows.set(req.user!.id, ProjectRole.MEMBER);

    const project = await prisma.project.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        status: data.status ?? ProjectStatus.ACTIVE,
        officeId,
        departmentId: data.departmentId ?? req.user!.departmentId ?? undefined,
        startDate: data.startDate ?? undefined,
        dueDate: data.dueDate ?? undefined,
        createdById: req.user!.id,
        members: {
          create: [...rows.entries()].map(([userId, role]) => ({ userId, role, addedById: req.user!.id })),
        },
      },
      include: memberInclude,
    });

    // Tell everyone except the creator that they are on it.
    for (const [userId, role] of rows) {
      if (userId === req.user!.id) continue;
      await notify({
        userId,
        kind: "project_added",
        title: `Added to project: ${project.name}`,
        body: `${req.user!.fullName} added you to "${project.name}" as ${labelFor(role)}.`,
      });
    }

    broadcast("project:changed", { projectId: project.id });
    res.status(201).json(project);
  })
);

function labelFor(role: ProjectRole): string {
  switch (role) {
    case ProjectRole.PRIMARY_LEAD:
      return "primary lead";
    case ProjectRole.SECONDARY_LEAD:
      return "secondary lead";
    case ProjectRole.OBSERVER:
      return "an observer";
    default:
      return "a member";
  }
}

const updateSchema = createSchema
  .omit({ memberIds: true, observerIds: true, primaryLeadId: true, secondaryLeadId: true })
  .partial();

// PATCH /api/projects/:id  -  rename, reschedule, change status
projectRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot edit this project");

    const data = updateSchema.parse(req.body);
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        ...data,
        startDate: data.startDate ?? undefined,
        dueDate: data.dueDate ?? undefined,
        departmentId: data.departmentId ?? undefined,
      },
      include: memberInclude,
    });
    broadcast("project:changed", { projectId: project.id });
    res.json(updated);
  })
);

// DELETE /api/projects/:id  -  archive (soft delete). History is preserved.
projectRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot delete this project");

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date(), archivedById: req.user!.id },
    });
    // Work items survive; they simply lose their project link.
    await prisma.task.updateMany({ where: { projectId: project.id }, data: { projectId: null } });

    broadcast("project:changed", { projectId: project.id });
    res.status(204).end();
  })
);

// POST /api/projects/:id/restore  -  bring an archived project back
projectRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot restore this project");
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: null, archivedById: null },
      include: memberInclude,
    });
    res.json(updated);
  })
);

const memberSchema = z.object({
  userId: z.string(),
  role: z.nativeEnum(ProjectRole).optional(),
});

// POST /api/projects/:id/members  -  add someone, or change their standing
projectRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot change this project's team");

    const { userId, role = ProjectRole.MEMBER } = memberSchema.parse(req.body);
    await assertSameOffice(project.officeId, [userId]);

    // Only one primary and one secondary lead at a time: promoting someone
    // demotes the incumbent to a plain member rather than silently duplicating.
    if (role === ProjectRole.PRIMARY_LEAD || role === ProjectRole.SECONDARY_LEAD) {
      await prisma.projectMember.updateMany({
        where: { projectId: project.id, role, NOT: { userId } },
        data: { role: ProjectRole.MEMBER },
      });
    }

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      update: { role },
      create: { projectId: project.id, userId, role, addedById: req.user!.id },
      include: { user: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } } },
    });

    await notify({
      userId,
      kind: "project_added",
      title: `Project: ${project.name}`,
      body: `${req.user!.fullName} made you ${labelFor(role)} on "${project.name}".`,
    });

    broadcast("project:changed", { projectId: project.id });
    res.status(201).json(member);
  })
);

// PATCH /api/projects/:id/members/:userId  -  change someone's standing
projectRouter.patch(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot change this project's team");

    const { role } = z.object({ role: z.nativeEnum(ProjectRole) }).parse(req.body);
    if (role === ProjectRole.PRIMARY_LEAD || role === ProjectRole.SECONDARY_LEAD) {
      await prisma.projectMember.updateMany({
        where: { projectId: project.id, role, NOT: { userId: req.params.userId } },
        data: { role: ProjectRole.MEMBER },
      });
    }

    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: req.params.userId } },
      data: { role },
      include: { user: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } } },
    });

    await notify({
      userId: req.params.userId,
      kind: "project_role_changed",
      title: `Your role changed on ${project.name}`,
      body: `${req.user!.fullName} made you ${labelFor(role)} on "${project.name}".`,
    });

    broadcast("project:changed", { projectId: project.id });
    res.json(member);
  })
);

// DELETE /api/projects/:id/members/:userId  -  take someone off the project
projectRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot change this project's team");

    await prisma.projectMember.deleteMany({ where: { projectId: project.id, userId: req.params.userId } });

    await notify({
      userId: req.params.userId,
      kind: "project_removed",
      title: `Removed from project: ${project.name}`,
      body: `${req.user!.fullName} removed you from "${project.name}".`,
    });

    broadcast("project:changed", { projectId: project.id });
    res.status(204).end();
  })
);

// GET /api/projects/:id/available-people  -  office staff not yet on the project
projectRouter.get(
  "/:id/available-people",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    const existing = project.members.map((m) => m.userId);
    const people = await prisma.user.findMany({
      where: { officeId: project.officeId, isActive: true, id: { notIn: existing.length ? existing : ["__none__"] } },
      orderBy: [{ role: { level: "desc" } }, { fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        email: true,
        designation: { select: { id: true, name: true, code: true, rank: true } },
        department: { select: { id: true, name: true } },
      },
    });
    res.json(people);
  })
);
