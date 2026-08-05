import { registerPrimitive } from "./registry";
import { registerCorePrimitives } from "./primitives";
import { ProjectBoard, ProjectBoardSchema } from "../modules/projects/ProjectBoard";
import { TaskList, TaskListSchema } from "../modules/tasks/TaskList";
import { TeamMembers, TeamMembersSchema } from "../modules/users/TeamMembers";
import { OrgStructure, OrgStructureSchema } from "../modules/hr/OrgStructure";
import { WorkspaceSettings, WorkspaceSettingsSchema } from "../modules/settings/WorkspaceSettings";
import { ChatWorkspace, ChatWorkspaceSchema } from "../modules/chat/ChatWorkspace";
import { MeetingsWorkspace, MeetingsWorkspaceSchema } from "../modules/meetings/MeetingsWorkspace";
import { AnnouncementsWorkspace, AnnouncementsWorkspaceSchema } from "../modules/announcements/AnnouncementsWorkspace";
import { CalendarWorkspace, CalendarWorkspaceSchema } from "../modules/calendar/CalendarWorkspace";
import { AttendanceWorkspace, AttendanceWorkspaceSchema } from "../modules/attendance/AttendanceWorkspace";
import { RolesPermissionsWorkspace, RolesPermissionsWorkspaceSchema } from "../modules/roles/RolesPermissionsWorkspace";
import { AnalyticsDashboard, AnalyticsDashboardSchema } from "../modules/analytics/AnalyticsDashboard";

let registered = false;

/** Single entry point the app calls once before any Renderer mounts. */
export function registerAllComponents(): void {
  if (registered) return;
  registered = true;

  registerCorePrimitives();
  registerPrimitive("ProjectBoard", 1, ProjectBoardSchema, ProjectBoard);
  registerPrimitive("TaskList", 1, TaskListSchema, TaskList);
  registerPrimitive("TeamMembers", 1, TeamMembersSchema, TeamMembers);
  registerPrimitive("OrgStructure", 1, OrgStructureSchema, OrgStructure);
  registerPrimitive("WorkspaceSettings", 1, WorkspaceSettingsSchema, WorkspaceSettings);
  registerPrimitive("ChatWorkspace", 1, ChatWorkspaceSchema, ChatWorkspace);
  registerPrimitive("MeetingsWorkspace", 1, MeetingsWorkspaceSchema, MeetingsWorkspace);
  registerPrimitive("AnnouncementsWorkspace", 1, AnnouncementsWorkspaceSchema, AnnouncementsWorkspace);
  registerPrimitive("CalendarWorkspace", 1, CalendarWorkspaceSchema, CalendarWorkspace);
  registerPrimitive("AttendanceWorkspace", 1, AttendanceWorkspaceSchema, AttendanceWorkspace);
  registerPrimitive("RolesPermissionsWorkspace", 1, RolesPermissionsWorkspaceSchema, RolesPermissionsWorkspace);
  registerPrimitive("AnalyticsDashboard", 1, AnalyticsDashboardSchema, AnalyticsDashboard);
}
