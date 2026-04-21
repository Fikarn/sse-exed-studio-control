import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root
    objectName: "setup-workspace-panel"
    required property var rootWindow
    required property var engineController
    property real scaleFactor: 1.0
    readonly property real fitScaleFactor: 1.0
    readonly property real effectiveScaleFactor: Math.min(root.scaleFactor, root.fitScaleFactor)
    property string activeSection: "commissioning"
    property string activeStepId: "import"
    property string pendingStepId: ""
    property bool jumpAheadVisible: false
    property bool wideLayout: width >= 800
    property bool widescreenParityMode: width >= 1100
    readonly property var currentPage: root.rootWindow.controlSurfacePageById(root.rootWindow.selectedControlSurfacePageId)
    readonly property real centeredMaxWidth: Math.min(root.width - 64, 1400)

    readonly property var stepModel: [
        { "id": "import", "label": "Import profile", "summary": "Drop .companionconfig" },
        { "id": "probe", "label": "Probe hardware", "summary": "Control · DMX · OSC" },
        { "id": "map", "label": "Map bindings", "summary": "Pages, buttons, dials" },
        { "id": "verify", "label": "Verify live echo", "summary": "Press a physical button" },
        { "id": "publish", "label": "Publish", "summary": "Commit + return" }
    ]

    function stepIndex(id) {
        for (let i = 0; i < root.stepModel.length; i += 1) {
            if (root.stepModel[i].id === id) {
                return i
            }
        }
        return 0
    }

    function activeStep() {
        return root.stepModel[root.stepIndex(root.activeStepId)]
    }

    function setStep(id) {
        if (id === root.activeStepId) {
            return
        }
        const nextIndex = root.stepIndex(id)
        const currentIndex = root.stepIndex(root.activeStepId)
        if (nextIndex > currentIndex + 1) {
            root.pendingStepId = id
            root.jumpAheadVisible = true
            return
        }
        root.applyStep(id)
    }

    function applyStep(id) {
        root.activeStepId = id
        root.rootWindow.controlSurfaceOverviewVerifyMode = (id === "verify")
    }

    function advance() {
        const currentIndex = root.stepIndex(root.activeStepId)
        if (currentIndex < root.stepModel.length - 1) {
            root.applyStep(root.stepModel[currentIndex + 1].id)
        }
    }

    function retreat() {
        const currentIndex = root.stepIndex(root.activeStepId)
        if (currentIndex > 0) {
            root.applyStep(root.stepModel[currentIndex - 1].id)
        }
    }

    function publishAndReturn() {
        root.engineController.updateCommissioningStage("ready")
        root.engineController.exportSupportBackup()
        root.engineController.setWorkspaceMode("planning")
    }

    function runAllProbes() {
        root.engineController.runControlSurfaceProbe()
        if (root.engineController.runLightingProbe) {
            const bridgeIp = root.engineController.lightingBridgeIp || ""
            const universe = root.engineController.lightingUniverse || 1
            root.engineController.runLightingProbe(bridgeIp, universe)
        }
        if (root.engineController.runAudioProbe) {
            const sendHost = root.engineController.audioSendHost || "127.0.0.1"
            const sendPort = root.engineController.audioSendPort || 7001
            const receivePort = root.engineController.audioReceivePort || 9001
            root.engineController.runAudioProbe(sendHost, sendPort, receivePort)
        }
    }

    function contentFitsViewport() {
        return true
    }

    function runnerShortcutsEnabled() {
        if (root.activeSection !== "commissioning" || root.jumpAheadVisible) {
            return false
        }
        if (typeof root.rootWindow.inputFieldHasFocus === "function"
            && root.rootWindow.inputFieldHasFocus()) {
            return false
        }
        return true
    }

    function resetVerifyState() {
        root.activeSection = "commissioning"
        setupGuidePanel.manualVisible = false
        setupInstallerHelpPanel.expanded = false
        if (setupControlSurfacePanel.showPageOverviewForVerify) {
            setupControlSurfacePanel.showPageOverviewForVerify()
        }
    }

    function openLegacySupportPanelsForVerify() {
        root.resetVerifyState()
        root.activeSection = "support"
        setupGuidePanel.manualVisible = true
        setupInstallerHelpPanel.expanded = true
        if (setupControlSurfacePanel.showPageOverviewForVerify) {
            setupControlSurfacePanel.showPageOverviewForVerify()
        }
    }

    function showSupportSectionForVerify() {
        root.activeSection = "support"
        setupGuidePanel.manualVisible = false
        setupInstallerHelpPanel.expanded = false
    }

    ConsoleTheme {
        id: theme
    }

    visible: !!engineController && engineController.workspaceMode === "setup"
    Layout.fillWidth: true
    Layout.fillHeight: true

    // ---------------------------------------------------------------------
    // Top utility row — Back to Console + Runner/Support toggle
    // ---------------------------------------------------------------------
    Item {
        id: topUtilityRow
        height: theme.toolbarHeight
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: 24
        anchors.rightMargin: 24
        anchors.topMargin: 16

        ConsoleButton {
            text: "Back to Console"
            iconText: "←"
            tone: "secondary"
            dense: true
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            enabled: root.engineController.startupTargetSurface === "dashboard"
            onClicked: root.engineController.setWorkspaceMode("planning")
        }

        RowLayout {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 6

            ConsoleButton {
                objectName: "setup-section-commissioning"
                text: "Runner"
                tone: "chip"
                active: root.activeSection === "commissioning"
                onClicked: root.activeSection = "commissioning"
            }

            ConsoleButton {
                objectName: "setup-section-support"
                text: "Support"
                tone: "chip"
                active: root.activeSection === "support"
                onClicked: root.activeSection = "support"
            }
        }
    }

    // ---------------------------------------------------------------------
    // Runner mode — step progress + body + footer
    // ---------------------------------------------------------------------
    Item {
        id: runnerContainer
        visible: root.activeSection === "commissioning"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: topUtilityRow.bottom
        anchors.bottom: parent.bottom
        anchors.topMargin: 12

        Item {
            id: runnerCenter
            width: root.centeredMaxWidth
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.bottom: parent.bottom

            ConsoleStepHeader {
                id: stepHeader
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: 96
                model: root.stepModel
                activeId: root.activeStepId
                onSegmentClicked: function(id, index) { root.setStep(id) }
            }

            Item {
                id: runnerBody
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: stepHeader.bottom
                anchors.bottom: runnerFooter.top
                anchors.topMargin: 16
                anchors.bottomMargin: 16

                // Step 1 — Import
                Item {
                    visible: root.activeStepId === "import"
                    anchors.fill: parent

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: theme.spacing6

                        Label {
                            text: "Drop a Companion .companionconfig here, or paste the API base URL below. Sample data is available for first-run commissioning."
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        SetupQuickSetupPanel {
                            rootWindow: root.rootWindow
                            engineController: root.engineController
                            denseMode: false
                            Layout.fillWidth: true
                        }
                    }
                }

                // Step 2 — Probe
                Item {
                    visible: root.activeStepId === "probe"
                    anchors.fill: parent

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: theme.spacing6

                        Label {
                            text: "Run the three hardware probes. Results populate the checks list — the step turns green when all probes return OK."
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        ConsoleButton {
                            text: "Run probes"
                            tone: "primary"
                            enabled: root.engineController.operatorUiReady
                            onClicked: root.runAllProbes()
                        }

                        SetupConnectionProbePanel {
                            rootWindow: root.rootWindow
                            engineController: root.engineController
                            denseMode: false
                            Layout.fillWidth: true
                        }
                    }
                }

                // Steps 3 + 4 — Map + Verify (same panel, mode flag via rootWindow)
                Item {
                    visible: root.activeStepId === "map" || root.activeStepId === "verify"
                    anchors.fill: parent

                    SetupControlSurfacePanel {
                        id: setupControlSurfacePanel
                        rootWindow: root.rootWindow
                        engineController: root.engineController
                        preferWideRailLayout: root.widescreenParityMode
                        anchors.fill: parent
                        denseMode: false
                    }
                }

                // Step 5 — Publish
                Item {
                    visible: root.activeStepId === "publish"
                    anchors.fill: parent

                    ConsoleSurface {
                        tone: "strong"
                        anchors.fill: parent
                        padding: theme.spacing10

                        ColumnLayout {
                            anchors.fill: parent
                            spacing: theme.spacing6

                            Label {
                                text: "Ready to publish"
                                color: theme.studio050
                                font.family: theme.uiFontFamily
                                font.pixelSize: theme.textXl
                                font.weight: Font.DemiBold
                            }

                            Label {
                                text: "Publishing commits the commissioning state to the engine, exports a support backup snapshot, and returns to the Planning workspace."
                                color: theme.studio300
                                font.family: theme.uiFontFamily
                                font.pixelSize: theme.textSm
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            GridLayout {
                                Layout.fillWidth: true
                                columns: 3
                                columnSpacing: theme.spacing6
                                rowSpacing: theme.spacing6

                                Repeater {
                                    model: [
                                        { "label": "Pages", "value": root.engineController.controlSurfacePages.length + "" },
                                        { "label": "Checks passed", "value": root.completedChecksLabel() },
                                        { "label": "Commissioning stage", "value": root.engineController.commissioningStage || "unknown" }
                                    ]

                                    ConsoleSurface {
                                        required property var modelData
                                        tone: "soft"
                                        padding: theme.spacing6
                                        Layout.fillWidth: true
                                        implicitHeight: publishStatLayout.implicitHeight + 2 * padding

                                        ColumnLayout {
                                            id: publishStatLayout
                                            anchors.fill: parent
                                            spacing: 2

                                            Label {
                                                text: modelData.label
                                                color: theme.studio500
                                                font.family: theme.monoFontFamily
                                                font.pixelSize: theme.textXxs
                                                font.capitalization: Font.AllUppercase
                                            }
                                            Label {
                                                text: modelData.value
                                                color: theme.studio050
                                                font.family: theme.uiFontFamily
                                                font.pixelSize: theme.textLg
                                                font.weight: Font.DemiBold
                                                elide: Text.ElideRight
                                                Layout.fillWidth: true
                                            }
                                        }
                                    }
                                }
                            }

                            Item {
                                Layout.fillHeight: true
                            }
                        }
                    }
                }
            }

            // Footer action bar
            Item {
                id: runnerFooter
                height: 72
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom

                ConsoleButton {
                    text: "Back"
                    iconText: "←"
                    tone: "ghost"
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    enabled: root.stepIndex(root.activeStepId) > 0
                    onClicked: root.retreat()
                }

                ConsoleButton {
                    id: primaryFooterAction
                    tone: "stepFooter"
                    text: root.primaryActionLabel()
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    enabled: root.engineController.operatorUiReady
                    onClicked: root.invokePrimaryAction()
                }
            }
        }

    }

    // Jump-ahead warning modal (scopes to the whole panel so the scrim covers the header)
    ConsoleModal {
        id: jumpAheadModal
        open: root.jumpAheadVisible
        title: "Skip ahead?"
        subtitle: "Preceding steps haven't been confirmed"
        dialogWidth: 520
        onCloseRequested: {
            root.jumpAheadVisible = false
            root.pendingStepId = ""
        }

        ColumnLayout {
            spacing: theme.spacing6

            Label {
                text: "You haven't confirmed preceding steps. Skipping may leave the commissioning incomplete."
                color: theme.studio300
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textSm
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.alignment: Qt.AlignRight
                spacing: theme.spacing4

                ConsoleButton {
                    text: "Cancel"
                    tone: "ghost"
                    onClicked: {
                        root.jumpAheadVisible = false
                        root.pendingStepId = ""
                    }
                }

                ConsoleButton {
                    text: "Skip ahead"
                    tone: "primary"
                    onClicked: {
                        root.applyStep(root.pendingStepId)
                        root.jumpAheadVisible = false
                        root.pendingStepId = ""
                    }
                }
            }
        }
    }

    function primaryActionLabel() {
        switch (root.activeStepId) {
        case "import": return "Continue"
        case "probe": return "Continue"
        case "map": return "Continue"
        case "verify": return "Continue to publish"
        case "publish": return "Publish ↵"
        }
        return "Continue"
    }

    function invokePrimaryAction() {
        if (root.activeStepId === "publish") {
            root.publishAndReturn()
            return
        }
        root.advance()
    }

    function completedChecksLabel() {
        const checks = root.engineController.commissioningChecks || []
        if (checks.length === 0) {
            return "0 / 0"
        }
        let passed = 0
        for (let i = 0; i < checks.length; i += 1) {
            if (checks[i].status === "ok") {
                passed += 1
            }
        }
        return passed + " / " + checks.length
    }

    // ---------------------------------------------------------------------
    // Support mode — 12-col dashboard grid
    // ---------------------------------------------------------------------
    Item {
        id: supportContainer
        visible: root.activeSection === "support"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: topUtilityRow.bottom
        anchors.bottom: parent.bottom
        anchors.topMargin: 12

        Item {
            width: root.centeredMaxWidth
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.bottom: parent.bottom

            ColumnLayout {
                anchors.fill: parent
                spacing: theme.spacing6

                ConsoleSurface {
                    tone: "strong"
                    padding: theme.spacing8
                    Layout.fillWidth: true
                    implicitHeight: supportBannerLayout.implicitHeight + 2 * padding

                    ColumnLayout {
                        id: supportBannerLayout
                        anchors.fill: parent
                        spacing: 2

                        Label {
                            text: "Support"
                            color: theme.studio500
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.capitalization: Font.AllUppercase
                        }
                        Label {
                            text: "What went wrong?"
                            color: theme.studio050
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textLg
                            font.weight: Font.DemiBold
                        }
                        Label {
                            text: root.engineController.supportSnapshotLoaded
                                  ? root.engineController.supportDetails
                                  : "Support snapshot is waiting for the engine."
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: theme.spacing6

                    // Restore (8 cols)
                    ConsoleSurface {
                        tone: "soft"
                        padding: theme.spacing8
                        Layout.preferredWidth: Math.max(0, (root.centeredMaxWidth - theme.spacing6) * 0.666)
                        Layout.fillHeight: true

                        ColumnLayout {
                            anchors.fill: parent
                            spacing: theme.spacing4

                            Label {
                                text: "Restore"
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                                font.capitalization: Font.AllUppercase
                            }

                            Label {
                                text: root.engineController.supportSnapshotLoaded
                                      ? root.engineController.supportRestoreDetails
                                      : "Support restore state is waiting for the engine."
                                color: theme.studio050
                                font.family: theme.uiFontFamily
                                font.pixelSize: theme.textSm
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            Label {
                                visible: root.engineController.supportBackupCount === 0
                                text: "No backup archives present yet. Export a baseline backup before your first incident."
                                color: theme.studio400
                                font.family: theme.uiFontFamily
                                font.pixelSize: theme.textSm
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }

                            Label {
                                visible: root.engineController.supportLatestBackupPath.length > 0
                                text: "Latest: " + root.engineController.supportLatestBackupPath
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXs
                                wrapMode: Text.WrapAnywhere
                                Layout.fillWidth: true
                            }

                            ConsoleTextField {
                                Layout.fillWidth: true
                                text: root.rootWindow.supportRestorePathDraft
                                placeholderText: "Path to backup JSON"
                                onTextChanged: root.rootWindow.supportRestorePathDraft = text
                            }

                            RowLayout {
                                spacing: theme.spacing4

                                ConsoleButton {
                                    text: root.engineController.supportBackupCount === 0 ? "Export first backup" : "Restore backup"
                                    tone: "primary"
                                    enabled: root.engineController.operatorUiReady
                                             && (root.engineController.supportBackupCount === 0
                                                 || root.rootWindow.supportRestorePathDraft.trim().length > 0)
                                    onClicked: {
                                        if (root.engineController.supportBackupCount === 0) {
                                            root.engineController.exportSupportBackup()
                                        } else {
                                            root.engineController.restoreSupportBackup(root.rootWindow.supportRestorePathDraft)
                                        }
                                    }
                                }

                                ConsoleButton {
                                    text: "Export backup"
                                    tone: "secondary"
                                    enabled: root.engineController.operatorUiReady
                                    onClicked: root.engineController.exportSupportBackup()
                                }

                                ConsoleButton {
                                    text: "Open backups"
                                    tone: "ghost"
                                    enabled: root.engineController.supportBackupDir.length > 0
                                    onClicked: root.engineController.openSupportBackupDirectory()
                                }
                            }

                            Item {
                                Layout.fillHeight: true
                            }
                        }
                    }

                    // Diagnostics + Install column (4 cols)
                    ColumnLayout {
                        Layout.preferredWidth: Math.max(0, (root.centeredMaxWidth - theme.spacing6) * 0.334)
                        Layout.fillHeight: true
                        spacing: theme.spacing6

                        ConsoleSurface {
                            tone: "soft"
                            padding: theme.spacing6
                            Layout.fillWidth: true

                            ColumnLayout {
                                anchors.fill: parent
                                spacing: theme.spacing4

                                Label {
                                    text: "Diagnostics"
                                    color: theme.studio500
                                    font.family: theme.monoFontFamily
                                    font.pixelSize: theme.textXxs
                                    font.capitalization: Font.AllUppercase
                                }

                                ConsoleButton {
                                    Layout.fillWidth: true
                                    text: "Run control-surface probe"
                                    tone: "secondary"
                                    dense: true
                                    enabled: root.engineController.operatorUiReady
                                    onClicked: root.engineController.runControlSurfaceProbe()
                                }

                                ConsoleButton {
                                    Layout.fillWidth: true
                                    text: "Export shell diagnostics"
                                    tone: "secondary"
                                    dense: true
                                    onClicked: root.engineController.exportShellDiagnostics()
                                }

                                Label {
                                    visible: root.engineController.shellDiagnosticsExportPath.length > 0
                                    text: root.engineController.shellDiagnosticsExportPath
                                    color: theme.studio500
                                    font.family: theme.monoFontFamily
                                    font.pixelSize: theme.textXxs
                                    wrapMode: Text.WrapAnywhere
                                    Layout.fillWidth: true
                                }
                            }
                        }

                        SetupInstallerHelpPanel {
                            id: setupInstallerHelpPanel
                            Layout.fillWidth: true
                            denseMode: true
                        }

                        SetupGuidePanel {
                            id: setupGuidePanel
                            Layout.fillWidth: true
                            denseMode: true
                        }

                        Item {
                            Layout.fillHeight: true
                        }
                    }
                }

                // Reference paths footer rail
                ConsoleSurface {
                    tone: "soft"
                    padding: theme.spacing4
                    Layout.fillWidth: true
                    implicitHeight: referenceFooterRail.implicitHeight + 2 * padding

                    RowLayout {
                        id: referenceFooterRail
                        anchors.fill: parent
                        spacing: theme.spacing4

                        Label {
                            text: "PATHS"
                            color: theme.studio500
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.letterSpacing: 1.6
                        }

                        ConsoleButton {
                            text: "App data"
                            tone: "monoRail"
                            onClicked: root.engineController.openAppDataDirectory()
                        }
                        ConsoleButton {
                            text: "Logs"
                            tone: "monoRail"
                            onClicked: root.engineController.openLogsDirectory()
                        }
                        ConsoleButton {
                            text: "Engine log"
                            tone: "monoRail"
                            enabled: root.engineController.engineLogPath.length > 0
                            onClicked: root.engineController.openEngineLogFile()
                        }
                        ConsoleButton {
                            text: "Backups"
                            tone: "monoRail"
                            enabled: root.engineController.supportBackupDir.length > 0
                            onClicked: root.engineController.openSupportBackupDirectory()
                        }
                        ConsoleButton {
                            text: "Diagnostics"
                            tone: "monoRail"
                            onClicked: root.engineController.openDiagnosticsDirectory()
                        }

                        Item {
                            Layout.fillWidth: true
                        }

                        Label {
                            text: "engine " + root.engineController.engineVersion + " · proto " + root.engineController.protocolVersion
                            color: theme.studio500
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                        }
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Scoped runner keyboard shortcuts
    // ---------------------------------------------------------------------
    Shortcut {
        sequence: "Tab"
        enabled: root.runnerShortcutsEnabled()
        onActivated: root.advance()
    }

    Shortcut {
        sequence: "Shift+Tab"
        enabled: root.runnerShortcutsEnabled()
        onActivated: root.retreat()
    }

    Shortcut {
        sequence: "Return"
        enabled: root.runnerShortcutsEnabled()
        onActivated: root.invokePrimaryAction()
    }
}
