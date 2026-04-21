import QtQuick
import QtQuick.Layouts
import QtTest
import "../../qml"

TestCase {
    name: "PlanningWorkspacePanel"
    when: windowShown
    width: 1920
    height: 1080

    Item {
        id: container
        width: parent.width
        height: parent.height
    }

    Component {
        id: workspaceHostComponent

        FocusScope {
            id: host
            width: 1920
            height: 1080
            focus: true

            property alias header: dashboardHeader
            property alias panel: planningPanel
            property alias engine: engineControllerStub
            property alias dashboardLayout: dashboardLayout
            property real dashboardUiScale: 1.0
            property string planningSearchQuery: ""
            property bool planningTimeReportVisible: false
            property bool keyboardHelpVisible: false
            property bool aboutDialogVisible: false
            property bool planningProjectDetailVisible: false
            property string supportRestorePathDraft: ""
            property var projects: [
                {
                    "id": "project-1",
                    "title": "Restore native planning parity",
                    "description": "Keep the operator workflow aligned with the legacy board.",
                    "priority": "p1",
                    "status": "todo",
                    "order": 0
                },
                {
                    "id": "project-2",
                    "title": "Verify dashboard header",
                    "description": "Match the legacy operator shell entry points.",
                    "priority": "p2",
                    "status": "blocked",
                    "order": 1
                }
            ]
            property var tasks: [
                {
                    "id": "task-1",
                    "projectId": "project-1",
                    "title": "Verify modal open from board",
                    "description": "Open the native project detail directly from the lane.",
                    "priority": "p1",
                    "dueDate": "2026-04-22",
                    "labels": ["planning", "modal"],
                    "completed": false,
                    "isRunning": true,
                    "totalSeconds": 780,
                    "checklist": [
                        {
                            "id": "check-1",
                            "text": "Confirm board title opens detail",
                            "done": false
                        }
                    ]
                },
                {
                    "id": "task-2",
                    "projectId": "project-2",
                    "title": "Replace architecture-facing copy",
                    "description": "",
                    "priority": "p2",
                    "dueDate": "",
                    "labels": ["dashboard"],
                    "completed": false,
                    "isRunning": false,
                    "totalSeconds": 120,
                    "checklist": []
                }
            ]
            property var activityLog: [
                {
                    "id": "activity-1",
                    "entityId": "project-1",
                    "action": "updated",
                    "entityType": "project",
                    "detail": "Planning board detail flow reviewed.",
                    "timestamp": "2026-04-17T12:00:00.000Z"
                }
            ]

            QtObject {
                id: engineControllerStub

                property string workspaceMode: "planning"
                property string healthStatus: "healthy"
                property string stateLabel: "Running"
                property string startupPhaseLabel: "Ready"
                property bool appSnapshotLoaded: true
                property bool operatorUiReady: true
                property bool lightingEnabled: true
                property bool lightingReachable: true
                property bool audioOscEnabled: true
                property bool audioVerified: true
                property bool audioConnected: true
                property int lightingFixtureCount: 12
                property int audioChannelCount: 18
                property var planningProjects: host.projects
                property var planningTasks: host.tasks
                property var planningActivityLog: host.activityLog
                property int planningProjectCount: host.projects.length
                property int planningTaskCount: host.tasks.length
                property int planningRunningTaskCount: 1
                property int planningCompletedTaskCount: 0
                property string planningSortBy: "manual"
                property string planningViewFilter: "all"
                property string planningModeSection: "timeline"
                property int planningTimelineStartHour: 9
                property int planningTimelineEndHour: 22
                property string planningSelectedProjectId: "project-1"
                property string planningSelectedTaskId: "task-1"
                property bool planningTimeReportLoaded: true
                property int planningTotalTrackedSeconds: 900
                property var planningTimeByProject: []
                property var planningTimeByTask: []
                property string supportRestoreDetails: "Restore from a native support backup archive or a legacy db.json export."
                property string supportLatestBackupPath: "/tmp/latest-backup.json"

                function updatePlanningSettings(changes) {}
                function requestPlanningTimeReport() {}
                function reschedulePlanningTask(taskId, scheduledStart, scheduledDuration) {}
                function selectPlanningProject(projectId) { planningSelectedProjectId = projectId }
                function selectPlanningTask(taskId) { planningSelectedTaskId = taskId }
                function createPlanningProject(title) {}
                function createPlanningTask(projectId, title) {}
                function togglePlanningTaskComplete(taskId) {}
                function togglePlanningTaskTimer(taskId) {}
                function reorderPlanningProject(projectId, status, index) {}
                function updatePlanningProject(projectId, title, description, priority) {}
                function deletePlanningProject(projectId) {}
                function updatePlanningTask(taskId, title, description, priority, dueDate, labels) {}
                function deletePlanningTask(taskId) {}
                function addPlanningChecklistItem(taskId, text) {}
                function setPlanningChecklistItemDone(taskId, itemId, done) {}
                function deletePlanningChecklistItem(taskId, itemId) {}
                function exportSupportBackup() {}
                function openSupportBackupDirectory() {}
                function restoreSupportBackup(path) {}
                function cyclePlanningProject(direction) {}
                function cyclePlanningTask(direction) {}
            }

            function planningResultCount() {
                return projects.length
            }

            function filteredPlanningProjectsForStatus(status) {
                const items = []

                for (let index = 0; index < projects.length; index += 1) {
                    if (projects[index].status === status) {
                        items.push(projects[index])
                    }
                }

                return items
            }

            function projectById(projectId) {
                for (let index = 0; index < projects.length; index += 1) {
                    if (projects[index].id === projectId) {
                        return projects[index]
                    }
                }

                return null
            }

            function taskById(taskId) {
                for (let index = 0; index < tasks.length; index += 1) {
                    if (tasks[index].id === taskId) {
                        return tasks[index]
                    }
                }

                return null
            }

            function projectTitle(projectId) {
                const project = projectById(projectId)
                return project ? project.title : ""
            }

            function taskTitle(taskId) {
                const task = taskById(taskId)
                return task ? task.title : ""
            }

            function tasksForProject(projectId) {
                const items = []

                for (let index = 0; index < tasks.length; index += 1) {
                    if (tasks[index].projectId === projectId) {
                        items.push(tasks[index])
                    }
                }

                return items
            }

            function checklistTotalsForProject(projectId) {
                const projectTasks = tasksForProject(projectId)
                let done = 0
                let total = 0

                for (let index = 0; index < projectTasks.length; index += 1) {
                    const checklist = projectTasks[index].checklist || []
                    total += checklist.length
                    for (let itemIndex = 0; itemIndex < checklist.length; itemIndex += 1) {
                        if (checklist[itemIndex].done) {
                            done += 1
                        }
                    }
                }

                return { "done": done, "total": total }
            }

            function completedTaskCountForProject(projectId) {
                const projectTasks = tasksForProject(projectId)
                let count = 0

                for (let index = 0; index < projectTasks.length; index += 1) {
                    if (projectTasks[index].completed) {
                        count += 1
                    }
                }

                return count
            }

            function totalSecondsForProject(projectId) {
                const projectTasks = tasksForProject(projectId)
                let total = 0

                for (let index = 0; index < projectTasks.length; index += 1) {
                    total += projectTasks[index].totalSeconds
                }

                return total
            }

            function progressForProject(projectId) {
                const projectTasks = tasksForProject(projectId)
                if (projectTasks.length === 0) {
                    return 0
                }

                return completedTaskCountForProject(projectId) / projectTasks.length
            }

            function activityForProject(projectId) {
                const items = []

                for (let index = 0; index < activityLog.length; index += 1) {
                    if (activityLog[index].entityId === projectId) {
                        items.push(activityLog[index])
                    }
                }

                return items
            }

            function isSelectedProject(projectId) {
                return engineControllerStub.planningSelectedProjectId === projectId
            }

            function isSelectedTask(taskId) {
                return engineControllerStub.planningSelectedTaskId === taskId
            }

            function taskStateLabel(task) {
                if (task.isRunning) {
                    return "Running"
                }

                if (task.completed) {
                    return "Completed"
                }

                return "Queued"
            }

            function checklistProgress(checklist) {
                let done = 0

                for (let index = 0; index < checklist.length; index += 1) {
                    if (checklist[index].done) {
                        done += 1
                    }
                }

                return done + "/" + checklist.length + " done"
            }

            function formatEnumLabel(value) {
                return value === "in-progress"
                       ? "In Progress"
                       : value.charAt(0).toUpperCase() + value.slice(1)
            }

            function formatDueDate(dueDate) {
                return dueDate
            }

            function formatSeconds(totalSeconds) {
                return totalSeconds + "s"
            }

            function formatTimestamp(timestamp) {
                return timestamp
            }

            function activitySummary(entry) {
                return formatEnumLabel(entry.action) + " " + formatEnumLabel(entry.entityType)
            }

            function openPlanningProjectDetail(projectId) {
                planningProjectDetailVisible = true
            }

            ColumnLayout {
                id: dashboardLayout
                anchors.fill: parent
                spacing: 12

                DashboardHeaderPanel {
                    id: dashboardHeader
                    rootWindow: host
                    engineController: engineControllerStub
                    scaleFactor: host.dashboardUiScale
                    Layout.fillWidth: true
                }

                PlanningWorkspacePanel {
                    id: planningPanel
                    rootWindow: host
                    engineController: engineControllerStub
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                }
            }
        }
    }

    function createHost() {
        const host = createTemporaryObject(workspaceHostComponent, container)
        verify(host !== null)
        waitForRendering(host)
        waitForRendering(host.header)
        waitForRendering(host.panel)
        return host
    }

    function test_planningWorkspaceFitsOperatorResolution() {
        const host = createHost()
        verify(host.panel.newProjectTitleField !== null)
        verify(host.header.height + host.dashboardLayout.spacing + host.panel.height <= host.height + 1)
    }
}
