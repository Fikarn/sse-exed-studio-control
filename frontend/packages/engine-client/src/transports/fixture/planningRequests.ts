// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import { type FixtureRequestContext, type FixtureRequestResult, NOT_HANDLED } from "./requestContext";
import type { RequestMethod, JsonObject } from "../../generated/protocol";
import {
  buildPlanningTimeReport,
  buildDefaultPlanningSnapshot,
  normalizePlanningProjectStatus,
  normalizePlanningPriority,
  normalizePlanningViewFilter,
  normalizePlanningModeSection,
} from "./planning";
import { asString, asRecord, asArray, asNumber, cloneJson, asBoolean } from "./json";
import { synchronizeFixtureState } from "./state";
import { clampNumber } from "./lighting";

/** The `planning.*` requests: the time report, projects, tasks, checklists, timers. */
export function handleFixturePlanningRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  const { state, emit } = context;
  switch (method) {
    case "planning.report.time": {
      const projectId =
        typeof params.projectId === "string" && params.projectId.trim().length > 0 ? params.projectId.trim() : null;
      return buildPlanningTimeReport(state, projectId);
    }
    case "planning.project.create": {
      const title = asString(params.title).trim();
      if (!title) {
        throw new Error("title is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const projects = asArray(planningSnapshot.projects)
        .map((project) => asRecord(project))
        .filter((project): project is JsonObject => project !== null);
      const settings = asRecord(planningSnapshot.settings) ?? {};
      const nextStatus = normalizePlanningProjectStatus(params.status);
      const nextPriority = normalizePlanningPriority(params.priority);
      const nextOrder =
        projects
          .filter((project) => asString(project.status) === nextStatus)
          .reduce((highest, project) => Math.max(highest, asNumber(project.order, 0)), 0) + 1;
      const createdProject: JsonObject = {
        id: `proj-${Date.now()}`,
        title,
        description: asString(params.description),
        status: nextStatus,
        priority: nextPriority,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        order: nextOrder,
      };

      planningSnapshot.projects = [...projects, createdProject];
      settings.selectedProjectId = asString(createdProject.id);
      settings.selectedTaskId = null;
      planningSnapshot.settings = settings;

      const activityLog = asArray(planningSnapshot.activityLog);
      activityLog.unshift({
        id: `planning-project-created-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "project",
        entityId: createdProject.id,
        action: "project-created",
        detail: `Project '${title}' was created.`,
      });
      planningSnapshot.activityLog = activityLog;

      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "project-created" });
      return {
        context: cloneJson(asRecord(state.planningSnapshot)),
        project: cloneJson(createdProject),
      };
    }
    case "planning.project.reorder": {
      const projectId = asString(params.projectId).trim();
      if (!projectId) {
        throw new Error("projectId is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const projects = asArray(planningSnapshot.projects)
        .map((project) => asRecord(project))
        .filter((project): project is JsonObject => project !== null);
      const settings = asRecord(planningSnapshot.settings) ?? {};
      const targetProject = projects.find((project) => asString(project.id) === projectId);
      if (!targetProject) {
        throw new Error(`Planning project '${projectId}' was not found.`);
      }

      const currentStatus = normalizePlanningProjectStatus(targetProject.status);
      const nextStatus = "newStatus" in params ? normalizePlanningProjectStatus(params.newStatus) : currentStatus;
      const requestedIndex = "newIndex" in params ? Math.max(0, Math.round(asNumber(params.newIndex, 0))) : null;
      const nextProject: JsonObject = {
        ...targetProject,
        status: nextStatus,
        lastUpdated: new Date().toISOString(),
      };

      const remainingProjects = projects.filter((project) => asString(project.id) !== projectId);
      const nextProjects: JsonObject[] = [];
      const orderedStatuses: Array<"todo" | "in-progress" | "blocked" | "done"> = [
        "todo",
        "in-progress",
        "blocked",
        "done",
      ];

      for (const status of orderedStatuses) {
        const statusProjects = remainingProjects
          .filter((project) => normalizePlanningProjectStatus(project.status) === status)
          .sort((left, right) => asNumber(left.order, 0) - asNumber(right.order, 0));
        if (status === nextStatus) {
          const insertIndex = Math.min(statusProjects.length, requestedIndex ?? statusProjects.length);
          statusProjects.splice(insertIndex, 0, nextProject);
        }

        statusProjects.forEach((project, index) => {
          nextProjects.push({
            ...project,
            order: index,
            status,
          });
        });
      }

      planningSnapshot.projects = nextProjects;
      planningSnapshot.settings = settings;

      const activityLog = asArray(planningSnapshot.activityLog);
      activityLog.unshift({
        id: `planning-project-reordered-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "project",
        entityId: projectId,
        action: nextStatus === currentStatus ? "reordered" : "status_changed",
        detail:
          nextStatus === currentStatus
            ? `Reordered project "${asString(targetProject.title)}"`
            : `Moved project "${asString(targetProject.title)}" from ${currentStatus} to ${nextStatus}`,
      });
      planningSnapshot.activityLog = activityLog.slice(0, 40);

      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "project-reordered" });
      return {
        context: cloneJson(asRecord(state.planningSnapshot)),
        project: cloneJson(nextProjects.find((project) => asString(project.id) === projectId) ?? nextProject),
      };
    }
    case "planning.task.create": {
      const title = asString(params.title).trim();
      if (!title) {
        throw new Error("title is required");
      }

      const projectId = asString(params.projectId).trim();
      if (!projectId) {
        throw new Error("projectId is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const projects = asArray(planningSnapshot.projects)
        .map((project) => asRecord(project))
        .filter((project): project is JsonObject => project !== null);
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const settings = asRecord(planningSnapshot.settings) ?? {};
      const project = projects.find((entry) => asString(entry.id) === projectId);
      if (!project) {
        throw new Error(`Planning project '${projectId}' was not found.`);
      }

      const labels = asArray(params.labels)
        .map((label) => asString(label).trim())
        .filter((label) => label.length > 0);
      const timestamp = new Date().toISOString();
      const nextOrder =
        tasks
          .filter((task) => asString(task.projectId) === projectId)
          .reduce((highest, task) => Math.max(highest, asNumber(task.order, -1)), -1) + 1;
      const createdTask: JsonObject = {
        id: `task-${Date.now()}`,
        projectId,
        title,
        description: asString(params.description),
        priority: normalizePlanningPriority(params.priority),
        dueDate: typeof params.dueDate === "string" ? params.dueDate : null,
        labels,
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: nextOrder,
        createdAt: timestamp,
      };

      planningSnapshot.tasks = [...tasks, createdTask];
      settings.selectedProjectId = projectId;
      settings.selectedTaskId = asString(createdTask.id);
      planningSnapshot.settings = settings;

      const activityLog = asArray(planningSnapshot.activityLog);
      activityLog.unshift({
        id: `planning-task-created-${Date.now()}`,
        timestamp,
        entityType: "task",
        entityId: createdTask.id,
        action: "created",
        detail: `Task "${title}" created`,
      });
      planningSnapshot.activityLog = activityLog.slice(0, 40);

      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "task-created" });
      return {
        context: cloneJson(asRecord(state.planningSnapshot)),
        task: cloneJson(createdTask),
      };
    }
    case "planning.task.checklist.add": {
      const taskId = asString(params.taskId).trim();
      if (!taskId) {
        throw new Error("taskId is required");
      }

      const text = asString(params.text).trim();
      if (!text) {
        throw new Error("text is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const targetTask = tasks.find((task) => asString(task.id) === taskId);
      if (!targetTask) {
        throw new Error(`Planning task '${taskId}' was not found.`);
      }

      const checklist = asArray(targetTask.checklist)
        .map((item) => asRecord(item))
        .filter((item): item is JsonObject => item !== null);
      const createdItem: JsonObject = {
        id: `checklist-${Date.now()}`,
        text,
        done: false,
      };
      const updatedTask: JsonObject = {
        ...targetTask,
        checklist: [...checklist, createdItem],
      };

      planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));

      const activityLog = asArray(planningSnapshot.activityLog);
      activityLog.unshift({
        id: `planning-checklist-added-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "task",
        entityId: taskId,
        action: "checklist_added",
        detail: `Checklist item "${text}" added`,
      });
      planningSnapshot.activityLog = activityLog.slice(0, 40);

      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "task-checklist-added" });
      return {
        context: cloneJson(asRecord(state.planningSnapshot)),
        task: cloneJson(updatedTask),
      };
    }
    case "planning.task.checklist.update": {
      const taskId = asString(params.taskId).trim();
      if (!taskId) {
        throw new Error("taskId is required");
      }

      const itemId = asString(params.itemId).trim();
      if (!itemId) {
        throw new Error("itemId is required");
      }

      if (!("done" in params) && !("text" in params)) {
        throw new Error("planning.task.checklist.update requires one or more supported fields");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const targetTask = tasks.find((task) => asString(task.id) === taskId);
      if (!targetTask) {
        throw new Error(`Planning task '${taskId}' was not found.`);
      }

      const checklist = asArray(targetTask.checklist)
        .map((item) => asRecord(item))
        .filter((item): item is JsonObject => item !== null);
      const targetItem = checklist.find((item) => asString(item.id) === itemId);
      if (!targetItem) {
        throw new Error(`Planning checklist item '${itemId}' was not found.`);
      }

      const nextText = "text" in params ? asString(params.text).trim() : asString(targetItem.text);
      if (!nextText) {
        throw new Error("text must not be empty");
      }

      const nextDone = "done" in params ? asBoolean(params.done, false) : asBoolean(targetItem.done, false);
      const updatedItem: JsonObject = {
        ...targetItem,
        done: nextDone,
        text: nextText,
      };
      const updatedTask: JsonObject = {
        ...targetTask,
        checklist: checklist.map((item) => (asString(item.id) === itemId ? updatedItem : item)),
      };

      planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));

      const activityLog = asArray(planningSnapshot.activityLog);
      activityLog.unshift({
        id: `planning-checklist-updated-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "task",
        entityId: taskId,
        action: "checklist_updated",
        detail: "done" in params ? `Checklist item ${nextDone ? "checked" : "unchecked"}` : "Checklist item updated",
      });
      planningSnapshot.activityLog = activityLog.slice(0, 40);

      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "task-checklist-updated" });
      return {
        context: cloneJson(asRecord(state.planningSnapshot)),
        task: cloneJson(updatedTask),
      };
    }
    case "planning.settings.update": {
      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const settings = asRecord(planningSnapshot.settings) ?? {};
      const projects = asArray(planningSnapshot.projects)
        .map((project) => asRecord(project))
        .filter((project): project is JsonObject => project !== null);
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);

      if ("viewFilter" in params) {
        settings.viewFilter = normalizePlanningViewFilter(params.viewFilter);
      }

      if ("modeSection" in params) {
        settings.modeSection = normalizePlanningModeSection(params.modeSection);
      }

      if ("timelineStartHour" in params) {
        settings.timelineStartHour = clampNumber(
          Math.round(asNumber(params.timelineStartHour, asNumber(settings.timelineStartHour, 9))),
          0,
          23
        );
      }

      if ("timelineEndHour" in params) {
        settings.timelineEndHour = clampNumber(
          Math.round(asNumber(params.timelineEndHour, asNumber(settings.timelineEndHour, 22))),
          1,
          23
        );
      }

      if (asNumber(settings.timelineEndHour, 22) <= asNumber(settings.timelineStartHour, 9)) {
        settings.timelineEndHour = Math.min(23, asNumber(settings.timelineStartHour, 9) + 1);
      }

      if ("selectedTaskId" in params) {
        const requestedTaskId = typeof params.selectedTaskId === "string" ? params.selectedTaskId : null;
        const selectedTask =
          requestedTaskId !== null ? (tasks.find((task) => asString(task.id) === requestedTaskId) ?? null) : null;
        settings.selectedTaskId = selectedTask ? asString(selectedTask.id) : null;
        settings.selectedProjectId = selectedTask ? asString(selectedTask.projectId) : null;
      } else if ("selectedProjectId" in params) {
        const requestedProjectId = typeof params.selectedProjectId === "string" ? params.selectedProjectId : null;
        const selectedProject =
          requestedProjectId !== null
            ? (projects.find((project) => asString(project.id) === requestedProjectId) ?? null)
            : null;
        settings.selectedProjectId = selectedProject ? asString(selectedProject.id) : null;
        if (selectedProject) {
          const firstTask = tasks
            .filter((task) => asString(task.projectId) === asString(selectedProject.id))
            .sort((left, right) => asNumber(left.order) - asNumber(right.order))[0];
          settings.selectedTaskId = firstTask ? asString(firstTask.id) : null;
        } else {
          settings.selectedTaskId = null;
        }
      }

      planningSnapshot.settings = settings;
      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "settings-updated" });
      return {
        settings: cloneJson(settings),
      };
    }
    case "planning.task.reschedule": {
      const taskId = asString(params.taskId).trim();
      if (!taskId) {
        throw new Error("taskId is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const targetTask = tasks.find((task) => asString(task.id) === taskId);
      if (!targetTask) {
        throw new Error(`Planning task '${taskId}' was not found.`);
      }

      const requestedProjectId =
        "projectId" in params ? asString(params.projectId).trim() : asString(targetTask.projectId);
      if (!requestedProjectId) {
        throw new Error("projectId is required");
      }

      const projects = asArray(planningSnapshot.projects)
        .map((project) => asRecord(project))
        .filter((project): project is JsonObject => project !== null);
      const targetProject = projects.find((project) => asString(project.id) === requestedProjectId);
      if (!targetProject) {
        throw new Error(`Planning project '${requestedProjectId}' was not found.`);
      }

      if (!("scheduledStart" in params) && !("scheduledDurationSeconds" in params) && !("projectId" in params)) {
        throw new Error("planning.task.reschedule requires scheduledStart, scheduledDurationSeconds, or projectId");
      }

      const nextScheduledStart =
        "scheduledStart" in params
          ? typeof params.scheduledStart === "string"
            ? params.scheduledStart
            : null
          : targetTask.scheduledStart;
      const nextScheduledDurationSeconds =
        "scheduledDurationSeconds" in params
          ? params.scheduledDurationSeconds === null
            ? null
            : Math.max(0, Math.round(asNumber(params.scheduledDurationSeconds, 0)))
          : targetTask.scheduledDurationSeconds;
      const nextProjectId = requestedProjectId;
      const currentProjectId = asString(targetTask.projectId);
      const movedAcrossProjects = nextProjectId !== currentProjectId;
      const nextOrder = movedAcrossProjects
        ? tasks
            .filter((task) => asString(task.projectId) === nextProjectId)
            .reduce((highest, task) => Math.max(highest, asNumber(task.order, -1)), -1) + 1
        : asNumber(targetTask.order, 0);

      const updatedTask: JsonObject = {
        ...targetTask,
        order: nextOrder,
        projectId: nextProjectId,
        scheduledStart: nextScheduledStart,
        scheduledDurationSeconds: nextScheduledDurationSeconds,
      };
      const nextTasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));
      if (movedAcrossProjects) {
        const sourceTasks = nextTasks
          .filter((task) => asString(task.projectId) === currentProjectId && asString(task.id) !== taskId)
          .sort((left, right) => asNumber(left.order, 0) - asNumber(right.order, 0));
        sourceTasks.forEach((task, index) => {
          task.order = index;
        });
      }
      planningSnapshot.tasks = nextTasks;

      const settings = asRecord(planningSnapshot.settings) ?? {};
      if (movedAcrossProjects) {
        settings.selectedProjectId = nextProjectId;
      }
      settings.selectedTaskId = taskId;
      planningSnapshot.settings = settings;

      const activityLog = asArray(planningSnapshot.activityLog);
      const changes: string[] = [];
      if ("projectId" in params) {
        changes.push("projectId");
      }
      if ("scheduledStart" in params) {
        changes.push("scheduledStart");
      }
      if ("scheduledDurationSeconds" in params) {
        changes.push("scheduledDurationSeconds");
      }
      activityLog.unshift({
        id: `planning-reschedule-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "task",
        entityId: taskId,
        action: "rescheduled",
        detail: `Rescheduled ${changes.join(", ")}`,
      });
      planningSnapshot.activityLog = activityLog.slice(0, 40);
      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "task-rescheduled" });
      return {
        task: cloneJson(updatedTask),
      };
    }
    case "planning.task.timer": {
      // Visual overhaul A, Slice 6: the cluster's Stop keys and the plate's
      // live key. The fixture keeps the engine's shape — a running task holds
      // `lastStarted`, and stopping banks the elapsed seconds on the total.
      const taskId = asString(params.taskId).trim();
      if (!taskId) {
        throw new Error("taskId is required");
      }
      const action = asString(params.action).trim() || "toggle";
      if (!["start", "stop", "toggle"].includes(action)) {
        throw new Error("action must be one of: start, stop, toggle");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const targetTask = tasks.find((task) => asString(task.id) === taskId);
      if (!targetTask) {
        throw new Error(`Planning task '${taskId}' was not found.`);
      }

      const wasRunning = asBoolean(targetTask.isRunning, false);
      const running = action === "toggle" ? !wasRunning : action === "start";
      const startedAt = asString(targetTask.lastStarted);
      const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
      const bankedSeconds =
        wasRunning && !running && Number.isFinite(startedMs)
          ? Math.max(0, Math.round((Date.now() - startedMs) / 1000))
          : 0;
      const updatedTask = {
        ...targetTask,
        isRunning: running,
        lastStarted: running ? new Date().toISOString() : targetTask.lastStarted,
        totalSeconds: asNumber(targetTask.totalSeconds, 0) + bankedSeconds,
      };

      planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));
      const timerActivityLog = asArray(planningSnapshot.activityLog);
      timerActivityLog.unshift({
        id: `planning-timer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "task",
        entityId: taskId,
        action: running ? "timer-started" : "timer-stopped",
        detail: `Timer ${running ? "started" : "stopped"} on "${asString(targetTask.title)}"`,
      });
      planningSnapshot.activityLog = timerActivityLog.slice(0, 40);
      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: running ? "timer-started" : "timer-stopped" });
      return { task: cloneJson(updatedTask) };
    }
    case "planning.task.delete": {
      const taskId = asString(params.taskId).trim();
      if (!taskId) {
        throw new Error("taskId is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const targetTask = tasks.find((task) => asString(task.id) === taskId);
      if (!targetTask) {
        throw new Error(`Planning task '${taskId}' was not found.`);
      }

      planningSnapshot.tasks = tasks.filter((task) => asString(task.id) !== taskId);
      const deleteActivityLog = asArray(planningSnapshot.activityLog);
      deleteActivityLog.unshift({
        id: `planning-task-delete-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "task",
        entityId: taskId,
        action: "deleted",
        detail: `Task "${asString(targetTask.title)}" deleted`,
      });
      planningSnapshot.activityLog = deleteActivityLog.slice(0, 40);
      const planningSettings = asRecord(planningSnapshot.settings);
      if (planningSettings && asString(planningSettings.selectedTaskId) === taskId) {
        planningSettings.selectedTaskId = null;
      }
      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "task-deleted" });
      return { taskId };
    }
    case "planning.task.toggleComplete": {
      const taskId = asString(params.taskId).trim();
      if (!taskId) {
        throw new Error("taskId is required");
      }

      const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
      const tasks = asArray(planningSnapshot.tasks)
        .map((task) => asRecord(task))
        .filter((task): task is JsonObject => task !== null);
      const targetTask = tasks.find((task) => asString(task.id) === taskId);
      if (!targetTask) {
        throw new Error(`Planning task '${taskId}' was not found.`);
      }

      const newCompleted = !asBoolean(targetTask.completed, false);
      const updatedTask = {
        ...targetTask,
        completed: newCompleted,
      };

      planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));

      const activityLog = asArray(planningSnapshot.activityLog);
      activityLog.unshift({
        id: `planning-toggle-complete-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entityType: "task",
        entityId: taskId,
        action: newCompleted ? "completed" : "uncompleted",
        detail: `Task "${asString(targetTask.title)}" marked as ${newCompleted ? "completed" : "incomplete"}`,
      });
      planningSnapshot.activityLog = activityLog.slice(0, 40);
      state.planningSnapshot = planningSnapshot;
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "task-toggled-complete" });
      return {
        context: cloneJson(asRecord(state.planningSnapshot)),
        task: cloneJson(updatedTask),
      };
    }
    default:
      return NOT_HANDLED;
  }
}
