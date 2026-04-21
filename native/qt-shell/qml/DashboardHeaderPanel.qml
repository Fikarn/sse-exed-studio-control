import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import QtQml

Rectangle {
    id: root
    objectName: "dashboard-header-panel"
    required property var rootWindow
    required property QtObject engineController
    property real scaleFactor: 1.0

    readonly property bool controllerReady: !!engineController
    readonly property string liveWorkspaceMode: controllerReady ? engineController.workspaceMode : "planning"
    readonly property string liveHealthStatus: controllerReady ? engineController.healthStatus : "starting"
    readonly property string liveStateLabel: controllerReady ? engineController.stateLabel : "Stopped"
    readonly property string liveStartupPhaseLabel: controllerReady ? engineController.startupPhaseLabel : "Idle"
    readonly property bool liveAppSnapshotLoaded: controllerReady && engineController.appSnapshotLoaded
    readonly property bool liveOperatorUiReady: controllerReady && engineController.operatorUiReady
    readonly property bool liveLightingEnabled: controllerReady && engineController.lightingEnabled
    readonly property bool liveLightingReachable: controllerReady && engineController.lightingReachable
    readonly property bool liveAudioOscEnabled: controllerReady && engineController.audioOscEnabled
    readonly property bool liveAudioVerified: controllerReady && engineController.audioVerified
    readonly property bool liveAudioConnected: controllerReady && engineController.audioConnected

    readonly property string liveEngineVersion: controllerReady && engineController.engineVersion ? String(engineController.engineVersion) : ""
    readonly property string liveProtocolVersion: controllerReady && engineController.protocolVersion ? String(engineController.protocolVersion) : ""
    readonly property string liveStorageDetails: controllerReady && engineController.storageDetails ? String(engineController.storageDetails) : ""
    readonly property int liveLightingUniverse: controllerReady && engineController.lightingUniverse !== undefined ? engineController.lightingUniverse : 0
    readonly property int liveLightingFixtureCount: controllerReady && engineController.lightingFixtureCount !== undefined ? engineController.lightingFixtureCount : 0
    readonly property string livePlanningSelectedProjectId: controllerReady && engineController.planningSelectedProjectId ? String(engineController.planningSelectedProjectId) : ""
    readonly property var livePlanningProjects: controllerReady && engineController.planningProjects ? engineController.planningProjects : []
    readonly property string liveAudioSendHost: controllerReady && engineController.audioSendHost ? String(engineController.audioSendHost) : ""
    readonly property int liveAudioSendPort: controllerReady && engineController.audioSendPort !== undefined ? engineController.audioSendPort : 0

    readonly property bool snapshotLoading: !liveAppSnapshotLoaded || liveStartupPhaseLabel !== "Ready"
    readonly property bool hardwareBannerVisible: controllerReady
                                                   && liveAppSnapshotLoaded
                                                   && !snapshotLoading
                                                   && liveLightingEnabled
                                                   && liveAudioOscEnabled
                                                   && !liveLightingReachable
                                                   && !liveAudioConnected

    readonly property int railHeight: 22
    readonly property int tabStripHeight: 68
    readonly property int bannerHeight: 30

    property string _liveUtcClock: ""
    property string _liveUptime: "00:00:00"
    property real _shellStartMs: 0

    color: theme.studio950
    border.width: 0
    implicitWidth: 1400
    implicitHeight: headerColumn.implicitHeight * scaleFactor

    function selectWorkspace(workspaceId) {
        if (controllerReady) {
            engineController.setWorkspaceMode(workspaceId)
        }
    }

    function scaleOptions() {
        return [
            { "label": "90", "value": 0.9, "title": "Dense operator view" },
            { "label": "100", "value": 1.0, "title": "Standard operator view" },
            { "label": "108", "value": 1.08, "title": "Relaxed operator view" }
        ]
    }

    function workspaceSubtitle(workspaceId) {
        if (!controllerReady) {
            return ""
        }

        if (workspaceId === "planning") {
            const id = livePlanningSelectedProjectId
            if (!id) return ""
            const projects = livePlanningProjects
            for (let i = 0; i < projects.length; i++) {
                const project = projects[i]
                if (project && project.id === id) {
                    return project.name || ""
                }
            }
            return ""
        }

        if (workspaceId === "lighting") {
            if (liveLightingFixtureCount <= 0) return ""
            return "universe " + liveLightingUniverse + " · " + liveLightingFixtureCount + " fixtures"
        }

        if (workspaceId === "audio") {
            if (liveAudioSendHost.length === 0) return ""
            return liveAudioSendHost + ":" + liveAudioSendPort
        }

        return ""
    }

    function operatorHealthLabel() {
        if (!controllerReady) return "Starting"
        if (snapshotLoading) return "Starting"
        if (liveStateLabel === "Failed") return "Recovery"
        if (liveHealthStatus === "degraded") return "Degraded"
        if (liveHealthStatus === "Unavailable" || liveHealthStatus === "Stopped") return "Recovery"
        if (liveHealthStatus === "healthy") return "Healthy"
        if (liveOperatorUiReady) return "Healthy"
        return "Starting"
    }

    function operatorHealthTone() {
        if (!controllerReady) return theme.accentAmber
        if (snapshotLoading) return theme.accentAmber
        if (liveStateLabel === "Failed") return theme.accentRed
        if (liveHealthStatus === "degraded") return theme.accentAmber
        if (liveHealthStatus === "Unavailable" || liveHealthStatus === "Stopped") return theme.accentRed
        if (liveHealthStatus === "healthy" || liveOperatorUiReady) return theme.accentGreen
        return theme.accentAmber
    }

    function dmxLabel() {
        if (!liveLightingEnabled) return "DMX OFF"
        return liveLightingReachable ? "DMX READY" : "DMX DOWN"
    }

    function dmxTone() {
        if (!liveLightingEnabled) return theme.studio500
        return liveLightingReachable ? theme.accentGreen : theme.accentRed
    }

    function oscLabel() {
        if (!liveAudioOscEnabled) return "OSC OFF"
        if (liveAudioVerified) return "OSC VERIFIED"
        return liveAudioConnected ? "OSC CONNECTED" : "OSC DOWN"
    }

    function oscTone() {
        if (!liveAudioOscEnabled) return theme.studio500
        if (liveAudioVerified) return theme.accentGreen
        return liveAudioConnected ? theme.accentAmber : theme.accentRed
    }

    function clockText() {
        if (rootWindow && typeof rootWindow.parityFrozenClock === "string" && rootWindow.parityFrozenClock.length > 0) {
            return rootWindow.parityFrozenClock
        }
        return _liveUtcClock
    }

    function uptimeText() {
        if (rootWindow && typeof rootWindow.parityFrozenUptime === "string" && rootWindow.parityFrozenUptime.length > 0) {
            return rootWindow.parityFrozenUptime
        }
        return _liveUptime
    }

    function _pad(n) {
        return n < 10 ? "0" + n : String(n)
    }

    function _refreshClockAndUptime() {
        const now = new Date()
        const hh = _pad(now.getUTCHours())
        const mm = _pad(now.getUTCMinutes())
        const ss = _pad(now.getUTCSeconds())
        _liveUtcClock = hh + ":" + mm + ":" + ss + " UTC"

        if (_shellStartMs > 0) {
            let elapsed = Math.max(0, Math.floor((Date.now() - _shellStartMs) / 1000))
            const uh = _pad(Math.floor(elapsed / 3600))
            elapsed = elapsed % 3600
            const um = _pad(Math.floor(elapsed / 60))
            const us = _pad(elapsed % 60)
            _liveUptime = uh + ":" + um + ":" + us
        }
    }

    Component.onCompleted: {
        _shellStartMs = Date.now()
        _refreshClockAndUptime()
    }

    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: root._refreshClockAndUptime()
    }

    ConsoleTheme {
        id: theme
    }

    Item {
        id: scaleHost
        width: parent.width / root.scaleFactor
        height: headerColumn.implicitHeight
        scale: root.scaleFactor
        transformOrigin: Item.TopLeft

        ColumnLayout {
            id: headerColumn
            width: parent.width
            spacing: 0

            Rectangle {
                id: monitorRailBg
                Layout.fillWidth: true
                Layout.preferredHeight: root.railHeight
                color: root.hardwareBannerVisible
                       ? Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.1)
                       : Qt.rgba(theme.studio900.r, theme.studio900.g, theme.studio900.b, 0.6)
                border.width: 0

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 1
                    color: theme.surfaceBorder
                }

                RowLayout {
                    id: monitorRailRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.leftMargin: 16
                    anchors.rightMargin: 16
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 0

                    Item {
                        id: railLeftCluster
                        visible: !root.snapshotLoading
                        Layout.fillWidth: true
                        Layout.preferredHeight: 14
                        implicitHeight: 14

                        RowLayout {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 18

                            Label {
                                text: "ENGINE " + (root.liveEngineVersion.length > 0 ? root.liveEngineVersion : "—")
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                                font.capitalization: Font.AllUppercase
                                font.letterSpacing: 0.6
                            }

                            Label {
                                text: "PROTO " + (root.liveProtocolVersion.length > 0 ? root.liveProtocolVersion : "—")
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                                font.capitalization: Font.AllUppercase
                                font.letterSpacing: 0.6
                            }

                            Label {
                                text: "UPTIME " + root.uptimeText()
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                                font.capitalization: Font.AllUppercase
                                font.letterSpacing: 0.6
                            }
                        }
                    }

                    Label {
                        visible: root.snapshotLoading
                        Layout.fillWidth: true
                        text: "STARTING ENGINE…"
                        color: theme.accentAmber
                        horizontalAlignment: Text.AlignHCenter
                        font.family: theme.monoFontFamily
                        font.pixelSize: theme.textXxs
                        font.weight: Font.DemiBold
                        font.capitalization: Font.AllUppercase
                        font.letterSpacing: 1.0

                        SequentialAnimation on opacity {
                            running: root.snapshotLoading
                            loops: Animation.Infinite
                            NumberAnimation { from: 0.55; to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
                            NumberAnimation { from: 1.0; to: 0.55; duration: 600; easing.type: Easing.InOutQuad }
                        }
                    }

                    RowLayout {
                        id: railRightCluster
                        visible: !root.snapshotLoading
                        spacing: 18
                        Layout.alignment: Qt.AlignRight | Qt.AlignVCenter

                        Label {
                            objectName: "dashboard-rail-dmx"
                            text: root.dmxLabel()
                            color: root.dmxTone()
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.letterSpacing: 0.6
                        }

                        Label {
                            objectName: "dashboard-rail-osc"
                            text: root.oscLabel()
                            color: root.oscTone()
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.letterSpacing: 0.6
                        }

                        Label {
                            text: root.liveStorageDetails.length > 0
                                  ? "STORAGE " + root.liveStorageDetails.toUpperCase()
                                  : "STORAGE —"
                            color: theme.studio500
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.letterSpacing: 0.6
                            elide: Text.ElideRight
                            Layout.maximumWidth: 320
                        }

                        Label {
                            text: root.clockText()
                            color: theme.studio400
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                            font.letterSpacing: 0.8
                        }
                    }
                }
            }

            Rectangle {
                id: hardwareBanner
                Layout.fillWidth: true
                Layout.preferredHeight: root.hardwareBannerVisible ? root.bannerHeight : 0
                visible: root.hardwareBannerVisible
                color: Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.18)
                clip: true

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 1
                    color: Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.52)
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 16
                    anchors.rightMargin: 12
                    spacing: theme.spacing4

                    ConsoleIcon {
                        iconName: "triangle-alert"
                        tint: theme.accentRed
                        pixelSize: 16
                    }

                    Label {
                        text: "HARDWARE UNREACHABLE — DMX + OSC DOWN"
                        color: theme.studio050
                        font.family: theme.uiFontFamily
                        font.pixelSize: theme.textXs
                        font.weight: Font.DemiBold
                        font.capitalization: Font.AllUppercase
                        font.letterSpacing: 0.6
                        Layout.fillWidth: true
                    }

                    ConsoleButton {
                        objectName: "dashboard-banner-retry"
                        text: "Retry"
                        tone: "secondary"
                        compact: true
                        dense: true
                        onClicked: {
                            if (!root.controllerReady) return
                            if (root.engineController.requestLightingSnapshot) {
                                root.engineController.requestLightingSnapshot()
                            }
                            if (root.engineController.requestAudioSnapshot) {
                                root.engineController.requestAudioSnapshot()
                            }
                        }
                    }

                    ConsoleButton {
                        objectName: "dashboard-banner-open-setup"
                        text: "Open Setup"
                        tone: "primary"
                        compact: true
                        dense: true
                        onClicked: root.selectWorkspace("setup")
                    }
                }
            }

            Rectangle {
                id: tabStripBg
                Layout.fillWidth: true
                Layout.preferredHeight: root.tabStripHeight
                color: theme.studio950
                border.width: 0

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 1
                    color: theme.surfaceBorder
                }

                RowLayout {
                    id: tabStripRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: 16
                    anchors.rightMargin: 12
                    spacing: theme.spacing4

                    Label {
                        id: brandMark
                        text: root.width >= 1680 ? "Studio Control" : "◆"
                        color: theme.studio200
                        font.family: theme.uiFontFamily
                        font.pixelSize: theme.textMd
                        font.weight: Font.DemiBold
                        font.letterSpacing: 0.4
                        Layout.alignment: Qt.AlignVCenter
                        leftPadding: 4
                        rightPadding: 12
                    }

                    Label {
                        id: sessionMarker
                        visible: root.width >= 1560 && text.length > 0
                        text: Qt.application.displayName ? Qt.application.displayName.toLowerCase() : ""
                        color: theme.studio500
                        font.family: theme.monoFontFamily
                        font.pixelSize: theme.textXxs
                        font.letterSpacing: 0.6
                        Layout.alignment: Qt.AlignVCenter
                    }

                    Item {
                        Layout.preferredWidth: theme.spacing4
                    }

                    RowLayout {
                        id: workspaceTabs
                        spacing: 0
                        Layout.alignment: Qt.AlignVCenter

                        ConsoleButton {
                            id: planningTab
                            objectName: "dashboard-tab-planning"
                            text: "Planning"
                            tone: "workspaceTab"
                            iconSvgName: "clipboard-list"
                            active: root.liveWorkspaceMode === "planning"
                            subtitle: active ? root.workspaceSubtitle("planning") : ""
                            Accessible.name: "Planning workspace, shortcut K"
                            onClicked: root.selectWorkspace("planning")
                        }

                        ConsoleButton {
                            id: lightingTab
                            objectName: "dashboard-tab-lighting"
                            text: "Lighting"
                            tone: "workspaceTab"
                            iconSvgName: "lamp"
                            active: root.liveWorkspaceMode === "lighting"
                            subtitle: active ? root.workspaceSubtitle("lighting") : ""
                            Accessible.name: "Lighting workspace, shortcut L"
                            onClicked: root.selectWorkspace("lighting")
                        }

                        ConsoleButton {
                            id: audioTab
                            objectName: "dashboard-tab-audio"
                            text: "Audio"
                            tone: "workspaceTab"
                            iconSvgName: "audio-waveform"
                            active: root.liveWorkspaceMode === "audio"
                            subtitle: active ? root.workspaceSubtitle("audio") : ""
                            Accessible.name: "Audio workspace, shortcut A"
                            onClicked: root.selectWorkspace("audio")
                        }
                    }

                    Item {
                        Layout.fillWidth: true
                    }

                    ConsoleBadge {
                        objectName: "dashboard-operator-health"
                        text: root.operatorHealthLabel()
                        badgeColor: root.operatorHealthTone()
                        textColor: theme.studio050
                        filled: false
                        uppercase: true
                        tone: "operator"
                        Layout.alignment: Qt.AlignVCenter

                        SequentialAnimation on opacity {
                            running: root.snapshotLoading
                            loops: Animation.Infinite
                            NumberAnimation { from: 0.6; to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
                            NumberAnimation { from: 1.0; to: 0.6; duration: 600; easing.type: Easing.InOutQuad }
                        }
                    }

                    Rectangle {
                        id: densityChipGroup
                        radius: theme.radiusBadge
                        color: Qt.rgba(theme.studio900.r, theme.studio900.g, theme.studio900.b, 0.72)
                        border.width: 1
                        border.color: theme.surfaceBorder
                        implicitHeight: theme.compactControlHeight
                        implicitWidth: densityChipRow.implicitWidth + 12
                        Layout.alignment: Qt.AlignVCenter

                        RowLayout {
                            id: densityChipRow
                            anchors.centerIn: parent
                            spacing: 2

                            Repeater {
                                model: root.scaleOptions()

                                ConsoleButton {
                                    required property var modelData
                                    objectName: "dashboard-scale-" + modelData.label
                                    text: modelData.label
                                    tone: "chip"
                                    compact: true
                                    dense: true
                                    active: root.rootWindow !== null
                                            && typeof root.rootWindow.dashboardUiScale === "number"
                                            && Math.abs(root.rootWindow.dashboardUiScale - modelData.value) < 0.001
                                    ToolTip.visible: hovered
                                    ToolTip.text: modelData.title
                                    onClicked: {
                                        if (root.rootWindow) {
                                            root.rootWindow.dashboardUiScale = modelData.value
                                        }
                                    }
                                }
                            }
                        }
                    }

                    ConsoleButton {
                        objectName: "dashboard-about-button"
                        tone: "icon"
                        iconText: "i"
                        compact: true
                        dense: true
                        Layout.alignment: Qt.AlignVCenter
                        implicitWidth: theme.compactControlHeight
                        ToolTip.visible: hovered
                        ToolTip.text: "About SSE ExEd Studio Control"
                        onClicked: {
                            if (root.rootWindow) {
                                root.rootWindow.aboutDialogVisible = true
                            }
                        }
                    }

                    ConsoleButton {
                        objectName: "dashboard-help-button"
                        tone: "icon"
                        iconText: "?"
                        compact: true
                        dense: true
                        Layout.alignment: Qt.AlignVCenter
                        implicitWidth: theme.compactControlHeight
                        ToolTip.visible: hovered
                        ToolTip.text: "Keyboard shortcuts"
                        onClicked: {
                            if (root.rootWindow) {
                                root.rootWindow.keyboardHelpVisible = true
                            }
                        }
                    }

                    ConsoleButton {
                        objectName: "dashboard-setup-button"
                        tone: "ghost"
                        compact: true
                        dense: true
                        text: "Setup"
                        Layout.alignment: Qt.AlignVCenter
                        ToolTip.visible: hovered
                        ToolTip.text: "Control surface setup"
                        onClicked: root.selectWorkspace("setup")

                        ConsoleIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            iconName: "wrench"
                            tint: theme.studio300
                            pixelSize: 14
                        }
                    }
                }
            }
        }
    }
}
