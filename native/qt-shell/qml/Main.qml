import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQml
import QtQuick.Window
import "OperatorParityHelpers.js" as OperatorParityHelpers

ApplicationWindow {
    id: root
    property QtObject engineController: null
    property bool shellSmokeTest: false
    property bool parityCaptureMode: false
    property string parityFrozenClock: parityCaptureMode ? "14:22:08 UTC" : ""
    property string parityFrozenUptime: parityCaptureMode ? "01:23:45" : ""
    property string operatorVerifyAction: ""
    property bool operatorVerifyActionCompleted: false
    property bool operatorVerifyReadyForScreenshot: false
    property string operatorVerifyReadySurface: ""
    property string operatorVerifyReadyFollowup: ""
    property string pendingOperatorVerifyFixture: ""
    property string pendingOperatorVerifyFollowup: ""
    property bool windowSettingsApplied: false
    property bool suppressWindowStateSync: false
    property string planningSearchQuery: ""
    property bool planningTimeReportVisible: false
    property bool keyboardHelpVisible: false
    property bool aboutDialogVisible: false
    property bool planningProjectDetailVisible: false
    property bool runtimeSupportVisible: false
    property real dashboardUiScale: 1.0
    property var planningWorkspacePanelRef: null
    property var lightingWorkspacePanelRef: null
    property var setupWorkspacePanelRef: null
    property string selectedProjectTitleDraft: ""
    property string selectedProjectDescriptionDraft: ""
    property string selectedProjectPriorityDraft: "p2"
    property string selectedTaskTitleDraft: ""
    property string selectedTaskDescriptionDraft: ""
    property string selectedTaskPriorityDraft: "p2"
    property string selectedTaskDueDateDraft: ""
    property string selectedTaskLabelsDraft: ""
    property string selectedChecklistItemDraft: ""
    property bool audioOscEnabledDraft: true
    property string audioSendHostDraft: "127.0.0.1"
    property int audioSendPortDraft: 7001
    property int audioReceivePortDraft: 9001
    property bool audioExpectedPeakDataDraft: true
    property bool audioExpectedSubmixLockDraft: true
    property bool audioExpectedCompatibilityModeDraft: false
    property string audioNewSnapshotNameDraft: ""
    property int audioNewSnapshotSlotDraft: 1
    property string selectedAudioChannelId: ""
    property string selectedAudioMixTargetId: ""
    property string commissioningHardwareProfileDraft: ""
    property string commissioningLightingBridgeIpDraft: ""
    property int commissioningLightingUniverseDraft: 1
    property string commissioningAudioSendHostDraft: "127.0.0.1"
    property int commissioningAudioSendPortDraft: 7001
    property int commissioningAudioReceivePortDraft: 9001
    property bool lightingEnabledDraft: false
    property string lightingBridgeIpDraft: ""
    property int lightingUniverseDraft: 1
    property int lightingGrandMasterDraft: 100
    property string lightingNewFixtureNameDraft: ""
    property string lightingNewFixtureTypeDraft: "astra-bicolor"
    property int lightingNewFixtureDmxDraft: 1
    property string lightingNewFixtureGroupDraft: ""
    property string lightingNewGroupNameDraft: ""
    property string lightingNewSceneNameDraft: ""
    property string supportRestorePathDraft: ""
    property string selectedControlSurfacePageId: ""
    property string selectedControlSurfaceControlId: ""
    property bool controlSurfaceOverviewVerifyMode: false
    property string operatorSurfaceTarget: engineController && engineController.appSnapshotLoaded
                                           ? engineController.startupTargetSurface
                                           : "locked"

    width: 1280
    height: 800
    visible: !shellSmokeTest
    title: operatorSurfaceTarget === "dashboard"
           ? "SSE ExEd Studio Control - Dashboard"
           : operatorSurfaceTarget === "commissioning"
             ? "SSE ExEd Studio Control - Commissioning"
             : "SSE ExEd Studio Control"
    color: theme.shellBase

    ConsoleTheme {
        id: theme
    }

    background: Rectangle {
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
            color: Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.18)
        }

        Rectangle {
            width: parent.width * 0.58
            height: width
            x: parent.width - width * 0.56
            y: -height * 0.28
            radius: width / 2
            color: Qt.rgba(theme.shellNeutralGlow.r, theme.shellNeutralGlow.g, theme.shellNeutralGlow.b, 0.12)
        }

        Repeater {
            model: Math.ceil(parent.width / 56)

            Rectangle {
                x: index * 56
                width: 1
                height: parent.height
                color: theme.shellGridLine
            }
        }

        Repeater {
            model: Math.ceil(parent.height / 56)

            Rectangle {
                y: index * 56
                width: parent.width
                height: 1
                color: theme.shellGridLine
            }
        }
    }

    function activeWorkspaceIndex() {
        if (!engineController) {
            return 0
        }

        switch (engineController.workspaceMode) {
        case "planning":
            return 0
        case "lighting":
            return 1
        case "audio":
            return 2
        case "setup":
            return 3
        default:
            return 4
        }
    }

    function currentWindowMode() {
        if (root.dashboardSurfaceRequested()) {
            return "fullscreen"
        }

        switch (root.visibility) {
        case Window.FullScreen:
            return "fullscreen"
        case Window.Maximized:
            return "maximized"
        default:
            return "windowed"
        }
    }

    function restoredWindowMode() {
        if (!engineController) {
            return "fullscreen"
        }

        if (root.dashboardSurfaceRequested()) {
            return "fullscreen"
        }

        if (engineController.windowMode && engineController.windowMode.length > 0) {
            return engineController.windowMode
        }

        if (engineController.windowMaximized) {
            return "maximized"
        }

        return root.dashboardSurfaceRequested() ? "fullscreen" : "windowed"
    }

    function maybeRunOperatorVerifyAction() {
        if (root.operatorVerifyActionCompleted || !root.operatorVerifyAction.length || !engineController
                || !engineController.operatorUiReady) {
            return
        }

        root.operatorVerifyActionCompleted = true
        root.clearOperatorVerifyReadyState()
        Qt.callLater(function() {
            switch (root.operatorVerifyAction) {
            case "workspace-lighting":
            case "lighting-populated":
                root.loadParityFixtureForVerify("lighting-populated", "lighting")
                break
            case "lighting-add-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-add")
                break
            case "lighting-scene-delete-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-scene-delete")
                break
            case "lighting-scene-rename-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-scene-rename")
                break
            case "lighting-group-rename-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-group-rename")
                break
            case "lighting-group-delete-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-group-delete")
                break
            case "lighting-edit-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-edit")
                break
            case "lighting-delete-open":
                root.loadParityFixtureForVerify("lighting-populated", "lighting-delete")
                break
            case "workspace-audio":
            case "audio-populated":
                root.loadParityFixtureForVerify("audio-populated", "audio")
                break
            case "workspace-planning":
                root.loadParityFixtureForVerify("planning-empty", "")
                break
            case "planning-empty":
                root.loadParityFixtureForVerify("planning-empty", "")
                break
            case "planning-populated":
            case "seed-planning-demo":
            case "seed-planning-board-demo":
                root.loadParityFixtureForVerify("planning-populated", "")
                break
            case "project-detail-open":
                root.loadParityFixtureForVerify("planning-populated", "project-detail")
                break
            case "time-report-open":
            case "seed-planning-demo-time-report":
                root.loadParityFixtureForVerify("planning-populated", "time-report")
                break
            case "setup-required":
                root.loadParityFixtureForVerify("setup-required", "")
                break
            case "setup-ready":
                root.loadParityFixtureForVerify("setup-ready", "")
                break
            case "support-open":
                root.loadParityFixtureForVerify("setup-ready", "support")
                break
            case "setup-control-selected":
                root.loadParityFixtureForVerify("setup-ready", "setup-control-selected")
                break
            case "setup-control-dial-selected":
                root.loadParityFixtureForVerify("setup-ready", "setup-control-dial-selected")
                break
            case "setup-control-page-nav":
                root.loadParityFixtureForVerify("setup-ready", "setup-control-page-nav")
                break
            case "open-time-report":
                if (engineController.planningProjectCount > 0) {
                    engineController.setWorkspaceMode("planning")
                    root.planningTimeReportVisible = true
                    engineController.requestPlanningTimeReport()
                    root.scheduleOperatorVerifyReadyState("planning", "time-report")
                } else {
                    root.loadParityFixtureForVerify("planning-populated", "time-report")
                }
                break
            case "open-shortcuts":
                root.keyboardHelpVisible = true
                root.scheduleOperatorVerifyReadyState(engineController.workspaceMode, "shortcuts")
                break
            case "open-about":
                root.aboutDialogVisible = true
                root.scheduleOperatorVerifyReadyState(engineController.workspaceMode, "about")
                break
            case "workspace-planning-live":
                engineController.setWorkspaceMode("planning")
                root.scheduleOperatorVerifyReadyState("planning", "")
                break
            default:
                root.operatorVerifyActionCompleted = false
                break
            }
        })
    }

    function loadParityFixtureForVerify(fixtureId, followup) {
        if (!engineController) {
            root.operatorVerifyActionCompleted = false
            return
        }

        root.clearOperatorVerifyReadyState()
        root.pendingOperatorVerifyFixture = fixtureId
        root.pendingOperatorVerifyFollowup = followup ? followup : ""
        root.planningTimeReportVisible = false
        root.planningProjectDetailVisible = false
        root.runtimeSupportVisible = false
        if (root.lightingWorkspacePanelRef && root.lightingWorkspacePanelRef.closeTransientDialogs) {
            root.lightingWorkspacePanelRef.closeTransientDialogs()
        }
        engineController.loadParityFixture(fixtureId, true)
    }

    function clearOperatorVerifyReadyState() {
        root.operatorVerifyReadyForScreenshot = false
        root.operatorVerifyReadySurface = ""
        root.operatorVerifyReadyFollowup = ""
    }

    function scheduleOperatorVerifyReadyState(surface, followup) {
        const resolvedSurface = surface && surface.length
                                ? surface
                                : (engineController ? engineController.workspaceMode : "")
        const resolvedFollowup = followup && followup.length ? followup : ""
        Qt.callLater(function() {
            Qt.callLater(function() {
                root.operatorVerifyReadySurface = resolvedSurface
                root.operatorVerifyReadyFollowup = resolvedFollowup
                root.operatorVerifyReadyForScreenshot = true
            })
        })
    }

    function pendingOperatorVerifyNeedsPlanningSnapshot() {
        return root.pendingOperatorVerifyFixture === "planning-populated"
                || root.pendingOperatorVerifyFixture === "planning-empty"
    }

    function pendingOperatorVerifyNeedsLightingSnapshot() {
        return root.pendingOperatorVerifyFixture === "lighting-populated"
    }

    function pendingOperatorVerifyNeedsAudioSnapshot() {
        return root.pendingOperatorVerifyFixture === "audio-populated"
    }

    function openLightingVerifyDialog(dialogMode) {
        if (!engineController) {
            root.operatorVerifyActionCompleted = false
            return
        }

        engineController.setWorkspaceMode("lighting")
        Qt.callLater(function() {
            Qt.callLater(function() {
                if (!root.lightingWorkspacePanelRef) {
                    root.operatorVerifyActionCompleted = false
                    return
                }

                let opened = false
                if (dialogMode === "add" && root.lightingWorkspacePanelRef.openAddFixtureDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openAddFixtureDialogForVerify()
                } else if (dialogMode === "scene-delete"
                           && root.lightingWorkspacePanelRef.openDeleteSceneDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openDeleteSceneDialogForVerify()
                } else if (dialogMode === "scene-rename"
                           && root.lightingWorkspacePanelRef.openRenameSceneDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openRenameSceneDialogForVerify()
                } else if (dialogMode === "group-rename"
                           && root.lightingWorkspacePanelRef.openRenameGroupDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openRenameGroupDialogForVerify()
                } else if (dialogMode === "group-delete"
                           && root.lightingWorkspacePanelRef.openDeleteGroupDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openDeleteGroupDialogForVerify()
                } else if (dialogMode === "edit" && root.lightingWorkspacePanelRef.openFixtureEditDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openFixtureEditDialogForVerify()
                } else if (dialogMode === "delete"
                           && root.lightingWorkspacePanelRef.openFixtureDeleteDialogForVerify) {
                    opened = root.lightingWorkspacePanelRef.openFixtureDeleteDialogForVerify()
                }

                if (!opened) {
                    root.operatorVerifyActionCompleted = false
                    return
                }

                root.scheduleOperatorVerifyReadyState("lighting", dialogMode + "-dialog")
            })
        })
    }

    function applyAudioVerifySelection() {
        if (!engineController) {
            return
        }

        root.selectedAudioChannelId = "audio-input-9"
        root.selectedAudioMixTargetId = "audio-mix-main"
        engineController.updateAudioSettings({
            "selectedChannelId": "audio-input-9",
            "selectedMixTargetId": "audio-mix-main"
        })
    }

    function tryFinalizeOperatorVerifyFixture() {
        if (!engineController || !root.pendingOperatorVerifyFixture.length || !engineController.appSnapshotLoaded) {
            return
        }

        switch (root.pendingOperatorVerifyFixture) {
        case "planning-populated":
            if (!engineController.planningSnapshotLoaded
                    || engineController.startupTargetSurface !== "dashboard"
                    || engineController.planningProjectCount <= 0) {
                return
            }
            break
        case "planning-empty":
            if (!engineController.planningSnapshotLoaded
                    || engineController.startupTargetSurface !== "dashboard"
                    || engineController.planningProjectCount !== 0) {
                return
            }
            break
        case "lighting-populated":
            if (!engineController.lightingSnapshotLoaded
                    || engineController.startupTargetSurface !== "dashboard"
                    || engineController.lightingFixtureCount <= 0
                    || engineController.lightingSceneCount <= 0) {
                return
            }
            break
        case "audio-populated":
            if (!engineController.audioSnapshotLoaded
                    || engineController.startupTargetSurface !== "dashboard"
                    || engineController.audioChannelCount <= 0
                    || engineController.audioMixTargetCount <= 0
                    || engineController.audioSnapshotCount <= 0) {
                return
            }
            break
        case "setup-required":
            if (engineController.startupTargetSurface !== "commissioning") {
                return
            }
            break
        case "setup-ready":
            if (engineController.startupTargetSurface !== "dashboard") {
                return
            }
            break
        default:
            return
        }

        const followup = root.pendingOperatorVerifyFollowup
        const fixtureId = root.pendingOperatorVerifyFixture
        root.pendingOperatorVerifyFixture = ""
        root.pendingOperatorVerifyFollowup = ""

        switch (followup) {
        case "lighting":
            engineController.setWorkspaceMode("lighting")
            root.scheduleOperatorVerifyReadyState("lighting", "")
            break
        case "lighting-add":
            root.openLightingVerifyDialog("add")
            break
        case "lighting-scene-delete":
            root.openLightingVerifyDialog("scene-delete")
            break
        case "lighting-scene-rename":
            root.openLightingVerifyDialog("scene-rename")
            break
        case "lighting-group-rename":
            root.openLightingVerifyDialog("group-rename")
            break
        case "lighting-group-delete":
            root.openLightingVerifyDialog("group-delete")
            break
        case "lighting-edit":
            root.openLightingVerifyDialog("edit")
            break
        case "lighting-delete":
            root.openLightingVerifyDialog("delete")
            break
        case "audio":
            engineController.setWorkspaceMode("audio")
            root.applyAudioVerifySelection()
            Qt.callLater(function() {
                root.scheduleOperatorVerifyReadyState("audio", "")
            })
            break
        case "project-detail":
            engineController.setWorkspaceMode("planning")
            if (engineController.planningSelectedProjectId && engineController.planningSelectedProjectId.length > 0) {
                root.planningProjectDetailVisible = true
            }
            root.scheduleOperatorVerifyReadyState("planning", "project-detail")
            break
        case "time-report":
            engineController.setWorkspaceMode("planning")
            root.planningTimeReportVisible = true
            engineController.requestPlanningTimeReport()
            root.scheduleOperatorVerifyReadyState("planning", "time-report")
            break
        case "support":
            engineController.setWorkspaceMode("setup")
            Qt.callLater(function() {
                Qt.callLater(function() {
                    if (root.setupWorkspacePanelRef && root.setupWorkspacePanelRef.openLegacySupportPanelsForVerify) {
                        root.setupWorkspacePanelRef.openLegacySupportPanelsForVerify()
                    }
                    root.scheduleOperatorVerifyReadyState("setup", "support")
                })
            })
            break
        case "setup-control-selected":
            engineController.setWorkspaceMode("setup")
            Qt.callLater(function() {
                Qt.callLater(function() {
                    if (root.setupWorkspacePanelRef && root.setupWorkspacePanelRef.resetVerifyState) {
                        root.setupWorkspacePanelRef.resetVerifyState()
                    }
                    root.applySetupControlSurfaceVerifySelection("projects", "proj-btn-7")
                    root.scheduleOperatorVerifyReadyState("setup", "setup-control-selected")
                })
            })
            break
        case "setup-control-dial-selected":
            engineController.setWorkspaceMode("setup")
            Qt.callLater(function() {
                Qt.callLater(function() {
                    if (root.setupWorkspacePanelRef && root.setupWorkspacePanelRef.resetVerifyState) {
                        root.setupWorkspacePanelRef.resetVerifyState()
                    }
                    root.applySetupControlSurfaceVerifySelection("projects", "proj-dial-1-press")
                    root.scheduleOperatorVerifyReadyState("setup", "setup-control-dial-selected")
                })
            })
            break
        case "setup-control-page-nav":
            engineController.setWorkspaceMode("setup")
            Qt.callLater(function() {
                Qt.callLater(function() {
                    if (root.setupWorkspacePanelRef && root.setupWorkspacePanelRef.resetVerifyState) {
                        root.setupWorkspacePanelRef.resetVerifyState()
                    }
                    root.applySetupControlSurfaceVerifySelection("projects", "proj-btn-4")
                    root.scheduleOperatorVerifyReadyState("setup", "setup-control-page-nav")
                })
            })
            break
        default:
            if (fixtureId === "planning-populated" || fixtureId === "planning-empty") {
                engineController.setWorkspaceMode("planning")
                root.scheduleOperatorVerifyReadyState("planning", "")
            } else if (fixtureId === "setup-required") {
                engineController.updateCommissioningStage("setup-required")
                Qt.callLater(function() {
                    Qt.callLater(function() {
                        root.scheduleOperatorVerifyReadyState("setup", "")
                    })
                })
            } else if (fixtureId === "setup-ready") {
                engineController.updateCommissioningStage("ready")
                engineController.setWorkspaceMode("setup")
                Qt.callLater(function() {
                    Qt.callLater(function() {
                        if (root.setupWorkspacePanelRef && root.setupWorkspacePanelRef.resetVerifyState) {
                            root.setupWorkspacePanelRef.resetVerifyState()
                        }
                        root.scheduleOperatorVerifyReadyState("setup", "")
                    })
                })
            } else {
                root.scheduleOperatorVerifyReadyState(engineController.workspaceMode, "")
            }
            break
        }
    }

    function dashboardSurfaceRequested() {
        return !!engineController
                && engineController.appSnapshotLoaded
                && engineController.startupTargetSurface === "dashboard"
    }

    function applySetupControlSurfaceVerifySelection(pageId, controlId) {
        root.controlSurfaceOverviewVerifyMode = false
        root.selectedControlSurfacePageId = pageId
        root.selectedControlSurfaceControlId = controlId
    }

    function applyRestoredWindowState(forceModeOnly) {
        if (!engineController || shellSmokeTest || parityCaptureMode || !engineController.windowSettingsLoaded) {
            return
        }

        suppressWindowStateSync = true
        if (!forceModeOnly) {
            root.width = engineController.windowWidth
            root.height = engineController.windowHeight
        }

        const nextWindowMode = root.restoredWindowMode()
        if (nextWindowMode === "fullscreen") {
            root.showFullScreen()
        } else if (nextWindowMode === "maximized") {
            root.showMaximized()
        } else {
            root.showNormal()
        }

        windowSettingsApplied = true
        Qt.callLater(function() {
            suppressWindowStateSync = false
        })
    }

    function windowModeLabel(windowMode) {
        switch (windowMode) {
        case "fullscreen":
            return "fullscreen"
        case "maximized":
            return "maximized"
        default:
            return "windowed"
        }
    }

    function workspaceLabel(workspaceMode) {
        switch (workspaceMode) {
        case "planning":
            return "Planning"
        case "lighting":
            return "Lighting"
        case "audio":
            return "Audio"
        case "setup":
            return "Setup"
        default:
            return "Planning"
        }
    }

    function workspaceSummary(workspaceMode) {
        switch (workspaceMode) {
        case "planning":
            return engineController && engineController.planningSnapshotLoaded
                   ? engineController.planningDetails
                   : "Planning snapshot is loading from the engine."
        case "lighting":
            return engineController && engineController.lightingSnapshotLoaded
                   ? engineController.lightingDetails
                   : "Lighting snapshot is loading from the engine."
        case "audio":
            return engineController && engineController.audioSnapshotLoaded
                   ? engineController.audioDetails
                   : "Audio snapshot is loading from the engine."
        case "setup":
            return engineController && engineController.commissioningSnapshotLoaded
                   ? engineController.commissioningDetails
                   : "Commissioning snapshot is loading from the engine."
        default:
            return "Dashboard content will be driven by engine-owned state."
        }
    }

    function hostPlatformLabel() {
        switch (Qt.platform.os) {
        case "windows":
            return "Windows 11 x64"
        case "osx":
            return "macOS Apple Silicon"
        default:
            return "this workstation"
        }
    }

    function hostInstallerArtifact() {
        switch (Qt.platform.os) {
        case "windows":
            return "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"
        case "osx":
            return "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"
        default:
            return "the platform-specific native installer"
        }
    }

    function hostUpdateArtifact() {
        switch (Qt.platform.os) {
        case "windows":
            return "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip"
        case "osx":
            return "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip"
        default:
            return "the platform-specific native update repository archive"
        }
    }

    function commissioningSummary(stage) {
        switch (stage) {
        case "setup-required":
            return "This workstation has not completed commissioning, so the shell keeps the operator on setup instead of opening the dashboard."
        case "in-progress":
            return "Commissioning is in progress. The shell remains in setup until the engine marks the workstation ready."
        case "ready":
            return "Commissioning reports ready. Future launches should route directly to the dashboard surface."
        default:
            return "Commissioning state is engine-owned and controls startup routing."
        }
    }

    function dashboardModuleSummary(workspaceMode) {
        switch (workspaceMode) {
        case "planning":
            return "Primary model: projects, tasks, activity, reports"
        case "lighting":
            return "Primary model: fixtures, groups, scenes, DMX state"
        case "audio":
            return "Primary model: channels, metering, snapshots, sync"
        case "setup":
            return "Primary model: commissioning status and support tools"
        default:
            return "Primary model: engine snapshot pending"
        }
    }

    function commissioningStatusLabel(status) {
        switch (status) {
        case "completed":
            return "Completed"
        case "passed":
            return "Passed"
        case "ready":
            return "Ready"
        case "in-progress":
            return "In Progress"
        case "attention":
            return "Needs Attention"
        case "failed":
            return "Failed"
        case "idle":
            return "Not tested"
        default:
            return root.formatEnumLabel(status)
        }
    }

    function commissioningStatusColor(status) {
        switch (status) {
        case "completed":
        case "passed":
            return "#34d399"
        case "ready":
            return "#60a5fa"
        case "in-progress":
            return "#f59e0b"
        case "attention":
        case "failed":
            return "#f87171"
        default:
            return "#9bb0c9"
        }
    }

    function commissioningCheckById(checkId) {
        if (!engineController || !engineController.commissioningSnapshotLoaded) {
            return null
        }

        for (let index = 0; index < engineController.commissioningChecks.length; index += 1) {
            const check = engineController.commissioningChecks[index]
            if (check.id === checkId) {
                return check
            }
        }

        return null
    }

    function formatEnumLabel(value) {
        if (!value || value.length === 0) {
            return "Unknown"
        }

        if (value === "todo") {
            return "To Do"
        }

        if (value === "in-progress") {
            return "In Progress"
        }

        const spaced = value.replace(/-/g, " ")
        return spaced.charAt(0).toUpperCase() + spaced.slice(1)
    }

    function formatSeconds(totalSeconds) {
        if (!totalSeconds || totalSeconds <= 0) {
            return "0m"
        }

        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)

        if (hours > 0 && minutes > 0) {
            return hours + "h " + minutes + "m"
        }

        if (hours > 0) {
            return hours + "h"
        }

        return minutes + "m"
    }

    function audioMixTargetById(mixTargetId) {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return null
        }

        for (let index = 0; index < engineController.audioMixTargets.length; index += 1) {
            const target = engineController.audioMixTargets[index]
            if (target.id === mixTargetId) {
                return target
            }
        }

        return null
    }

    function audioChannelById(channelId) {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return null
        }

        for (let index = 0; index < engineController.audioChannels.length; index += 1) {
            const channel = engineController.audioChannels[index]
            if (channel.id === channelId) {
                return channel
            }
        }

        return null
    }

    function audioChannelsByRole(role) {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return []
        }

        const channels = []
        for (let index = 0; index < engineController.audioChannels.length; index += 1) {
            const channel = engineController.audioChannels[index]
            if (channel.role === role) {
                channels.push(channel)
            }
        }

        return channels
    }

    function audioLiveChannelCount() {
        if (!engineController || !engineController.audioSnapshotLoaded || !engineController.audioOscEnabled) {
            return 0
        }

        let liveCount = 0
        for (let index = 0; index < engineController.audioChannels.length; index += 1) {
            const channel = engineController.audioChannels[index]
            if (channel.meterLevel && channel.meterLevel > 0.015) {
                liveCount += 1
            }
        }

        return liveCount
    }

    function audioPeakReturnStatus() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return "Pending"
        }

        if (!engineController.audioExpectedPeakData) {
            return "Optional"
        }

        switch (engineController.audioMeteringState) {
        case "live":
            return root.audioLiveChannelCount() + " live"
        case "stale":
            return "Stale"
        case "offline":
            return "Offline"
        case "disabled":
            return "OSC disabled"
        default:
            return "Check TotalMix"
        }
    }

    function audioInputCount() {
        return root.audioChannelsByRole("front-preamp").length + root.audioChannelsByRole("rear-line").length
    }

    function audioPlaybackCount() {
        return root.audioChannelsByRole("playback-pair").length
    }

    function audioOscStatusColor() {
        if (!engineController || !engineController.audioSnapshotLoaded || !engineController.audioOscEnabled) {
            return "#8ea4c0"
        }

        switch (engineController.audioMeteringState) {
        case "live":
            return "#6fd3a8"
        case "stale":
        case "awaiting-peak-data":
        case "transport-only":
            return "#f7d47c"
        default:
            return "#f7b4bc"
        }
    }

    function audioOscStatusLabel() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return "Audio snapshot pending"
        }

        if (!engineController.audioOscEnabled) {
            return "OSC disabled"
        }

        switch (engineController.audioMeteringState) {
        case "live":
            return "Meter return verified"
        case "stale":
            return "Meter return stale"
        case "awaiting-peak-data":
            return "Transport ready, awaiting peak data"
        case "transport-only":
            return "Transport ready, peak verification optional"
        case "offline":
            return "OSC offline"
        default:
            return root.audioMeteringLabel(engineController.audioMeteringState)
        }
    }

    function audioOscStatusDetail() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return "Audio workspace is still loading."
        }

        if (!engineController.audioOscEnabled) {
            return "OSC transport is disabled in audio settings."
        }

        switch (engineController.audioMeteringState) {
        case "live":
            return root.audioLiveChannelCount() + " channels returning live peak data"
        case "stale":
            return "Peak data stopped updating. Verify TotalMix peak return settings and transport health."
        case "awaiting-peak-data":
            return "Check TotalMix OSC: Send Peak Level Data."
        case "transport-only":
            return "Inbound peak verification is disabled for this console profile."
        case "offline":
            return "No active TotalMix transport detected."
        default:
            return engineController.audioDetails
        }
    }

    function audioConsoleStateColor() {
        return engineController && engineController.audioConsoleStateConfidence === "aligned" ? "#6fd3a8" : "#f7d47c"
    }

    function audioConsoleStateDetail() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return "Console state is waiting for the latest audio snapshot."
        }

        if (engineController.audioConsoleStateConfidence === "aligned") {
            return engineController.audioLastConsoleSyncAt.length > 0
                   ? "Last full push " + root.formatTimestamp(engineController.audioLastConsoleSyncAt)
                   : "Console state is aligned with the stored mix."
        }

        if (engineController.audioLastConsoleSyncReason === "snapshot") {
            return engineController.audioLastSnapshotRecallAt.length > 0
                   ? "A snapshot was recalled " + root.formatTimestamp(engineController.audioLastSnapshotRecallAt)
                     + ". Sync Console to reassert the stored mix."
                   : "A snapshot changed hardware outside this surface. Sync Console before trusting stored strip values."
        }

        return "Startup is transport-safe. This surface assumes hardware state until you intentionally sync."
    }

    function audioSnapshotWarningVisible() {
        return !!engineController
               && engineController.audioSnapshotLoaded
               && engineController.audioConsoleStateConfidence === "assumed"
               && engineController.audioLastConsoleSyncReason === "snapshot"
    }

    function lightingGroupOptions() {
        const options = [{ "id": "", "name": "Ungrouped" }]
        if (!engineController || !engineController.lightingSnapshotLoaded) {
            return options
        }

        for (let index = 0; index < engineController.lightingGroups.length; index += 1) {
            options.push(engineController.lightingGroups[index])
        }

        return options
    }

    function lightingGroupIndex(groupId, options) {
        const targetGroupId = groupId ? groupId : ""
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === targetGroupId) {
                return index
            }
        }

        return 0
    }

    function lightingGroupName(groupId) {
        if (!groupId) {
            return "Ungrouped"
        }

        if (!engineController || !engineController.lightingSnapshotLoaded) {
            return groupId
        }

        for (let index = 0; index < engineController.lightingGroups.length; index += 1) {
            const group = engineController.lightingGroups[index]
            if (group.id === groupId) {
                return group.name
            }
        }

        return groupId
    }

    function lightingFixtureTypeOptions() {
        return [
            { "id": "astra-bicolor", "name": "Litepanels Astra Bi-Color Soft", "channels": 2, "minCct": 3200, "maxCct": 5600 },
            { "id": "infinimat", "name": "Aputure Infinimat 2x4", "channels": 4, "minCct": 2000, "maxCct": 10000 },
            { "id": "infinibar-pb12", "name": "Aputure Infinibar PB12", "channels": 8, "minCct": 2000, "maxCct": 10000 }
        ]
    }

    function lightingFixtureTypeIndex(fixtureType, options) {
        const targetType = fixtureType ? fixtureType : "astra-bicolor"
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === targetType) {
                return index
            }
        }

        return 0
    }

    function lightingFixtureTypeName(fixtureType) {
        const options = root.lightingFixtureTypeOptions()
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === fixtureType) {
                return options[index].name
            }
        }

        return root.formatEnumLabel(fixtureType)
    }

    function lightingFixtureTypeChannels(fixtureType) {
        const options = root.lightingFixtureTypeOptions()
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === fixtureType) {
                return options[index].channels
            }
        }

        return 2
    }

    function lightingFixtureMaxStartAddress(fixtureType) {
        return 512 - root.lightingFixtureTypeChannels(fixtureType) + 1
    }

    function lightingFixtureMinCct(fixtureType) {
        const options = root.lightingFixtureTypeOptions()
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === fixtureType) {
                return options[index].minCct
            }
        }

        return 3200
    }

    function lightingFixtureMaxCct(fixtureType) {
        const options = root.lightingFixtureTypeOptions()
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === fixtureType) {
                return options[index].maxCct
            }
        }

        return 5600
    }

    function lightingEffectOptions() {
        return [
            { "id": "pulse", "name": "Pulse" },
            { "id": "strobe", "name": "Strobe" },
            { "id": "candle", "name": "Candle" }
        ]
    }

    function lightingEffectName(effect) {
        if (!effect || !effect.type) {
            return "No FX"
        }

        const options = root.lightingEffectOptions()
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === effect.type) {
                return options[index].name
            }
        }

        return root.formatEnumLabel(effect.type)
    }

    function lightingSceneOptions() {
        const options = [{ "id": "", "name": "No scene focus" }]
        if (!engineController || !engineController.lightingSnapshotLoaded) {
            return options
        }

        for (let index = 0; index < engineController.lightingScenes.length; index += 1) {
            options.push(engineController.lightingScenes[index])
        }

        return options
    }

    function lightingSceneIndex(sceneId, options) {
        const targetSceneId = sceneId ? sceneId : ""
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === targetSceneId) {
                return index
            }
        }

        return 0
    }

    function lightingFixtureOptions() {
        const options = [{ "id": "", "name": "No selection" }]
        if (!engineController || !engineController.lightingSnapshotLoaded) {
            return options
        }

        for (let index = 0; index < engineController.lightingFixtures.length; index += 1) {
            options.push(engineController.lightingFixtures[index])
        }

        return options
    }

    function lightingFixtureIndex(fixtureId, options) {
        const targetFixtureId = fixtureId ? fixtureId : ""
        for (let index = 0; index < options.length; index += 1) {
            if (options[index].id === targetFixtureId) {
                return index
            }
        }

        return 0
    }

    function lightingFixtureById(fixtureId) {
        if (!fixtureId || !engineController || !engineController.lightingSnapshotLoaded) {
            return null
        }

        for (let index = 0; index < engineController.lightingFixtures.length; index += 1) {
            const fixture = engineController.lightingFixtures[index]
            if (fixture.id === fixtureId) {
                return fixture
            }
        }

        return null
    }

    function lightingSpatialPercent(value, fallbackPercent) {
        if (value === undefined || value === null) {
            return fallbackPercent
        }

        return value * 100
    }

    function lightingSpatialRotation(value) {
        if (value === undefined || value === null) {
            return 0
        }

        return value
    }

    function lightingHasMarker(marker) {
        return !!marker && marker.x !== undefined && marker.x !== null && marker.y !== undefined && marker.y !== null
    }

    function lightingMarkerPercent(marker, axis, fallbackPercent) {
        if (!root.lightingHasMarker(marker)) {
            return fallbackPercent
        }

        const value = marker[axis]
        return value === undefined || value === null ? fallbackPercent : value * 100
    }

    function lightingMarkerRotation(marker) {
        if (!root.lightingHasMarker(marker)) {
            return 0
        }

        return marker.rotation === undefined || marker.rotation === null ? 0 : marker.rotation
    }

    function lightingFirstUnplacedFixtureId() {
        if (!engineController || !engineController.lightingSnapshotLoaded) {
            return ""
        }

        for (let index = 0; index < engineController.lightingFixtures.length; index += 1) {
            const fixture = engineController.lightingFixtures[index]
            if (fixture.spatialX === undefined || fixture.spatialX === null
                    || fixture.spatialY === undefined || fixture.spatialY === null) {
                return fixture.id
            }
        }

        return ""
    }

    function lightingMarkerPayload(markerKey, markerValue) {
        if (markerKey === "cameraMarker") {
            return { "cameraMarker": markerValue }
        }

        return { "subjectMarker": markerValue }
    }

    function audioChannelSendLevel(channel, mixTargetId) {
        if (!channel) {
            return 0
        }

        const mixLevels = channel.mixLevels || {}
        if (mixTargetId && mixLevels[mixTargetId] !== undefined) {
            return mixLevels[mixTargetId]
        }

        return channel.fader !== undefined ? channel.fader : 0
    }

    function audioLevelLabel(value) {
        if (value <= 0) {
            return "-inf"
        }

        return ((value - 0.75) * 60).toFixed(1) + " dB"
    }

    function audioRoleLabel(role) {
        switch (role) {
        case "front-preamp":
            return "Front Preamp"
        case "rear-line":
            return "Rear Line"
        case "playback-pair":
            return "Playback Pair"
        case "main-out":
            return "Main Out"
        case "phones-a":
            return "Phones 1"
        case "phones-b":
            return "Phones 2"
        default:
            return root.formatEnumLabel(role)
        }
    }

    function audioBusLabel(channel) {
        if (!channel) {
            return "Unknown bus"
        }

        return channel.role === "playback-pair" ? "Playback bus" : "Input bus"
    }

    function audioMixLabel(target) {
        if (!target) {
            return "Main Out"
        }

        switch (target.role) {
        case "main-out":
            return "Main Monitors"
        case "phones-a":
            return "Phones 1"
        case "phones-b":
            return "Phones 2"
        default:
            return target.name
        }
    }

    function audioMixOutputLabel(target) {
        if (!target) {
            return "Output 1/2"
        }

        switch (target.role) {
        case "main-out":
            return "Output 1/2"
        case "phones-a":
            return "Output 9/10"
        case "phones-b":
            return "Output 11/12"
        default:
            return "Output"
        }
    }

    function activeAudioSnapshot() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return null
        }

        if (engineController.audioLastRecalledSnapshotId.length > 0) {
            for (let index = 0; index < engineController.audioSnapshots.length; index += 1) {
                const snapshot = engineController.audioSnapshots[index]
                if (snapshot.id === engineController.audioLastRecalledSnapshotId) {
                    return snapshot
                }
            }
        }

        for (let index = 0; index < engineController.audioSnapshots.length; index += 1) {
            const snapshot = engineController.audioSnapshots[index]
            if (snapshot.lastRecalled) {
                return snapshot
            }
        }

        return null
    }

    function selectedAudioSendMatrix() {
        const channel = root.audioChannelById(root.selectedAudioChannelId)
        if (!channel || !engineController || !engineController.audioSnapshotLoaded) {
            return []
        }

        const entries = []
        for (let index = 0; index < engineController.audioMixTargets.length; index += 1) {
            const target = engineController.audioMixTargets[index]
            entries.push({
                "target": target,
                "level": root.audioChannelSendLevel(channel, target.id)
            })
        }

        return entries
    }

    function audioMeteringLabel(state) {
        switch (state) {
        case "live":
            return "Meter return verified"
        case "stale":
            return "Meter return stale"
        case "awaiting-peak-data":
            return "Awaiting peak data"
        case "transport-only":
            return "Transport ready"
        case "offline":
            return "OSC offline"
        case "disabled":
            return "OSC disabled"
        default:
            return root.formatEnumLabel(state)
        }
    }

    function audioMeterDb(value) {
        if (!value || value <= 0.0001) {
            return "-inf"
        }

        return (20 * Math.log(value) / Math.log(10)).toFixed(1) + " dB"
    }

    function audioConsoleStateLabel(confidence, reason) {
        if (confidence === "aligned") {
            return "Console aligned"
        }

        if (reason === "snapshot") {
            return "Snapshot changed hardware"
        }

        if (confidence === "assumed") {
            return "Console state assumed"
        }

        return "Console state pending"
    }

    function audioSettingsDirty() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return false
        }

        return audioOscEnabledDraft !== engineController.audioOscEnabled
               || audioSendHostDraft !== engineController.audioSendHost
               || audioSendPortDraft !== engineController.audioSendPort
               || audioReceivePortDraft !== engineController.audioReceivePort
               || audioExpectedPeakDataDraft !== engineController.audioExpectedPeakData
               || audioExpectedSubmixLockDraft !== engineController.audioExpectedSubmixLock
               || audioExpectedCompatibilityModeDraft !== engineController.audioExpectedCompatibilityMode
    }

    function audioChannelSupportsGain(channel) {
        return !!channel && channel.role === "front-preamp"
    }

    function audioChannelSupportsPhantom(channel) {
        return root.audioChannelSupportsGain(channel)
    }

    function audioChannelSupportsPad(channel) {
        return root.audioChannelSupportsGain(channel)
    }

    function audioChannelSupportsInstrument(channel) {
        return root.audioChannelSupportsGain(channel)
    }

    function audioChannelSupportsAutoSet(channel) {
        return root.audioChannelSupportsGain(channel)
    }

    function audioChannelSupportsPhase(channel) {
        return !!channel && channel.role !== "playback-pair"
    }

    function syncAudioSelection() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            root.selectedAudioChannelId = ""
            root.selectedAudioMixTargetId = ""
            return
        }

        root.selectedAudioChannelId = engineController.audioSelectedChannelId
        root.selectedAudioMixTargetId = engineController.audioSelectedMixTargetId
    }

    function syncAudioSettingsDrafts() {
        if (!engineController || !engineController.audioSnapshotLoaded) {
            return
        }

        root.audioOscEnabledDraft = engineController.audioOscEnabled
        root.audioSendHostDraft = engineController.audioSendHost
        root.audioSendPortDraft = engineController.audioSendPort
        root.audioReceivePortDraft = engineController.audioReceivePort
        root.audioExpectedPeakDataDraft = engineController.audioExpectedPeakData
        root.audioExpectedSubmixLockDraft = engineController.audioExpectedSubmixLock
        root.audioExpectedCompatibilityModeDraft = engineController.audioExpectedCompatibilityMode
    }

    function syncLightingSettingsDrafts() {
        if (!engineController || !engineController.lightingSnapshotLoaded) {
            return
        }

        root.lightingEnabledDraft = engineController.lightingEnabled
        root.lightingBridgeIpDraft = engineController.lightingBridgeIp
        root.lightingUniverseDraft = engineController.lightingUniverse
        root.lightingGrandMasterDraft = engineController.lightingGrandMaster
    }

    function checklistProgress(checklist) {
        if (!checklist || checklist.length === 0) {
            return "No checklist"
        }

        let completedCount = 0
        for (let index = 0; index < checklist.length; index += 1) {
            if (checklist[index].done) {
                completedCount += 1
            }
        }

        return completedCount + "/" + checklist.length + " checklist complete"
    }

    function formatTimestamp(timestamp) {
        if (!timestamp || timestamp.length === 0) {
            return "Unknown time"
        }

        return timestamp.slice(0, 16).replace("T", " ")
    }

    function formatUnixTimestamp(timestamp) {
        if (!timestamp || timestamp <= 0) {
            return "Unknown time"
        }

        const date = new Date(timestamp * 1000)
        return date.toISOString().slice(0, 16).replace("T", " ")
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes <= 0) {
            return "0 B"
        }

        if (bytes < 1024) {
            return bytes + " B"
        }
        if (bytes < 1024 * 1024) {
            return Math.round(bytes / 1024) + " KB"
        }

        return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    }

    function formatDueDate(dueDate) {
        if (!dueDate || dueDate.length === 0) {
            return ""
        }

        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const due = new Date(dueDate + "T00:00:00")
        const diffMs = due.getTime() - today.getTime()
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

        if (diffDays < 0) {
            return "Overdue " + dueDate
        }
        if (diffDays === 0) {
            return "Due today"
        }
        if (diffDays <= 3) {
            return "Due " + dueDate
        }

        return dueDate
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

    function projectTitle(projectId) {
        if (!engineController) {
            return projectId
        }

        const project = root.projectById(projectId)
        if (project) {
            return project.title
        }

        return projectId
    }

    function taskTitle(taskId) {
        if (!engineController) {
            return taskId
        }

        const task = root.taskById(taskId)
        if (task) {
            return task.title
        }

        return taskId
    }

    function projectById(projectId) {
        if (!engineController || !projectId || projectId.length === 0) {
            return null
        }

        for (let index = 0; index < engineController.planningProjects.length; index += 1) {
            const project = engineController.planningProjects[index]
            if (project.id === projectId) {
                return project
            }
        }

        return null
    }

    function taskById(taskId) {
        if (!engineController || !taskId || taskId.length === 0) {
            return null
        }

        for (let index = 0; index < engineController.planningTasks.length; index += 1) {
            const task = engineController.planningTasks[index]
            if (task.id === taskId) {
                return task
            }
        }

        return null
    }

    function labelsToCsv(labels) {
        if (!labels || labels.length === 0) {
            return ""
        }

        return labels.join(", ")
    }

    function tasksForProject(projectId) {
        const items = []
        if (!engineController || !projectId || projectId.length === 0) {
            return items
        }

        for (let index = 0; index < engineController.planningTasks.length; index += 1) {
            const task = engineController.planningTasks[index]
            if (task.projectId === projectId) {
                items.push(task)
            }
        }

        return items
    }

    function activityForProject(projectId) {
        const items = []
        if (!engineController || !projectId || projectId.length === 0) {
            return items
        }

        const taskIds = {}
        const tasks = root.tasksForProject(projectId)
        for (let index = 0; index < tasks.length; index += 1) {
            taskIds[tasks[index].id] = true
        }

        for (let index = 0; index < engineController.planningActivityLog.length; index += 1) {
            const entry = engineController.planningActivityLog[index]
            if (entry.entityId === projectId || taskIds[entry.entityId]) {
                items.push(entry)
            }
        }

        return items
    }

    function completedTaskCountForProject(projectId) {
        const tasks = root.tasksForProject(projectId)
        let count = 0
        for (let index = 0; index < tasks.length; index += 1) {
            if (tasks[index].completed) {
                count += 1
            }
        }

        return count
    }

    function totalSecondsForProject(projectId) {
        const tasks = root.tasksForProject(projectId)
        let total = 0
        for (let index = 0; index < tasks.length; index += 1) {
            total += tasks[index].totalSeconds
        }

        return total
    }

    function checklistTotalsForProject(projectId) {
        const tasks = root.tasksForProject(projectId)
        let done = 0
        let total = 0
        for (let index = 0; index < tasks.length; index += 1) {
            const checklist = tasks[index].checklist || []
            total += checklist.length
            for (let itemIndex = 0; itemIndex < checklist.length; itemIndex += 1) {
                if (checklist[itemIndex].done) {
                    done += 1
                }
            }
        }

        return { done: done, total: total }
    }

    function progressForProject(projectId) {
        const tasks = root.tasksForProject(projectId)
        if (tasks.length === 0) {
            return 0
        }

        return root.completedTaskCountForProject(projectId) / tasks.length
    }

    function syncPlanningDrafts() {
        const selectedProject = root.projectById(engineController ? engineController.planningSelectedProjectId : "")
        const selectedTask = root.taskById(engineController ? engineController.planningSelectedTaskId : "")
        root.selectedProjectTitleDraft = selectedProject ? selectedProject.title : ""
        root.selectedProjectDescriptionDraft = selectedProject ? selectedProject.description : ""
        root.selectedProjectPriorityDraft = selectedProject ? selectedProject.priority : "p2"
        root.selectedTaskTitleDraft = selectedTask ? selectedTask.title : ""
        root.selectedTaskDescriptionDraft = selectedTask ? selectedTask.description : ""
        root.selectedTaskPriorityDraft = selectedTask ? selectedTask.priority : "p2"
        root.selectedTaskDueDateDraft = selectedTask && selectedTask.dueDate ? selectedTask.dueDate : ""
        root.selectedTaskLabelsDraft = selectedTask ? root.labelsToCsv(selectedTask.labels) : ""
        root.selectedChecklistItemDraft = ""
    }

    function isSelectedProject(projectId) {
        return engineController && engineController.planningSelectedProjectId === projectId
    }

    function isSelectedTask(taskId) {
        return engineController && engineController.planningSelectedTaskId === taskId
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

    function inputFieldHasFocus() {
        const item = root.activeFocusItem
        return !!item && item.hasOwnProperty("cursorPosition")
    }

    function planningPriorityRank(priority) {
        return OperatorParityHelpers.planningPriorityRank(priority)
    }

    function planningProjectMatchesSearch(project) {
        return OperatorParityHelpers.planningProjectMatchesSearch(
            project,
            root.planningSearchQuery,
            root.tasksForProject(project.id)
        )
    }

    function filteredPlanningProjects() {
        if (!engineController || !engineController.planningSnapshotLoaded) {
            return []
        }

        return OperatorParityHelpers.filteredPlanningProjects(
            engineController.planningProjects,
            engineController.planningTasks,
            engineController.planningViewFilter,
            engineController.planningSortBy,
            root.planningSearchQuery
        )
    }

    function filteredPlanningProjectsForStatus(status) {
        if (!engineController || !engineController.planningSnapshotLoaded) {
            return []
        }

        return OperatorParityHelpers.filteredPlanningProjectsForStatus(
            engineController.planningProjects,
            engineController.planningTasks,
            engineController.planningViewFilter,
            engineController.planningSortBy,
            root.planningSearchQuery,
            status
        )
    }

    function planningResultCount() {
        if (!engineController || !engineController.planningSnapshotLoaded) {
            return 0
        }

        return OperatorParityHelpers.planningResultCount(
            engineController.planningProjects,
            engineController.planningTasks,
            engineController.planningViewFilter,
            engineController.planningSortBy,
            root.planningSearchQuery
        )
    }

    function focusPlanningSearch() {
        if (planningWorkspacePanelRef) {
            planningWorkspacePanelRef.focusSearch()
        }
    }

    function closeTransientPanels() {
        root.keyboardHelpVisible = false
        root.aboutDialogVisible = false
        root.planningTimeReportVisible = false
        root.planningProjectDetailVisible = false
    }

    function openPlanningCreateProject(defaultStatus) {
        if (planningWorkspacePanelRef && planningWorkspacePanelRef.openCreateProjectDialog) {
            planningWorkspacePanelRef.openCreateProjectDialog(defaultStatus ? defaultStatus : "todo")
        }
    }

    function openPlanningImportDialog() {
        if (planningWorkspacePanelRef && planningWorkspacePanelRef.openImportDialog) {
            planningWorkspacePanelRef.openImportDialog()
        }
    }

    function openPlanningProjectDetail(projectId) {
        if (!engineController || !projectId || projectId.length === 0) {
            return
        }

        engineController.selectPlanningProject(projectId)
        root.planningProjectDetailVisible = true
    }

    function selectAudioMixTarget(mixTargetId) {
        if (!engineController || !mixTargetId || mixTargetId.length === 0) {
            return
        }

        root.selectedAudioMixTargetId = mixTargetId
        engineController.updateAudioSettings({ "selectedMixTargetId": mixTargetId })
    }

    function focusAudioChannel(channelId) {
        if (!engineController || !channelId || channelId.length === 0) {
            return
        }

        root.selectedAudioChannelId = channelId
        engineController.updateAudioSettings({ "selectedChannelId": channelId })
    }

    function controlSurfacePageById(pageId) {
        if (!engineController || !engineController.controlSurfaceSnapshotLoaded) {
            return null
        }

        return OperatorParityHelpers.controlSurfacePageById(engineController.controlSurfacePages, pageId)
    }

    function controlSurfaceControlById(pageId, controlId) {
        if (!engineController || !engineController.controlSurfaceSnapshotLoaded) {
            return null
        }

        return OperatorParityHelpers.controlSurfaceControlById(
            engineController.controlSurfacePages,
            pageId,
            controlId
        )
    }

    function activitySummary(entry) {
        if (!entry) {
            return ""
        }

        const action = root.formatEnumLabel(entry.action)
        const entityType = root.formatEnumLabel(entry.entityType)
        return action + " " + entityType
    }

    function scheduleWindowStateSync() {
        if (shellSmokeTest || !engineController || !windowSettingsApplied || suppressWindowStateSync) {
            return
        }

        if (!engineController.operatorUiReady) {
            return
        }

        windowStateSyncTimer.restart()
    }

    onWidthChanged: scheduleWindowStateSync()
    onHeightChanged: scheduleWindowStateSync()
    onVisibilityChanged: scheduleWindowStateSync()

    Timer {
        id: windowStateSyncTimer
        interval: 350
        repeat: false
        onTriggered: {
            if (!engineController || !engineController.operatorUiReady) {
                return
            }

            engineController.syncWindowState(
                Math.round(root.width),
                Math.round(root.height),
                root.currentWindowMode()
            )
        }
    }

    Component {
        id: commissioningSurfaceComponent

        Item {
            anchors.fill: parent

            ColumnLayout {
                anchors.fill: parent
                spacing: 12

                Label {
                    text: "Commissioning Surface"
                    color: "#ffffff"
                    font.pixelSize: 22
                    font.weight: Font.DemiBold
                }

                Label {
                    text: root.commissioningSummary(engineController.commissioningStage)
                    color: "#d6dce5"
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                GridLayout {
                    Layout.fillWidth: true
                    columns: root.width >= 1100 ? 2 : 1
                    columnSpacing: 12
                    rowSpacing: 12

                    Rectangle {
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 164

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label {
                                text: "Commissioning Gate"
                                color: "#8ea4c0"
                                font.pixelSize: 12
                            }

                            Label {
                                text: engineController.commissioningStage
                                color: "#f5f7fb"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }

                            Label {
                                text: "Dashboard remains blocked until the engine marks setup complete."
                                color: "#b4c0cf"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            Flow {
                                Layout.fillWidth: true
                                spacing: 6

                                Repeater {
                                    model: ["setup-required", "in-progress", "ready"]

                                    Button {
                                        required property string modelData
                                        text: modelData === "ready" ? "Mark Ready" : root.formatEnumLabel(modelData)
                                        highlighted: engineController.commissioningStage === modelData
                                        onClicked: engineController.updateCommissioningStage(modelData)
                                    }
                                }
                            }
                        }
                    }

                    Rectangle {
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 164

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label {
                                text: "Hardware Profile"
                                color: "#8ea4c0"
                                font.pixelSize: 12
                            }

                            Label {
                                text: engineController.hardwareProfile
                                color: "#f5f7fb"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }

                            Label {
                                text: "Adapter configuration and commissioning checks will attach to this engine-owned profile."
                                color: "#b4c0cf"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 8

                                TextField {
                                    Layout.fillWidth: true
                                    text: root.commissioningHardwareProfileDraft
                                    placeholderText: "Hardware profile id"
                                    onTextChanged: root.commissioningHardwareProfileDraft = text
                                }

                                Button {
                                    text: "Save"
                                    enabled: root.commissioningHardwareProfileDraft.trim().length > 0
                                    onClicked: engineController.updateHardwareProfile(root.commissioningHardwareProfileDraft)
                                }
                            }
                        }
                    }

                    Rectangle {
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 220

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label {
                                text: "Commissioning Workstreams"
                                color: "#8ea4c0"
                                font.pixelSize: 12
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 6

                                Repeater {
                                    model: engineController.commissioningSteps

                                    Rectangle {
                                        required property var modelData
                                        radius: 10
                                        color: "#101826"
                                        border.color: "#24344a"
                                        border.width: 1
                                        Layout.fillWidth: true
                                        implicitHeight: 56

                                        ColumnLayout {
                                            anchors.fill: parent
                                            anchors.margins: 10
                                            spacing: 2

                                            RowLayout {
                                                Layout.fillWidth: true

                                                Label {
                                                    text: modelData.label
                                                    color: "#f5f7fb"
                                                    font.pixelSize: 12
                                                    font.weight: Font.DemiBold
                                                    Layout.fillWidth: true
                                                }

                                                Label {
                                                    text: root.commissioningStatusLabel(modelData.status)
                                                    color: root.commissioningStatusColor(modelData.status)
                                                    font.pixelSize: 11
                                                    font.weight: Font.DemiBold
                                                }
                                            }

                                            Label {
                                                text: modelData.summary
                                                color: "#b4c0cf"
                                                wrapMode: Text.WordWrap
                                                font.pixelSize: 11
                                                Layout.fillWidth: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Rectangle {
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 128

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label {
                                text: "Persisted Dashboard Landing"
                                color: "#8ea4c0"
                                font.pixelSize: 12
                            }

                            Label {
                                text: root.workspaceLabel(engineController.workspaceMode)
                                color: "#f5f7fb"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }

                            Label {
                                text: "When commissioning completes, the shell will route to the dashboard and restore this workspace first."
                                color: "#b4c0cf"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            Flow {
                                Layout.fillWidth: true
                                spacing: 6

                                Repeater {
                                    model: ["planning", "lighting", "audio", "setup"]

                                    Button {
                                        required property string modelData
                                        text: root.workspaceLabel(modelData)
                                        highlighted: engineController.workspaceMode === modelData
                                        onClicked: engineController.setWorkspaceMode(modelData)
                                    }
                                }
                            }
                        }
                    }
                }

                GridLayout {
                    Layout.fillWidth: true
                    columns: root.width >= 1250 ? 3 : 1
                    columnSpacing: 12
                    rowSpacing: 12

                    Rectangle {
                        id: controlSurfaceProbeCard
                        property var probeState: root.commissioningCheckById("control-surface")
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 176

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label { text: "Control Surface Probe"; color: "#8ea4c0"; font.pixelSize: 12 }
                            Label {
                                text: controlSurfaceProbeCard.probeState ? root.commissioningStatusLabel(controlSurfaceProbeCard.probeState.status) : "Idle"
                                color: controlSurfaceProbeCard.probeState ? root.commissioningStatusColor(controlSurfaceProbeCard.probeState.status) : "#9bb0c9"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }
                            Label {
                                text: controlSurfaceProbeCard.probeState
                                      ? controlSurfaceProbeCard.probeState.message
                                      : (engineController.controlSurfaceBaseUrl.length > 0
                                         ? "Run a native probe against the deck-facing planning context served at "
                                           + engineController.controlSurfaceBaseUrl + "."
                                         : "Run a native probe against the deck-facing planning context.")
                                color: "#b4c0cf"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                            Button {
                                text: "Run Probe"
                                onClicked: engineController.runControlSurfaceProbe()
                            }
                        }
                    }

                    Rectangle {
                        id: lightingProbeCard
                        property var probeState: root.commissioningCheckById("lighting")
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 176

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label { text: "Lighting Bridge Probe"; color: "#8ea4c0"; font.pixelSize: 12 }
                            Label {
                                text: lightingProbeCard.probeState ? root.commissioningStatusLabel(lightingProbeCard.probeState.status) : "Idle"
                                color: lightingProbeCard.probeState ? root.commissioningStatusColor(lightingProbeCard.probeState.status) : "#9bb0c9"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 8

                                TextField {
                                    Layout.fillWidth: true
                                    text: root.commissioningLightingBridgeIpDraft
                                    placeholderText: "Bridge IP"
                                    onTextChanged: root.commissioningLightingBridgeIpDraft = text
                                }

                                SpinBox {
                                    from: 1
                                    to: 63999
                                    value: root.commissioningLightingUniverseDraft
                                    editable: true
                                    onValueModified: root.commissioningLightingUniverseDraft = value
                                }
                            }

                            Label {
                                text: lightingProbeCard.probeState ? lightingProbeCard.probeState.message : "Validate the configured Apollo Bridge address before DMX adapter work lands."
                                color: "#b4c0cf"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            Button {
                                text: "Run Lighting Probe"
                                enabled: root.commissioningLightingBridgeIpDraft.trim().length > 0
                                onClicked: engineController.runLightingProbe(
                                               root.commissioningLightingBridgeIpDraft,
                                               root.commissioningLightingUniverseDraft
                                           )
                            }
                        }
                    }

                    Rectangle {
                        id: audioProbeCard
                        property var probeState: root.commissioningCheckById("audio")
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        Layout.preferredHeight: 176

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label { text: "Audio OSC Probe"; color: "#8ea4c0"; font.pixelSize: 12 }
                            Label {
                                text: audioProbeCard.probeState ? root.commissioningStatusLabel(audioProbeCard.probeState.status) : "Idle"
                                color: audioProbeCard.probeState ? root.commissioningStatusColor(audioProbeCard.probeState.status) : "#9bb0c9"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }

                            TextField {
                                Layout.fillWidth: true
                                text: root.commissioningAudioSendHostDraft
                                placeholderText: "OSC send host"
                                onTextChanged: root.commissioningAudioSendHostDraft = text
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 8

                                SpinBox {
                                    from: 1
                                    to: 65535
                                    value: root.commissioningAudioSendPortDraft
                                    editable: true
                                    onValueModified: root.commissioningAudioSendPortDraft = value
                                }

                                SpinBox {
                                    from: 1
                                    to: 65535
                                    value: root.commissioningAudioReceivePortDraft
                                    editable: true
                                    onValueModified: root.commissioningAudioReceivePortDraft = value
                                }
                            }

                            Label {
                                text: audioProbeCard.probeState ? audioProbeCard.probeState.message : "Validate OSC transport settings before the native audio adapter owns live console sync."
                                color: "#b4c0cf"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            Button {
                                text: "Run Audio Probe"
                                enabled: root.commissioningAudioSendHostDraft.trim().length > 0
                                onClicked: engineController.runAudioProbe(
                                               root.commissioningAudioSendHostDraft,
                                               root.commissioningAudioSendPortDraft,
                                               root.commissioningAudioReceivePortDraft
                                           )
                            }
                        }
                    }

                    Rectangle {
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        implicitHeight: 132

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label { text: "Sample Planning Data"; color: "#8ea4c0"; font.pixelSize: 12 }
                            Label {
                                text: engineController.commissioningPlanningProjectCount > 0
                                      ? engineController.commissioningPlanningProjectCount + " projects and "
                                        + engineController.commissioningPlanningTaskCount
                                        + " tasks are already present in native storage."
                                      : "Load the bundled native planning sample to make the dashboard useful immediately after commissioning."
                                color: "#d6dce5"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                            RowLayout {
                                spacing: 8

                                Button {
                                    text: engineController.commissioningPlanningProjectCount > 0 ? "Replace Sample Data" : "Load Sample Data"
                                    onClicked: engineController.seedCommissioningSamplePlanning(
                                                   engineController.commissioningPlanningProjectCount > 0
                                               )
                                }

                                Label {
                                    text: engineController.commissioningDetails
                                    color: "#8ea4c0"
                                    font.pixelSize: 11
                                    wrapMode: Text.WordWrap
                                }
                            }
                        }
                    }

                    Rectangle {
                        radius: 14
                        color: "#0c1320"
                        border.color: "#35506b"
                        border.width: 1
                        Layout.fillWidth: true
                        implicitHeight: 168

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 6

                            Label { text: "Companion Export"; color: "#8ea4c0"; font.pixelSize: 12 }
                            Label {
                                text: engineController.controlSurfaceAvailable ? "Ready" : "Unavailable"
                                color: engineController.controlSurfaceAvailable ? "#6fd3a4" : "#ff9a7d"
                                font.pixelSize: 18
                                font.weight: Font.DemiBold
                            }
                            Label {
                                text: engineController.controlSurfaceDetails
                                color: "#d6dce5"
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                            Label {
                                text: engineController.controlSurfaceBaseUrl.length > 0
                                      ? "Generic HTTP base URL: " + engineController.controlSurfaceBaseUrl
                                      : "No native control-surface bridge URL is available yet."
                                color: "#8ea4c0"
                                font.pixelSize: 11
                                wrapMode: Text.WrapAnywhere
                                Layout.fillWidth: true
                            }

                            RowLayout {
                                spacing: 8

                                Button {
                                    text: "Export Companion Profile"
                                    enabled: engineController.controlSurfaceAvailable
                                    onClicked: engineController.exportCompanionConfig()
                                }

                                Button {
                                    text: "Open App Data"
                                    onClicked: engineController.openAppDataDirectory()
                                }
                            }

                            Label {
                                text: engineController.companionExportPath.length > 0
                                      ? "Latest export: " + engineController.companionExportPath
                                      : "No native Companion profile has been exported yet."
                                color: "#8ea4c0"
                                font.pixelSize: 11
                                wrapMode: Text.WrapAnywhere
                                Layout.fillWidth: true
                            }
                        }
                    }
                }
            }
        }
    }

    Component {
        id: setupWizardSurfaceComponent

        Item {
            anchors.fill: parent

            Item {
                id: setupWizardBackdropSurface
                anchors.fill: parent
                opacity: 0.6

                DashboardHeaderPanel {
                    anchors.top: parent.top
                    anchors.left: parent.left
                    anchors.right: parent.right
                    rootWindow: root
                    engineController: root.engineController
                    scaleFactor: root.dashboardUiScale
                    enabled: false
                }

                PlanningWorkspacePanel {
                    anchors.top: parent.top
                    anchors.topMargin: 126
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    rootWindow: root
                    engineController: root.engineController
                    enabled: false
                }
            }

            SetupWizardOverlay {
                anchors.fill: parent
                rootWindow: root
                engineController: root.engineController
                backdropSourceItem: setupWizardBackdropSurface
            }
        }
    }

    Component {
        id: dashboardSurfaceComponent

        Item {
            anchors.fill: parent

            DashboardHeaderPanel {
                id: dashboardHeaderPanel
                anchors.top: parent.top
                anchors.left: parent.left
                anchors.right: parent.right
                rootWindow: root
                engineController: root.engineController
                scaleFactor: root.dashboardUiScale
                visible: !root.engineController || root.engineController.workspaceMode !== "setup"
            }

            StackLayout {
                anchors.top: dashboardHeaderPanel.visible ? dashboardHeaderPanel.bottom : parent.top
                anchors.topMargin: dashboardHeaderPanel.visible ? 12 : 0
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                currentIndex: root.activeWorkspaceIndex()

                PlanningWorkspacePanel {
                    id: planningWorkspacePanel
                    rootWindow: root
                    engineController: root.engineController
                    Component.onCompleted: root.planningWorkspacePanelRef = planningWorkspacePanel
                    Component.onDestruction: {
                        if (root.planningWorkspacePanelRef === planningWorkspacePanel) {
                            root.planningWorkspacePanelRef = null
                        }
                    }
                }

                LightingWorkspacePanel {
                    id: lightingWorkspacePanel
                    rootWindow: root
                    engineController: root.engineController
                    scaleFactor: root.dashboardUiScale
                    parityFrozen: root.parityCaptureMode
                    Component.onCompleted: root.lightingWorkspacePanelRef = lightingWorkspacePanel
                    Component.onDestruction: {
                        if (root.lightingWorkspacePanelRef === lightingWorkspacePanel) {
                            root.lightingWorkspacePanelRef = null
                        }
                    }
                }

                AudioWorkspacePanel {
                    rootWindow: root
                    engineController: root.engineController
                    scaleFactor: root.dashboardUiScale
                }

                SetupWorkspacePanel {
                    id: setupWorkspacePanel
                    rootWindow: root
                    engineController: root.engineController
                    scaleFactor: root.dashboardUiScale
                    Component.onCompleted: root.setupWorkspacePanelRef = setupWorkspacePanel
                    Component.onDestruction: {
                        if (root.setupWorkspacePanelRef === setupWorkspacePanel) {
                            root.setupWorkspacePanelRef = null
                        }
                    }
                }

                ConsoleSurface {
                    objectName: "workspace-fallback-panel"
                    tone: "soft"
                    padding: 20

                    ColumnLayout {
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.margins: 4
                        spacing: theme.spacing4

                        Label {
                            text: "Unknown workspace"
                            color: theme.studio050
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textLg
                            font.weight: Font.DemiBold
                        }

                        Label {
                            text: "The engine reported a workspace mode the operator surface does not know how to render. Return to Planning to recover."
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        ConsoleButton {
                            tone: "primary"
                            text: "Return to Planning"
                            onClicked: {
                                if (engineController) {
                                    engineController.setWorkspaceMode("planning")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Connections {
        target: engineController

        function onPlanningSnapshotChanged() {
            root.syncPlanningDrafts()
            if (root.planningProjectDetailVisible && !root.projectById(engineController.planningSelectedProjectId)) {
                root.planningProjectDetailVisible = false
            }
            if (root.pendingOperatorVerifyNeedsPlanningSnapshot()) {
                root.tryFinalizeOperatorVerifyFixture()
            }
        }

        function onAppSnapshotChanged() {
            if (!engineController || !engineController.appSnapshotLoaded) {
                return
            }

            root.commissioningHardwareProfileDraft = engineController.hardwareProfile

            if (root.dashboardSurfaceRequested() && root.visibility !== Window.FullScreen) {
                root.applyRestoredWindowState(true)
            }

            if (!root.pendingOperatorVerifyNeedsPlanningSnapshot()
                    && !root.pendingOperatorVerifyNeedsLightingSnapshot()
                    && !root.pendingOperatorVerifyNeedsAudioSnapshot()) {
                root.tryFinalizeOperatorVerifyFixture()
            }
        }

        function onControlSurfaceSnapshotChanged() {
            if (!engineController || !engineController.controlSurfaceSnapshotLoaded) {
                return
            }

            if (!root.selectedControlSurfacePageId.length && engineController.controlSurfacePages.length > 0) {
                root.selectedControlSurfacePageId = engineController.controlSurfacePages[0].id
            }

            const page = root.controlSurfacePageById(root.selectedControlSurfacePageId)
            const controls = OperatorParityHelpers.controlSurfacePageControls(page)
            if (!root.controlSurfaceOverviewVerifyMode
                    && (!root.selectedControlSurfaceControlId.length || !root.controlSurfaceControlById(root.selectedControlSurfacePageId, root.selectedControlSurfaceControlId))
                    && controls.length > 0) {
                root.selectedControlSurfaceControlId = controls[0].id
            }
        }

        function onCommissioningSnapshotChanged() {
            if (!engineController || !engineController.commissioningSnapshotLoaded) {
                return
            }

            root.commissioningLightingBridgeIpDraft = engineController.commissioningLightingBridgeIp
            root.commissioningLightingUniverseDraft = engineController.commissioningLightingUniverse
            root.commissioningAudioSendHostDraft = engineController.commissioningAudioSendHost
            root.commissioningAudioSendPortDraft = engineController.commissioningAudioSendPort
            root.commissioningAudioReceivePortDraft = engineController.commissioningAudioReceivePort
        }

        function onLightingSnapshotChanged() {
            root.syncLightingSettingsDrafts()
            if (root.pendingOperatorVerifyNeedsLightingSnapshot()) {
                root.tryFinalizeOperatorVerifyFixture()
            }
        }

        function onAudioSnapshotChanged() {
            root.syncAudioSelection()
            root.syncAudioSettingsDrafts()
            if (root.pendingOperatorVerifyNeedsAudioSnapshot()) {
                root.tryFinalizeOperatorVerifyFixture()
            }
        }

        function onSettingsChanged() {
            if (!engineController || shellSmokeTest || windowSettingsApplied || !engineController.windowSettingsLoaded) {
                return
            }

            root.applyRestoredWindowState(false)
        }

        function onOperatorUiReadyChanged() {
            root.maybeRunOperatorVerifyAction()
        }
    }

    Component.onCompleted: root.maybeRunOperatorVerifyAction()

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#181821" }
            GradientStop { position: 0.4; color: "#121218" }
            GradientStop { position: 1.0; color: "#0a0a0f" }
        }
    }

    Loader {
        id: operatorSurfaceLoader
        anchors.fill: parent
        anchors.margins: 16
        visible: !!engineController && engineController.operatorUiReady
        active: visible
        sourceComponent: operatorSurfaceTarget === "dashboard"
                         ? dashboardSurfaceComponent
                         : setupWizardSurfaceComponent
        onLoaded: {
            if (item) {
                item.width = width
                item.height = height
            }
        }
        onWidthChanged: {
            if (item) {
                item.width = width
            }
        }
        onHeightChanged: {
            if (item) {
                item.height = height
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: !!engineController
                 && engineController.operatorUiReady
                 && !shellSmokeTest
                 && operatorSurfaceTarget !== "dashboard"
                 && operatorSurfaceTarget !== "commissioning"

        RowLayout {
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.topMargin: 18
            anchors.rightMargin: 18
            spacing: 8
            z: 20

            ConsoleBadge {
                text: operatorSurfaceTarget === "dashboard" ? "Operator Surface" : "Setup Surface"
                badgeColor: operatorSurfaceTarget === "dashboard" ? theme.accentGreen : theme.accentAmber
                textColor: operatorSurfaceTarget === "dashboard" ? theme.accentGreen : theme.accentAmber
            }

            ConsoleButton {
                text: "Runtime / Recovery"
                tone: "secondary"
                onClicked: root.runtimeSupportVisible = true
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: !engineController || !engineController.operatorUiReady

        ConsoleSurface {
            anchors.centerIn: parent
            width: Math.min(root.width - 48, 860)
            tone: "strong"
            padding: 18

            ColumnLayout {
                anchors.fill: parent
                spacing: 14

                Label {
                    text: engineController && engineController.stateLabel === "Failed"
                          ? "Startup needs recovery before the operator surface can open."
                          : "The operator surface unlocks only after healthy startup and an engine-owned app snapshot."
                    color: theme.studio050
                    font.family: theme.uiFontFamily
                    font.pixelSize: 28
                    font.weight: Font.DemiBold
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                Label {
                    text: engineController ? engineController.message : "Waiting for the native engine controller."
                    color: theme.studio300
                    font.family: theme.uiFontFamily
                    font.pixelSize: theme.textSm
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                ConsoleSurface {
                    Layout.fillWidth: true
                    tone: "soft"
                    padding: 14

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 10

                        Label {
                            text: "Startup State"
                            color: theme.studio500
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.capitalization: Font.AllUppercase
                            font.letterSpacing: 1.0
                        }

                        Label {
                            text: engineController ? engineController.stateLabel : "Starting"
                            color: theme.studio050
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXl
                            font.weight: Font.DemiBold
                        }

                        Label {
                            text: "Startup: " + (engineController ? engineController.startupPhaseLabel : "Pending")
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                        }

                        Label {
                            text: "Health: " + (engineController ? engineController.healthStatus : "starting")
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                        }

                        Label {
                            text: "App snapshot: " + (engineController ? engineController.appSnapshotDetails : "pending")
                            color: theme.studio400
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXs
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }
                    }
                }

                Label {
                    text: engineController ? engineController.healthDetails : ""
                    color: theme.studio400
                    font.family: theme.uiFontFamily
                    font.pixelSize: theme.textSm
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    ConsoleButton {
                        tone: "primary"
                        text: engineController && engineController.canRetry ? "Retry Startup" : "Start Engine"
                        enabled: !!engineController
                        onClicked: {
                            if (engineController.canRetry) {
                                engineController.retryStart()
                            } else {
                                engineController.start()
                            }
                        }
                    }

                    ConsoleButton {
                        tone: "secondary"
                        text: "Open Diagnostics"
                        enabled: !!engineController
                        onClicked: engineController.openDiagnosticsDirectory()
                    }

                    ConsoleButton {
                        tone: "secondary"
                        text: "Runtime / Recovery"
                        enabled: !!engineController
                        onClicked: root.runtimeSupportVisible = true
                    }
                }
            }
        }
    }

    ConsoleModal {
        open: root.runtimeSupportVisible && !!engineController
        title: "Runtime / Recovery"
        subtitle: "Diagnostics, lifecycle controls, and restored shell state stay available without taking over the operator surface."
        dialogWidth: 1000
        dialogHeight: root.height - 72
        onCloseRequested: root.runtimeSupportVisible = false

        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            ColumnLayout {
                width: parent.width
                spacing: 12

                ConsoleSurface {
                    Layout.fillWidth: true
                    tone: "soft"
                    padding: 14

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 8

                        Label {
                            text: "Engine State"
                            color: theme.studio500
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.capitalization: Font.AllUppercase
                            font.letterSpacing: 1.0
                        }

                        Label {
                            text: engineController.stateLabel
                            color: theme.studio050
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXl
                            font.weight: Font.DemiBold
                        }

                        Label {
                            text: engineController.message
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8

                            ConsoleButton {
                                visible: !shellSmokeTest
                                text: "Start"
                                tone: "secondary"
                                onClicked: engineController.start()
                            }

                            ConsoleButton {
                                visible: !shellSmokeTest
                                text: "Ping"
                                tone: "secondary"
                                onClicked: engineController.ping()
                            }

                            ConsoleButton {
                                visible: !shellSmokeTest
                                text: "Health"
                                tone: "secondary"
                                onClicked: engineController.requestHealthSnapshot()
                            }

                            ConsoleButton {
                                visible: !shellSmokeTest
                                text: "App Snapshot"
                                tone: "secondary"
                                onClicked: engineController.requestSettings()
                            }

                            ConsoleButton {
                                visible: !shellSmokeTest
                                text: "Stop"
                                tone: "secondary"
                                onClicked: engineController.stop()
                            }
                        }
                    }
                }

                ConsoleSurface {
                    Layout.fillWidth: true
                    tone: "soft"
                    padding: 14

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 8

                        Label {
                            text: "Recovery"
                            color: theme.studio500
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.capitalization: Font.AllUppercase
                            font.letterSpacing: 1.0
                        }

                        Label {
                            text: engineController.healthDetails
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        Label {
                            text: "Diagnostics path: " + engineController.diagnosticsPath
                            color: theme.studio400
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            wrapMode: Text.WrapAnywhere
                            Layout.fillWidth: true
                        }

                        Label {
                            text: "App data path: " + engineController.appDataPath
                            color: theme.studio400
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            wrapMode: Text.WrapAnywhere
                            Layout.fillWidth: true
                        }

                        Label {
                            text: "Logs path: " + engineController.logsPath
                            color: theme.studio400
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            wrapMode: Text.WrapAnywhere
                            Layout.fillWidth: true
                        }

                        Label {
                            visible: engineController.lastError.length > 0
                            text: "Last error: " + engineController.lastError
                            color: theme.accentRed
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXs
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8

                            ConsoleButton {
                                text: "Retry Startup"
                                tone: "primary"
                                enabled: engineController.canRetry
                                onClicked: engineController.retryStart()
                            }

                            ConsoleButton {
                                text: "Open Diagnostics"
                                tone: "secondary"
                                onClicked: engineController.openDiagnosticsDirectory()
                            }

                            ConsoleButton {
                                text: "Open Logs"
                                tone: "secondary"
                                onClicked: engineController.openLogsDirectory()
                            }

                            ConsoleButton {
                                text: "Open Engine Log"
                                tone: "secondary"
                                onClicked: engineController.openEngineLogFile()
                            }

                            ConsoleButton {
                                text: "Export Diagnostics"
                                tone: "secondary"
                                onClicked: engineController.exportShellDiagnostics()
                            }
                        }
                    }
                }

                ConsoleSurface {
                    Layout.fillWidth: true
                    tone: "soft"
                    padding: 14

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 8

                        Label {
                            text: "Recent Engine Log"
                            color: theme.studio500
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.capitalization: Font.AllUppercase
                            font.letterSpacing: 1.0
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 140
                            radius: theme.radiusCard
                            color: theme.surfaceDefault
                            border.width: 1
                            border.color: theme.surfaceBorder

                            ScrollView {
                                anchors.fill: parent
                                anchors.margins: 8
                                clip: true

                                TextEdit {
                                    readOnly: true
                                    text: engineController.recentLogExcerpt
                                    color: theme.studio200
                                    font.family: theme.monoFontFamily
                                    font.pixelSize: theme.textXs
                                    wrapMode: TextEdit.Wrap
                                    selectByMouse: true
                                    textFormat: TextEdit.PlainText
                                    width: parent ? parent.width : 0
                                }
                            }
                        }
                    }
                }

                ConsoleSurface {
                    Layout.fillWidth: true
                    tone: "soft"
                    padding: 14

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 8

                        Label {
                            text: "Restored Shell State"
                            color: theme.studio500
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.capitalization: Font.AllUppercase
                            font.letterSpacing: 1.0
                        }

                        Label {
                            text: "Persisted workspace: " + root.workspaceLabel(engineController.workspaceMode)
                            color: theme.studio050
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textMd
                            font.weight: Font.DemiBold
                        }

                        Label {
                            text: "Persisted window: " + engineController.windowWidth + " x " + engineController.windowHeight + " (" + root.windowModeLabel(engineController.windowMode) + ")"
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        RowLayout {
                            spacing: 8

                            ConsoleButton {
                                text: "Planning"
                                tone: "secondary"
                                onClicked: engineController.setWorkspaceMode("planning")
                            }

                            ConsoleButton {
                                text: "Lighting"
                                tone: "secondary"
                                onClicked: engineController.setWorkspaceMode("lighting")
                            }

                            ConsoleButton {
                                text: "Audio"
                                tone: "secondary"
                                onClicked: engineController.setWorkspaceMode("audio")
                            }

                            ConsoleButton {
                                text: "Setup"
                                tone: "secondary"
                                onClicked: engineController.setWorkspaceMode("setup")
                            }
                        }
                    }
                }
            }
        }
    }

    PlanningProjectDetailDialog {
        rootWindow: root
        engineController: root.engineController
        open: root.planningProjectDetailVisible
    }

    DashboardAboutDialog {
        rootWindow: root
        engineController: root.engineController
        open: root.aboutDialogVisible
    }

    OperatorShortcutsDialog {
        rootWindow: root
        engineController: root.engineController
        open: root.keyboardHelpVisible
    }

    Item {
        id: shortcutFallbackField
        visible: false
        width: 0
        height: 0
    }

    OperatorShortcutLayer {
        rootWindow: root
        engineController: root.engineController
        newProjectTitleField: root.planningWorkspacePanelRef ? root.planningWorkspacePanelRef.newProjectTitleField : shortcutFallbackField
    }
}
