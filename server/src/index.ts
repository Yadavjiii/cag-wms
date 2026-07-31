import express from "express";
import http from "http";
import cors from "cors";
import { config } from "./config";
import { initRealtime } from "./realtime";
import { authRouter } from "./routes/auth.routes";
import { profileRouter } from "./routes/profile.routes";
import { teamRouter } from "./routes/team.routes";
import { taskRouter } from "./routes/task.routes";
import { adminRouter } from "./routes/admin.routes";
import { officeRouter, departmentRouter } from "./routes/org.routes";
import { assignmentRouter } from "./routes/assignment.routes";
import { notificationRouter } from "./routes/notification.routes";
import { attachmentRouter } from "./routes/attachment.routes";
import { meetingRouter } from "./routes/meeting.routes";
import { searchRouter } from "./routes/search.routes";
import { reportRouter } from "./routes/report.routes";
import { settingsRouter } from "./routes/settings.routes";
import { startReminders } from "./jobs/reminders";
import { errorHandler } from "./middleware/error";

const app = express();

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/profiles", profileRouter);
app.use("/api/teams", teamRouter);
app.use("/api/tasks", taskRouter);
app.use("/api/admin", adminRouter);
app.use("/api/offices", officeRouter);
app.use("/api/departments", departmentRouter);
app.use("/api/assignments", assignmentRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api", attachmentRouter);
app.use("/api/meetings", meetingRouter);
app.use("/api/search", searchRouter);
app.use("/api/reports", reportRouter);
app.use("/api/settings", settingsRouter);

// Error handler must be registered last.
app.use(errorHandler);

if (config.enableReminders) startReminders();

const server = http.createServer(app);
initRealtime(server);

server.listen(config.port, () => {
  console.log(`CAG WMS API listening on http://localhost:${config.port}`);
});
