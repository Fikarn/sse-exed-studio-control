import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import "OperatorParityHelpers.js" as OperatorParityHelpers

ApplicationWindow {
    id: root
    required property string scene
    required property string outputPath
    required property int captureWidth
    required property int captureHeight

    ConsoleTheme {
        id: theme
    }

    property real dashboardUiScale: 1.0
    property string parityFrozenClock: "14:22:08 UTC"
    property string parityFrozenUptime: "01:23:45"
    property bool dashboardScene: scene === "dashboard-idle"
    property bool setupWizardScene: scene === "setup-required"
    property bool setupSupportReadyScene: scene === "setup-support-ready"
    property bool setupSupportEmptyScene: scene === "setup-support-empty"
    property bool setupRunnerVerifyScene: scene === "setup-runner-verify-live"
    property bool setupScene: scene === "setup-control-selected"
                              || scene === "setup-control-page-nav"
                              || scene === "setup-control-dial-selected"
                              || setupSupportReadyScene
                              || setupSupportEmptyScene
                              || setupRunnerVerifyScene
    property string planningSearchQuery: ""
    property bool planningTimeReportVisible: scene === "time-report-open"
    property bool keyboardHelpVisible: scene === "shortcuts-open"
    property bool aboutDialogVisible: scene === "about-open"
    property bool planningProjectDetailVisible: scene === "project-detail-open"
    property string supportRestorePathDraft: ""
    property bool createProjectVisible: false
    property string selectedControlSurfacePageId: "projects"
    property string selectedControlSurfaceControlId: scene === "setup-control-page-nav"
                                                    ? "proj-btn-4"
                                                    : scene === "setup-control-dial-selected"
                                                      ? "proj-dial-1-press"
                                                      : "proj-btn-7"
    property bool controlSurfaceOverviewVerifyMode: root.setupRunnerVerifyScene
    property var baseProjects: [
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
            "title": "Stabilize startup routing",
            "description": "Make diagnostics secondary to the operator surface.",
            "priority": "p2",
            "status": "in-progress",
            "order": 1
        },
        {
            "id": "project-3",
            "title": "Document checkpoint evidence",
            "description": "Capture deterministic native screenshots for the parity checkpoint.",
            "priority": "p3",
            "status": "blocked",
            "order": 2
        }
    ]
    property var baseTasks: [
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
                { "id": "check-1", "text": "Confirm board title opens detail", "done": false },
                { "id": "check-2", "text": "Confirm close returns to board", "done": true }
            ]
        },
        {
            "id": "task-2",
            "projectId": "project-1",
            "title": "Preserve shortcut focus path",
            "description": "N should route directly into project creation.",
            "priority": "p2",
            "dueDate": "",
            "labels": ["keyboard"],
            "completed": false,
            "isRunning": false,
            "totalSeconds": 120,
            "checklist": []
        },
        {
            "id": "task-3",
            "projectId": "project-2",
            "title": "Hide runtime shell chrome",
            "description": "",
            "priority": "p2",
            "dueDate": "",
            "labels": ["startup"],
            "completed": false,
            "isRunning": false,
            "totalSeconds": 220,
            "checklist": []
        }
    ]
    property var baseActivityLog: [
        {
            "id": "activity-1",
            "entityId": "project-1",
            "action": "updated",
            "entityType": "project",
            "detail": "Planning board detail flow reviewed.",
            "timestamp": "2026-04-17T12:00:00.000Z"
        },
        {
            "id": "activity-2",
            "entityId": "project-1",
            "action": "updated",
            "entityType": "task",
            "detail": "Shortcut routing aligned with the create-project modal.",
            "timestamp": "2026-04-17T13:00:00.000Z"
        }
    ]
    property var projects: scene === "planning-empty" ? [] : baseProjects
    property var tasks: scene === "planning-empty" ? [] : baseTasks
    property var activityLog: scene === "planning-empty" ? [] : baseActivityLog

    width: captureWidth
    height: captureHeight
    visible: true
    color: theme.studio950
    title: "Parity Capture"

        QtObject {
            id: engineControllerStub

            property bool operatorUiReady: true
            property string workspaceMode: root.setupScene ? "setup" : "planning"
            property string startupTargetSurface: "dashboard"
            property string commissioningStage: root.setupSupportReadyScene || root.setupSupportEmptyScene
                                                ? "ready"
                                                : "in-progress"
            property string lightingBridgeIp: "127.0.0.1"
            property int audioReceivePort: 9001
            property string healthStatus: "healthy"
            property string stateLabel: "Running"
            property string startupPhaseLabel: "Ready"
            property bool appSnapshotLoaded: true
            property string engineVersion: "1.0.0"
            property string protocolVersion: "v1"
            property string storageSqliteVersion: "3.45.1"
            property string storageDetails: "Stored locally in the native operator shell database."
            property bool lightingEnabled: true
            property bool lightingReachable: true
            property int lightingUniverse: 1
            property bool audioOscEnabled: true
            property bool audioVerified: true
            property bool audioConnected: true
            property string audioSendHost: "127.0.0.1"
            property int audioSendPort: 9000
            property bool controlSurfaceSnapshotLoaded: true
            property string controlSurfaceBaseUrl: "http://127.0.0.1:38201"
            property bool controlSurfaceAvailable: true
            property string companionExportPath: ""
            property bool supportSnapshotLoaded: true
            property string supportDetails: "Native support archives protect planning, lighting, audio, and setup state."
            property string supportRestoreDetails: "Restore from a native support backup archive."
            property string supportBackupDir: "/tmp/backups"
            property string supportLatestBackupPath: root.setupSupportEmptyScene ? "" : "/tmp/backups/latest.json"
            property int supportBackupCount: root.setupSupportEmptyScene ? 0 : 2
            property var supportBackupFiles: root.setupSupportEmptyScene
                ? []
                : [
                    { "name": "backup-a.json", "sizeBytes": 200, "modifiedAt": "2026-04-17T12:00:00Z" },
                    { "name": "backup-b.json", "sizeBytes": 180, "modifiedAt": "2026-04-17T13:00:00Z" }
                ]
            property string shellDiagnosticsExportPath: ""
            property string appDataPath: "/tmp/appdata"
            property string databasePath: "/tmp/appdata/state.sqlite"
            property string logsPath: "/tmp/appdata/logs"
            property string engineLogPath: "/tmp/appdata/logs/engine.log"
            property var commissioningChecks: [
                { "id": "control-surface", "status": "idle", "message": "" }
            ]
        property var controlSurfacePages: [
            {
                "id": "projects",
                "label": "PROJECTS",
                "buttons": [
                    { "id": "proj-btn-1", "label": "All", "description": "Set project filter to all.", "type": "button", "position": 1, "method": "POST", "url": "/api/deck/action", "body": { "action": "setFilter", "value": "all" } },
                    { "id": "proj-btn-2", "label": "To Do", "description": "Set project filter to todo.", "type": "button", "position": 2, "method": "POST", "url": "/api/deck/action", "body": { "action": "setFilter", "value": "todo" } },
                    { "id": "proj-btn-3", "label": "In Prog", "description": "Set project filter to in-progress.", "type": "button", "position": 3, "method": "POST", "url": "/api/deck/action", "body": { "action": "setFilter", "value": "in-progress" } },
                    { "id": "proj-btn-4", "label": "TASKS >>", "description": "Navigate to the TASKS page.", "type": "button", "position": 4, "isPageNav": true, "pageNavTarget": "TASKS" },
                    { "id": "proj-btn-5", "label": "Blocked", "description": "Set project filter to blocked.", "type": "button", "position": 5, "method": "POST", "url": "/api/deck/action", "body": { "action": "setFilter", "value": "blocked" } },
                    { "id": "proj-btn-6", "label": "Done", "description": "Set project filter to done.", "type": "button", "position": 6, "method": "POST", "url": "/api/deck/action", "body": { "action": "setFilter", "value": "done" } },
                    { "id": "proj-btn-7", "label": "New Proj", "description": "Create a new project.", "type": "button", "position": 7, "method": "POST", "url": "/api/deck/action", "body": { "action": "createProject" } },
                    { "id": "proj-btn-8", "label": "LIGHTS >>", "description": "Navigate to the LIGHTS page.", "type": "button", "position": 8, "isPageNav": true, "pageNavTarget": "LIGHTS" }
                ],
                "dials": [
                    { "id": "proj-dial-1-press", "label": "Project", "description": "Open the current project or task detail.", "type": "dial-press", "position": 1, "method": "POST", "url": "/api/deck/action", "body": { "action": "openDetail" } },
                    { "id": "proj-dial-1-left", "label": "Dial Left", "description": "Select the previous project.", "type": "dial-turn-left", "position": 1, "method": "POST", "url": "/api/deck/action", "body": { "action": "selectPrevProject" } },
                    { "id": "proj-dial-1-right", "label": "Dial Right", "description": "Select the next project.", "type": "dial-turn-right", "position": 1, "method": "POST", "url": "/api/deck/action", "body": { "action": "selectNextProject" } },
                    { "id": "proj-dial-2-press", "label": "Status", "description": "Open status details.", "type": "dial-press", "position": 2, "method": "POST", "url": "/api/deck/action", "body": { "action": "openStatus" } },
                    { "id": "proj-dial-3-press", "label": "Priority", "description": "Open priority details.", "type": "dial-press", "position": 3, "method": "POST", "url": "/api/deck/action", "body": { "action": "openPriority" } },
                    { "id": "proj-dial-4-press", "label": "Sort", "description": "Open sort details.", "type": "dial-press", "position": 4, "method": "POST", "url": "/api/deck/action", "body": { "action": "openSort" } }
                ]
            },
            { "id": "tasks", "label": "TASKS", "buttons": [], "dials": [] },
            { "id": "lights", "label": "LIGHTS", "buttons": [], "dials": [] },
            { "id": "audio", "label": "AUDIO", "buttons": [], "dials": [] }
        ]
        property int lightingFixtureCount: 12
        property int audioChannelCount: 18
        property var planningProjects: root.projects
        property var planningTasks: root.tasks
        property var planningActivityLog: root.activityLog
        property int planningProjectCount: root.projects.length
        property int planningTaskCount: root.tasks.length
        property int planningRunningTaskCount: 1
        property int planningCompletedTaskCount: 0
        property string planningSortBy: "manual"
        property string planningViewFilter: "all"
        property string planningSelectedProjectId: root.projects.length > 0 && root.scene !== "dashboard-idle" ? "project-1" : ""
        property string planningSelectedTaskId: root.tasks.length > 0 && root.scene !== "dashboard-idle" ? "task-1" : ""
        property bool planningTimeReportLoaded: true
        property int planningTotalTrackedSeconds: 1120
        property var planningTimeByProject: [
            { "title": "Restore native planning parity", "totalSeconds": 900, "taskCount": 2 },
            { "title": "Stabilize startup routing", "totalSeconds": 220, "taskCount": 1 }
        ]
        property var planningTimeByTask: [
            { "taskTitle": "Verify modal open from board", "projectTitle": "Restore native planning parity", "totalSeconds": 780, "isRunning": true },
            { "taskTitle": "Hide runtime shell chrome", "projectTitle": "Stabilize startup routing", "totalSeconds": 220, "isRunning": false }
        ]
        function setWorkspaceMode(workspaceModeValue) { workspaceMode = workspaceModeValue }
        function updatePlanningSettings(changes) {
            if (changes.sortBy) {
                planningSortBy = changes.sortBy
            }
            if (changes.viewFilter) {
                planningViewFilter = changes.viewFilter
            }
        }
        function requestPlanningTimeReport() {}
        function selectPlanningProject(projectId) { planningSelectedProjectId = projectId }
        function selectPlanningTask(taskId) { planningSelectedTaskId = taskId }
        function createPlanningProject(title) {}
        function createPlanningProjectWithDetails(title, description, status, priority) {}
        function createPlanningTask(projectId, title) {}
        function createPlanningTaskWithDetails(projectId, title, description, priority, dueDate, labelsCsv) {}
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
        function requestSupportSnapshot() {}
        function cyclePlanningProject(direction) {}
        function cyclePlanningTask(direction) {}
        function exportCompanionConfig() {}
        function requestControlSurfaceSnapshot() {}
        function runControlSurfaceProbe() {}
        function requestLightingSnapshot() {}
        function requestAudioSnapshot() {}
        function exportShellDiagnostics() {}
        function openAppDataDirectory() {}
        function openLogsDirectory() {}
        function openEngineLogFile() {}
        function openDiagnosticsDirectory() {}
        function runLightingProbe(ip, universe) {}
        function runAudioProbe(sendHost, sendPort, receivePort) {}
        function updateCommissioningStage(stage) { commissioningStage = stage }
    }

    function planningResultCount() {
        return root.projects.length
    }

    function focusPlanningSearch() {
        if (planningWorkspacePanel) {
            planningWorkspacePanel.focusSearch()
        }
    }

    function inputFieldHasFocus() {
        const item = root.activeFocusItem
        return !!item && item.hasOwnProperty("cursorPosition")
    }

    function closeTransientPanels() {
        keyboardHelpVisible = false
        aboutDialogVisible = false
        planningTimeReportVisible = false
        planningProjectDetailVisible = false
    }

    function openPlanningProjectDetail(projectId) {
        if (!projectId || projectId.length === 0) {
            return
        }

        engineControllerStub.selectPlanningProject(projectId)
        planningProjectDetailVisible = true
    }

    function filteredPlanningProjectsForStatus(status) {
        const items = []
        for (let index = 0; index < projects.length; index += 1) {
            if (projects[index].status === status) {
                items.push(projects[index])
            }
        }
        items.sort(function(lhs, rhs) { return lhs.order - rhs.order })
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

    function labelsToCsv(labels) {
        return (labels || []).join(", ")
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

    function formatDueDate(dueDate) {
        return dueDate
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

    function formatSeconds(totalSeconds) {
        return totalSeconds + "s"
    }

    function activitySummary(entry) {
        return formatEnumLabel(entry.action) + " " + formatEnumLabel(entry.entityType)
    }

    function formatTimestamp(timestamp) {
        return timestamp
    }

    function formatProjectUpdated(timestamp) {
        if (!timestamp || timestamp.length === 0) {
            return "Updated recently"
        }

        const date = new Date(timestamp)
        if (Number.isNaN(date.getTime())) {
            return "Updated recently"
        }

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let hours = date.getHours()
        const minutes = String(date.getMinutes()).padStart(2, "0")
        const meridiem = hours >= 12 ? "PM" : "AM"
        hours = hours % 12
        if (hours === 0) {
            hours = 12
        }

        return "Updated " + monthNames[date.getMonth()] + " "
                + date.getDate() + ", " + hours + ":" + minutes + " " + meridiem
    }

    function formatEnumLabel(value) {
        if (value === "todo") {
            return "To Do"
        }

        if (value === "in-progress") {
            return "In Progress"
        }

        return value.charAt(0).toUpperCase() + value.slice(1)
    }

    function controlSurfacePageById(pageId) {
        return OperatorParityHelpers.controlSurfacePageById(engineControllerStub.controlSurfacePages, pageId)
    }

    function controlSurfaceControlById(pageId, controlId) {
        return OperatorParityHelpers.controlSurfaceControlById(engineControllerStub.controlSurfacePages, pageId, controlId)
    }

    function commissioningCheckById(checkId) {
        const checks = engineControllerStub.commissioningChecks || []
        for (let index = 0; index < checks.length; index += 1) {
            if (checks[index].id === checkId) {
                return checks[index]
            }
        }
        return null
    }

    function commissioningStatusLabel(status) {
        if (status === "ok") {
            return "Console reachable"
        }
        if (status === "error") {
            return "Probe failed"
        }
        return "Not tested"
    }

    function commissioningStatusColor(status) {
        if (status === "ok") {
            return "#6fd3a4"
        }
        if (status === "error") {
            return "#ff9a7d"
        }
        return "#9bb0c9"
    }

    function formatFileSize(sizeBytes) {
        return sizeBytes + " B"
    }

    function formatUnixTimestamp(timestamp) {
        return timestamp
    }

    function hostPlatformLabel() { return "macOS Apple Silicon" }
    function hostInstallerArtifact() { return "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip" }
    function hostUpdateArtifact() { return "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip" }

    Item {
        id: captureSurface
        anchors.fill: parent

        Rectangle {
            anchors.fill: parent
            color: theme.shellBase

            Rectangle {
                anchors.fill: parent
                gradient: Gradient {
                    GradientStop { position: 0.0; color: theme.shellTop }
                    GradientStop { position: 1.0; color: theme.shellBase }
                }
            }

            Rectangle {
                width: parent.width * 0.66
                height: width
                x: -width * 0.38
                y: -height * 0.4
                radius: width / 2
                color: Qt.rgba(theme.accentPrimary.r,
                               theme.accentPrimary.g,
                               theme.accentPrimary.b,
                               root.setupWizardScene
                               ? 0.0
                               : root.setupScene
                                 ? 0.18
                                 : 0.035)
            }

            Rectangle {
                width: parent.width * 0.58
                height: width
                x: parent.width - width * 0.56
                y: -height * 0.28
                radius: width / 2
                color: Qt.rgba(root.setupScene ? theme.shellNeutralGlow.r : theme.accentPrimary.r,
                               root.setupScene ? theme.shellNeutralGlow.g : theme.accentPrimary.g,
                               root.setupScene ? theme.shellNeutralGlow.b : theme.accentPrimary.b,
                               root.setupWizardScene
                               ? 0.0
                               : root.setupScene
                                 ? 0.05
                                 : 0.02)
            }

            Repeater {
                model: Math.ceil(parent.width / 56)

                Rectangle {
                    x: index * 56
                    width: 1
                    height: parent.height
                    color: root.setupWizardScene
                           ? "transparent"
                           : root.setupScene
                             ? Qt.rgba(1, 1, 1, 0.03)
                             : theme.shellGridLine
                }
            }

            Repeater {
                model: Math.ceil(parent.height / 56)

                Rectangle {
                    y: index * 56
                    width: parent.width
                    height: 1
                    color: root.setupWizardScene
                           ? "transparent"
                           : root.setupScene
                             ? Qt.rgba(1, 1, 1, 0.03)
                             : theme.shellGridLine
                }
            }
        }

        Item {
            id: setupWizardBackdrop
            visible: root.setupWizardScene
            anchors.fill: parent
            opacity: 0.6

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 12

                DashboardHeaderPanel {
                    visible: root.dashboardScene || root.setupWizardScene
                    rootWindow: root
                    engineController: engineControllerStub
                    scaleFactor: root.dashboardUiScale
                    Layout.fillWidth: true
                    opacity: root.setupWizardScene ? 1.0 : 1.0
                    enabled: !root.setupWizardScene
                }

                PlanningWorkspacePanel {
                    id: planningWorkspacePanel
                    rootWindow: root
                    engineController: engineControllerStub
                    scaleFactor: root.dashboardUiScale
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    opacity: root.setupWizardScene ? 1.0 : 1.0
                    enabled: !root.setupWizardScene
                }
            }
        }

        ColumnLayout {
            visible: !root.setupScene && !root.setupWizardScene
            anchors.fill: parent
            anchors.margins: 18
            spacing: 12

            DashboardHeaderPanel {
                visible: root.dashboardScene
                rootWindow: root
                engineController: engineControllerStub
                scaleFactor: root.dashboardUiScale
                Layout.fillWidth: true
            }

            PlanningWorkspacePanel {
                rootWindow: root
                engineController: engineControllerStub
                scaleFactor: root.dashboardUiScale
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
        }

        SetupWorkspacePanel {
            id: setupWorkspacePanel
            visible: root.setupScene
            anchors.fill: parent
            anchors.margins: 16
            rootWindow: root
            engineController: engineControllerStub
            scaleFactor: 1.0
            activeSection: root.setupSupportReadyScene || root.setupSupportEmptyScene
                           ? "support"
                           : "commissioning"
            activeStepId: root.setupRunnerVerifyScene
                          ? "verify"
                          : (root.scene === "setup-control-selected"
                             || root.scene === "setup-control-page-nav"
                             || root.scene === "setup-control-dial-selected")
                            ? "map"
                            : "import"
        }

        SetupWizardOverlay {
            visible: root.setupWizardScene
            anchors.fill: parent
            rootWindow: root
            engineController: engineControllerStub
            backdropSourceItem: setupWizardBackdrop
        }

        PlanningProjectDetailDialog {
            anchors.fill: parent
            rootWindow: root
            engineController: engineControllerStub
            open: root.planningProjectDetailVisible
        }

        DashboardAboutDialog {
            anchors.fill: parent
            rootWindow: root
            engineController: engineControllerStub
            open: root.aboutDialogVisible
        }

        OperatorShortcutsDialog {
            anchors.fill: parent
            rootWindow: root
            engineController: engineControllerStub
            open: root.keyboardHelpVisible
        }
    }

    Timer {
        interval: 250
        running: true
        repeat: false
        onTriggered: {
            captureSurface.grabToImage(function(result) {
                result.saveToFile(root.outputPath)
                Qt.callLater(Qt.quit)
            })
        }
    }
}
