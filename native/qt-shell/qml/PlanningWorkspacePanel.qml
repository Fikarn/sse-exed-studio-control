import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

Item {
    id: root
    objectName: "planning-workspace-panel"
    required property var rootWindow
    required property var engineController

    property bool createProjectDialogVisible: false
    property bool importDialogVisible: false
    property alias newProjectTitleField: createProjectDialog.titleField
    property date timelineDay: todayAtMidnight()
    property date clockNow: new Date()
    property string selectedBlockId: ""

    readonly property bool timelineMode: !!engineController && engineController.planningModeSection !== "board"
    readonly property int timelineStartHour: engineController ? engineController.planningTimelineStartHour : 9
    readonly property int timelineEndHour: engineController ? engineController.planningTimelineEndHour : 22

    ConsoleTheme {
        id: theme
    }

    Timer {
        id: clockTimer
        interval: 1000
        running: true
        repeat: true
        onTriggered: root.clockNow = new Date()
    }

    function todayAtMidnight() {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        return now
    }

    function timelineStart() {
        const base = new Date(root.timelineDay.getTime())
        base.setHours(root.timelineStartHour, 0, 0, 0)
        return base
    }

    function timelineEnd() {
        const base = new Date(root.timelineDay.getTime())
        const endHour = Math.max(root.timelineStartHour + 1, root.timelineEndHour)
        base.setHours(endHour, 0, 0, 0)
        return base
    }

    function parseIsoDate(iso) {
        if (!iso) {
            return null
        }
        const parsed = new Date(iso)
        if (isNaN(parsed.getTime())) {
            return null
        }
        return parsed
    }

    function taskIsScheduledToday(task) {
        if (!task || !task.scheduledStart || !task.scheduledDurationSeconds) {
            return false
        }
        const parsed = parseIsoDate(task.scheduledStart)
        if (!parsed) {
            return false
        }
        const dayStart = new Date(root.timelineDay.getTime())
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)
        return parsed.getTime() >= dayStart.getTime() && parsed.getTime() < dayEnd.getTime()
    }

    function filteredTasksForLanes() {
        if (!engineController || !engineController.planningTasks) {
            return []
        }
        const filter = engineController.planningViewFilter || "all"
        const tasks = engineController.planningTasks
        const out = []
        for (let i = 0; i < tasks.length; i += 1) {
            const task = tasks[i]
            if (filter === "todo" && task.completed) continue
            if (filter === "done" && !task.completed) continue
            if (filter === "in-progress" && !task.isRunning) continue
            if (filter === "blocked" && !isBlockedTask(task)) continue
            out.push(task)
        }
        return out
    }

    function isBlockedTask(task) {
        if (!task || !task.labels) {
            return false
        }
        for (let i = 0; i < task.labels.length; i += 1) {
            const label = String(task.labels[i]).toLowerCase()
            if (label === "blocked" || label === "block") {
                return true
            }
        }
        return false
    }

    function buildLanes() {
        const scheduled = filteredTasksForLanes().filter(taskIsScheduledToday)
        const byProject = {}
        const projects = engineController && engineController.planningProjects ? engineController.planningProjects : []
        for (let i = 0; i < projects.length; i += 1) {
            byProject[projects[i].id] = {
                "title": projects[i].title,
                "blocks": [],
                "runningTaskCount": 0
            }
        }
        for (let i = 0; i < scheduled.length; i += 1) {
            const task = scheduled[i]
            const projectId = task.projectId
            if (!byProject[projectId]) {
                continue
            }
            const start = parseIsoDate(task.scheduledStart)
            if (!start) {
                continue
            }
            byProject[projectId].blocks.push({
                "taskId": task.id,
                "title": task.title,
                "meta": task.priority ? task.priority.toUpperCase() : "",
                "status": task.completed ? "done" : task.isRunning ? "running" : "todo",
                "running": !!task.isRunning,
                "blocked": isBlockedTask(task),
                "start": start,
                "duration": Math.max(900, Number(task.scheduledDurationSeconds) || 900)
            })
            if (task.isRunning) {
                byProject[projectId].runningTaskCount += 1
            }
        }
        const lanes = []
        for (let i = 0; i < projects.length; i += 1) {
            const lane = byProject[projects[i].id]
            if (lane && lane.blocks.length > 0) {
                lanes.push(lane)
            }
        }
        return lanes
    }

    function unscheduledTasks() {
        const tasks = filteredTasksForLanes()
        const out = []
        for (let i = 0; i < tasks.length; i += 1) {
            if (!taskIsScheduledToday(tasks[i])) {
                out.push({
                    "taskId": tasks[i].id,
                    "title": tasks[i].title,
                    "priority": tasks[i].priority
                })
            }
        }
        return out
    }

    function statChips() {
        const projectCount = engineController ? engineController.planningProjectCount : 0
        const running = engineController ? engineController.planningRunningTaskCount : 0
        const taskCount = engineController ? engineController.planningTaskCount : 0
        const completed = engineController ? engineController.planningCompletedTaskCount : 0
        return [
            { "key": "projects", "label": "PROJECTS", "value": String(projectCount), "tone": "default" },
            { "key": "running", "label": "RUNNING", "value": String(running), "tone": running > 0 ? "ok" : "default" },
            { "key": "tasks", "label": "TASKS", "value": String(taskCount), "tone": "default" },
            { "key": "done", "label": "DONE", "value": String(completed), "tone": "default" }
        ]
    }

    function toggleMode() {
        const next = root.timelineMode ? "board" : "timeline"
        engineController.updatePlanningSettings({ "modeSection": next })
    }

    function nudgeDay(delta) {
        const next = new Date(root.timelineDay.getTime())
        next.setDate(next.getDate() + delta)
        root.timelineDay = next
    }

    function snapDayToToday() {
        root.timelineDay = todayAtMidnight()
    }

    function nudgeScale(hours) {
        const start = Math.max(0, Math.min(22, root.timelineStartHour - (hours < 0 ? 1 : 0)))
        const end = Math.max(root.timelineStartHour + 1, Math.min(23, root.timelineEndHour + (hours > 0 ? 1 : 0)))
        engineController.updatePlanningSettings({
            "timelineStartHour": start,
            "timelineEndHour": end
        })
    }

    function nudgeSelectedBlock(deltaSeconds) {
        if (!root.selectedBlockId) {
            return
        }
        const tasks = engineController && engineController.planningTasks ? engineController.planningTasks : []
        for (let i = 0; i < tasks.length; i += 1) {
            if (tasks[i].id === root.selectedBlockId) {
                const current = parseIsoDate(tasks[i].scheduledStart)
                if (!current) {
                    return
                }
                const next = new Date(current.getTime() + deltaSeconds * 1000)
                engineController.reschedulePlanningTask(
                    tasks[i].id,
                    next.toISOString(),
                    tasks[i].scheduledDurationSeconds
                )
                return
            }
        }
    }

    function selectAdjacentBlock(direction) {
        const lanes = buildLanes()
        if (lanes.length === 0) {
            return
        }
        const flat = []
        for (let i = 0; i < lanes.length; i += 1) {
            for (let j = 0; j < lanes[i].blocks.length; j += 1) {
                flat.push({ "laneIndex": i, "block": lanes[i].blocks[j] })
            }
        }
        if (flat.length === 0) {
            return
        }
        let currentIdx = -1
        for (let i = 0; i < flat.length; i += 1) {
            if (flat[i].block.taskId === root.selectedBlockId) {
                currentIdx = i
                break
            }
        }
        if (direction === "nudge-left") {
            root.nudgeSelectedBlock(-900)
            return
        }
        if (direction === "nudge-right") {
            root.nudgeSelectedBlock(900)
            return
        }
        if (currentIdx < 0) {
            root.selectedBlockId = flat[0].block.taskId
            engineController.selectPlanningTask(root.selectedBlockId)
            return
        }
        const curLane = flat[currentIdx].laneIndex
        if (direction === "lane-up") {
            for (let i = currentIdx - 1; i >= 0; i -= 1) {
                if (flat[i].laneIndex < curLane) {
                    root.selectedBlockId = flat[i].block.taskId
                    engineController.selectPlanningTask(root.selectedBlockId)
                    return
                }
            }
        } else if (direction === "lane-down") {
            for (let i = currentIdx + 1; i < flat.length; i += 1) {
                if (flat[i].laneIndex > curLane) {
                    root.selectedBlockId = flat[i].block.taskId
                    engineController.selectPlanningTask(root.selectedBlockId)
                    return
                }
            }
        }
    }

    function focusSearch() {
        if (root.timelineMode) {
            timelineSearchField.forceActiveFocus()
            Qt.callLater(function() { timelineSearchField.selectAll() })
        } else {
            boardToolbar.focusSearch()
        }
    }

    function openCreateProjectDialog(defaultStatus) {
        if (defaultStatus && defaultStatus.length > 0) {
            createProjectDialog.statusDraft = defaultStatus
        }
        createProjectDialogVisible = true
    }

    function openImportDialog() {
        importDialogVisible = true
    }

    visible: !!engineController && engineController.workspaceMode === "planning"
    Layout.fillWidth: true
    Layout.fillHeight: true

    ColumnLayout {
        anchors.fill: parent
        spacing: theme.spacing2

        Rectangle {
            id: workspaceToolbar
            Layout.fillWidth: true
            Layout.preferredHeight: theme.toolbarHeight
            color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.92)
            border.color: theme.surfaceBorder
            border.width: 1
            radius: theme.radiusCard

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: theme.spacing4
                anchors.rightMargin: theme.spacing4
                spacing: theme.spacing3

                RowLayout {
                    spacing: 2

                    ConsoleButton {
                        objectName: "planning-mode-timeline"
                        tone: "workspaceTab"
                        compact: true
                        dense: true
                        text: "Timeline"
                        active: root.timelineMode
                        onClicked: {
                            if (!root.timelineMode) {
                                engineController.updatePlanningSettings({ "modeSection": "timeline" })
                            }
                        }
                    }

                    ConsoleButton {
                        objectName: "planning-mode-board"
                        tone: "workspaceTab"
                        compact: true
                        dense: true
                        text: "Board"
                        active: !root.timelineMode
                        onClicked: {
                            if (root.timelineMode) {
                                engineController.updatePlanningSettings({ "modeSection": "board" })
                            }
                        }
                    }
                }

                Rectangle {
                    Layout.preferredWidth: 1
                    Layout.preferredHeight: 20
                    color: theme.surfaceStroke
                }

                ConsoleStatChipRow {
                    id: workspaceChipRow
                    stats: root.statChips()
                }

                Item {
                    Layout.fillWidth: true
                }

                Label {
                    visible: root.timelineMode
                    text: "NOW " + Qt.formatTime(root.clockNow, "HH:mm:ss")
                    color: theme.accentPrimary
                    font.family: theme.monoFontFamily
                    font.pixelSize: theme.textXxs
                    font.weight: Font.DemiBold
                }

                RowLayout {
                    visible: root.timelineMode
                    spacing: 2

                    ConsoleButton {
                        objectName: "planning-day-prev"
                        tone: "icon"
                        compact: true
                        dense: true
                        text: ""
                        iconText: "‹"
                        onClicked: root.nudgeDay(-1)
                    }

                    ConsoleButton {
                        objectName: "planning-day-today"
                        tone: "chip"
                        compact: true
                        dense: true
                        text: Qt.formatDate(root.timelineDay, "ddd d MMM")
                        onClicked: root.snapDayToToday()
                    }

                    ConsoleButton {
                        objectName: "planning-day-next"
                        tone: "icon"
                        compact: true
                        dense: true
                        text: ""
                        iconText: "›"
                        onClicked: root.nudgeDay(1)
                    }
                }

                ConsoleTextField {
                    id: timelineSearchField
                    visible: root.timelineMode
                    objectName: "planning-timeline-search-field"
                    dense: true
                    Layout.preferredWidth: 220
                    placeholderText: "Search tasks..."
                    text: rootWindow.planningSearchQuery
                    onTextEdited: rootWindow.planningSearchQuery = text

                    Binding {
                        target: timelineSearchField
                        property: "text"
                        value: rootWindow.planningSearchQuery
                        when: !timelineSearchField.activeFocus
                    }
                }

                ConsoleButton {
                    objectName: "planning-time-report-toggle"
                    tone: "icon"
                    compact: true
                    dense: true
                    active: root.rootWindow.planningTimeReportVisible
                    text: ""
                    iconText: "☰"
                    ToolTip.visible: hovered
                    ToolTip.text: root.rootWindow.planningTimeReportVisible ? "Hide time report" : "Time report"
                    onClicked: {
                        root.rootWindow.planningTimeReportVisible = !root.rootWindow.planningTimeReportVisible
                        if (root.rootWindow.planningTimeReportVisible) {
                            engineController.requestPlanningTimeReport()
                        }
                    }
                }

                ConsoleButton {
                    objectName: "planning-open-create-project"
                    tone: "primary"
                    compact: true
                    dense: true
                    text: "New Project"
                    iconText: "+"
                    onClicked: root.openCreateProjectDialog("todo")
                }
            }
        }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            Item {
                id: timelineSection
                anchors.fill: parent
                visible: root.timelineMode

                ColumnLayout {
                    anchors.fill: parent
                    spacing: theme.spacing2

                    ConsoleSurface {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        tone: "default"
                        padding: 0

                        ConsoleTimeline {
                            id: planningTimeline
                            anchors.fill: parent
                            start: root.timelineStart()
                            end: root.timelineEnd()
                            clockNow: root.clockNow
                            lanes: root.buildLanes()
                            selectedBlockId: root.selectedBlockId
                            focus: timelineSection.visible

                            onBlockClicked: (taskId) => {
                                root.selectedBlockId = taskId
                                engineController.selectPlanningTask(taskId)
                            }
                            onBlockDragReleased: (taskId, newStart) => {
                                const tasks = engineController && engineController.planningTasks ? engineController.planningTasks : []
                                for (let i = 0; i < tasks.length; i += 1) {
                                    if (tasks[i].id === taskId) {
                                        engineController.reschedulePlanningTask(
                                            taskId,
                                            newStart.toISOString(),
                                            tasks[i].scheduledDurationSeconds
                                        )
                                        return
                                    }
                                }
                            }
                            onSelectionChangeRequested: (direction) => root.selectAdjacentBlock(direction)
                            onDayNudgeRequested: (delta) => root.nudgeDay(delta)
                            onScaleNudgeRequested: (hours) => root.nudgeScale(hours)
                            onSnapScaleToNowRequested: root.snapDayToToday()
                            onOpenSelectedBlockRequested: {
                                if (root.selectedBlockId) {
                                    const tasks = engineController && engineController.planningTasks ? engineController.planningTasks : []
                                    for (let i = 0; i < tasks.length; i += 1) {
                                        if (tasks[i].id === root.selectedBlockId && tasks[i].projectId) {
                                            root.rootWindow.openPlanningProjectDetail(tasks[i].projectId)
                                            return
                                        }
                                    }
                                }
                            }
                        }
                    }

                    ConsoleUnscheduledTray {
                        id: unscheduledTray
                        Layout.fillWidth: true
                        tasks: root.unscheduledTasks()
                    }
                }
            }

            Item {
                id: boardSection
                anchors.fill: parent
                visible: !root.timelineMode

                ColumnLayout {
                    anchors.fill: parent
                    spacing: theme.spacing2

                    PlanningToolbarPanel {
                        id: boardToolbar
                        rootWindow: root.rootWindow
                        engineController: root.engineController
                    }

                    PlanningBoardPanel {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        rootWindow: root.rootWindow
                        engineController: root.engineController
                        onOpenProjectDetail: function(projectId) {
                            root.rootWindow.openPlanningProjectDetail(projectId)
                        }
                    }
                }
            }
        }
    }

    PlanningTimeReportDialog {
        anchors.fill: parent
        open: root.rootWindow.planningTimeReportVisible
        rootWindow: root.rootWindow
        engineController: root.engineController
        onCloseRequested: root.rootWindow.planningTimeReportVisible = false
    }

    PlanningCreateProjectDialog {
        id: createProjectDialog
        anchors.fill: parent
        open: root.createProjectDialogVisible
        rootWindow: root.rootWindow
        engineController: root.engineController
        onCloseRequested: root.createProjectDialogVisible = false
    }

    PlanningImportDialog {
        anchors.fill: parent
        open: root.importDialogVisible
        rootWindow: root.rootWindow
        engineController: root.engineController
        onCloseRequested: root.importDialogVisible = false
    }
}
