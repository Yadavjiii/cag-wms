import { Router, Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";

export const teamRouter = Router();
teamRouter.use(authenticate);

/** A user can see teams they belong to, teams in their office, or (admins) more. */
function teamVisibility(user: NonNullable<Request["user"]>): Prisma.TeamWhereInput {
  if (user.permissions.includes("task.view_all")) return {};
  const or: Prisma.TeamWhereInput[] = [{ members: { some: { userId: user.id } } }, { ownerId: user.id }];
  if (user.officeId) or.push({ officeId: user.officeId });
  return { OR: or };
}

// GET /api/teams
teamRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const teams = await prisma.team.findMany({
      where: teamVisibility(req.user!),
      include: {
        owner: { select: { id: true, fullName: true } },
        _count: { select: { members: true, tasks: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(teams);
  })
);

const createSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});

// POST /api/teams  -  creator becomes owner and first member
teamRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const team = await prisma.team.create({
      data: {
        name: data.name,
        description: data.description,
        officeId: req.user!.officeId,
        ownerId: req.user!.id,
        members: { create: { userId: req.user!.id, roleInTeam: "lead" } },
      },
    });
    res.status(201).json(team);
  })
);

// GET /api/teams/:id
teamRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, fullName: true } },
        members: { include: { user: { select: { id: true, fullName: true, designation: true, wing: true } } } },
      },
    });
    if (!team) throw new HttpError(404, "Team not found");
    res.json(team);
  })
);

const addMemberSchema = z.object({
  userId: z.string(),
  roleInTeam: z.enum(["member", "lead", "admin"]).default("member"),
});

// POST /api/teams/:id/members  -  owner or admin only
teamRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const team = await prisma.team.findUnique({ where: { id: req.params.id } });
    if (!team) throw new HttpError(404, "Team not found");

    const isOwner = team.ownerId === req.user!.id;
    const isAdmin = req.user!.permissions.includes("team.manage_any");
    if (!isOwner && !isAdmin) throw new HttpError(403, "Only the team owner or an admin can add members");

    const { userId, roleInTeam } = addMemberSchema.parse(req.body);
    const member = await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId } },
      update: { roleInTeam },
      create: { teamId: team.id, userId, roleInTeam },
    });
    res.status(201).json(member);
  })
);

const memberRoleSchema = z.object({ roleInTeam: z.enum(["member", "lead", "admin"]) });

/** Only the team owner, a team admin, or someone with team.manage_any may edit membership. */
async function assertCanManageTeam(req: Request, teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, ownerId: true } });
  if (!team) throw new HttpError(404, "Team not found");
  if (team.ownerId === req.user!.id) return team;
  if (req.user!.permissions.includes("team.manage_any")) return team;
  const me = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: req.user!.id } },
    select: { roleInTeam: true },
  });
  if (me?.roleInTeam === "admin" || me?.roleInTeam === "lead") return team;
  throw new HttpError(403, "Only the team owner or a team lead can change membership");
}

// PATCH /api/teams/:id/members/:userId  -  promote or demote inside the team
teamRouter.patch(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    await assertCanManageTeam(req, req.params.id);
    const { roleInTeam } = memberRoleSchema.parse(req.body);
    const member = await prisma.teamMember.update({
      where: { teamId_userId: { teamId: req.params.id, userId: req.params.userId } },
      data: { roleInTeam },
      include: { user: { select: { id: true, fullName: true, designation: true } } },
    });
    res.json(member);
  })
);

// DELETE /api/teams/:id/members/:userId  -  remove someone from the team
teamRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const team = await assertCanManageTeam(req, req.params.id);
    if (team.ownerId === req.params.userId) throw new HttpError(400, "Transfer ownership before removing the owner");
    await prisma.teamMember.deleteMany({ where: { teamId: req.params.id, userId: req.params.userId } });
    res.status(204).end();
  })
);

const teamUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  ownerId: z.string().optional(),
});

// PATCH /api/teams/:id  -  rename or hand over the team
teamRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertCanManageTeam(req, req.params.id);
    const data = teamUpdateSchema.parse(req.body);
    if (data.ownerId) {
      await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: req.params.id, userId: data.ownerId } },
        update: { roleInTeam: "lead" },
        create: { teamId: req.params.id, userId: data.ownerId, roleInTeam: "lead" },
      });
    }
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data,
      include: { owner: { select: { id: true, fullName: true } } },
    });
    res.json(team);
  })
);
