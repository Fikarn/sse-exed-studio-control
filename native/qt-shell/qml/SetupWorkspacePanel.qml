import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root
    objectName: "setup-workspace-panel"
    required property var rootWindow
    required property var engineController
    property real scaleFactor: 1.0
    readonly property real fitScaleFactor: setupContentLayout.implicitHeight > 0
                                           ? Math.min(1.0, setupScrollView.height / setupContentLayout.implicitHeight)
                                           : 1.0
    readonly property real effectiveScaleFactor: Math.min(root.scaleFactor, root.fitScaleFactor)
    property string activeSection: "commissioning"
    property bool wideLayout: width >= 800
    property bool widescreenParityMode: width >= 1100
    readonly property real leftRailWidth: root.widescreenParityMode ? 320 : 352
    readonly property var currentPage: root.rootWindow.controlSurfacePageById(root.rootWindow.selectedControlSurfacePageId)

    function currentPageButtonCount() {
        return root.currentPage && root.currentPage.buttons ? root.currentPage.buttons.length : 0
    }

    function currentPageDialCount() {
        if (!root.currentPage || !root.currentPage.dials) {
            return 0
        }

        const positions = {}
        for (let index = 0; index < root.currentPage.dials.length; index += 1) {
            positions[root.currentPage.dials[index].position] = true
        }
        return Object.keys(positions).length
    }

    function contentFitsViewport() {
        return setupContentLayout.implicitHeight * root.effectiveScaleFactor <= setupScrollView.height + 1
    }

    function resetVerifyState() {
        root.activeSection = "commissioning"
        setupGuidePanel.manualVisible = false
        setupInstallerHelpPanel.expanded = false
        if (setupControlSurfacePanel.showPageOverviewForVerify) {
            setupControlSurfacePanel.showPageOverviewForVerify()
        }
        Qt.callLater(function() {
            if (setupScrollView.contentItem) {
                setupScrollView.contentItem.contentY = 0
            }
        })
    }

    function openLegacySupportPanelsForVerify() {
        root.resetVerifyState()
        root.activeSection = "support"
        setupGuidePanel.manualVisible = true
        setupInstallerHelpPanel.expanded = true
        if (setupControlSurfacePanel.showPageOverviewForVerify) {
            setupControlSurfacePanel.showPageOverviewForVerify()
        }
        Qt.callLater(function() {
            if (setupScrollView.contentItem) {
                setupScrollView.contentItem.contentY = 0
            }
        })
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

    ScrollView {
        id: setupScrollView
        anchors.fill: parent
        clip: true
        contentWidth: availableWidth

        Item {
            width: setupScrollView.availableWidth
            implicitHeight: centeredSetupFrame.implicitHeight + 16

            Item {
                id: centeredSetupFrame
                x: Math.max(0, (parent.width - width) / 2)
                y: 0
                width: Math.min(parent.width, 1720)
                implicitHeight: setupContentLayout.implicitHeight * root.effectiveScaleFactor

                Item {
                    width: parent.width / root.effectiveScaleFactor
                    implicitHeight: setupContentLayout.implicitHeight
                    height: implicitHeight
                    scale: root.effectiveScaleFactor
                    transformOrigin: Item.TopLeft

                    ColumnLayout {
                        id: setupContentLayout
                        width: parent.width
                        spacing: 12

                        ConsoleSurface {
                            tone: "strong"
                            padding: 0
                            Layout.fillWidth: true
                            implicitHeight: headerLayout.implicitHeight + 24

                            GridLayout {
                                id: headerLayout
                                anchors.fill: parent
                                anchors.leftMargin: 16
                                anchors.rightMargin: 16
                                anchors.topMargin: 12
                                anchors.bottomMargin: 12
                                columns: root.wideLayout ? 2 : 1
                                columnSpacing: 12
                                rowSpacing: 12

                                RowLayout {
                                    Layout.fillWidth: true
                                    Layout.alignment: Qt.AlignTop
                                    spacing: 12

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2

                                        Label {
                                            text: "Commissioning Workspace"
                                            color: Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.8)
                                            font.pixelSize: 10
                                            font.weight: Font.DemiBold
                                            font.letterSpacing: 2.4
                                        }

                                        Label {
                                            text: "Control surface setup"
                                            color: theme.studio050
                                            font.pixelSize: 23
                                            font.weight: Font.DemiBold
                                        }

                                        Label {
                                            text: "Commission Bitfocus Companion and Stream Deck+ as a fixed studio console. This workspace is tuned for import-first setup, fast verification, and no-scroll use at 1920x1080."
                                            color: theme.studio300
                                            font.pixelSize: 13
                                            lineHeight: 1.5
                                            wrapMode: Text.WordWrap
                                            Layout.fillWidth: true
                                        }
                                    }

                                    ConsoleButton {
                                        text: "Back to Console"
                                        iconText: "\u2190"
                                        Layout.alignment: Qt.AlignTop
                                        tone: "secondary"
                                        dense: true
                                        enabled: root.engineController.startupTargetSurface === "dashboard"
                                        onClicked: root.engineController.setWorkspaceMode("planning")
                                    }
                                }

                                GridLayout {
                                    Layout.preferredWidth: root.wideLayout ? 456 : -1
                                    Layout.fillWidth: !root.wideLayout
                                    columns: 3
                                columnSpacing: 8
                                rowSpacing: 8

                                Rectangle {
                                    radius: 16
                                    color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.96)
                                    border.color: theme.surfaceBorder
                                    border.width: 1
                                    Layout.preferredWidth: root.wideLayout ? 146 : 196
                                    implicitHeight: 72

                                    ColumnLayout {
                                        anchors.fill: parent
                                        anchors.margins: 10
                                        spacing: 1

                                        Label {
                                            text: "Deck Pages"
                                            color: theme.studio500
                                            font.pixelSize: 10
                                            font.letterSpacing: 1.6
                                            font.capitalization: Font.AllUppercase
                                        }
                                        Label {
                                            text: engineController.controlSurfacePages.length
                                            color: theme.studio050
                                            font.pixelSize: 18
                                            font.weight: Font.DemiBold
                                        }
                                        Label {
                                            text: "Projects / Tasks / Lights / Audio"
                                            color: theme.studio500
                                            font.pixelSize: 10
                                        }
                                    }
                                }

                                Rectangle {
                                    radius: 16
                                    color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.96)
                                    border.color: theme.surfaceBorder
                                    border.width: 1
                                    Layout.preferredWidth: root.wideLayout ? 146 : 196
                                    implicitHeight: 72

                                    ColumnLayout {
                                        anchors.fill: parent
                                        anchors.margins: 10
                                        spacing: 1

                                        Label {
                                            text: "Active Page"
                                            color: theme.studio500
                                            font.pixelSize: 10
                                            font.letterSpacing: 1.6
                                            font.capitalization: Font.AllUppercase
                                        }
                                        Label {
                                            text: root.currentPage ? root.currentPage.label : "None"
                                            color: theme.studio050
                                            font.pixelSize: 18
                                            font.weight: Font.DemiBold
                                        }
                                        Label {
                                            text: root.currentPageButtonCount() + " buttons, "
                                                  + root.currentPageDialCount() + " dials mapped"
                                            color: theme.studio500
                                            font.pixelSize: 10
                                        }
                                    }
                                }

                                Rectangle {
                                    radius: 16
                                    color: Qt.rgba(theme.accentGreen.r, theme.accentGreen.g, theme.accentGreen.b, 0.05)
                                    border.color: Qt.rgba(theme.accentGreen.r, theme.accentGreen.g, theme.accentGreen.b, 0.18)
                                    border.width: 1
                                    Layout.preferredWidth: root.wideLayout ? 146 : 196
                                    implicitHeight: 84

                                    ColumnLayout {
                                        anchors.fill: parent
                                        anchors.margins: 10
                                        spacing: 1

                                        Label {
                                            text: "Workflow"
                                            color: Qt.rgba(theme.accentGreen.r, theme.accentGreen.g, theme.accentGreen.b, 0.78)
                                            font.pixelSize: 10
                                            font.letterSpacing: 1.6
                                            font.capitalization: Font.AllUppercase
                                        }
                                        Label {
                                            text: "Import first"
                                            color: "#dcfce7"
                                            font.pixelSize: 18
                                            font.weight: Font.DemiBold
                                        }
                                        Label {
                                            text: "Profile download, action test, then manual exceptions"
                                            color: Qt.rgba(theme.accentGreen.r, theme.accentGreen.g, theme.accentGreen.b, 0.62)
                                            font.pixelSize: 9
                                            lineHeight: 1.3
                                            wrapMode: Text.WordWrap
                                            Layout.fillWidth: true
                                        }
                                    }
                                }
                            }

                        }
                    }

                    RowLayout {
                        visible: true
                        Layout.fillWidth: true
                        spacing: 8

                        ConsoleButton {
                            objectName: "setup-section-commissioning"
                            text: "Commissioning"
                            tone: "tab"
                            active: root.activeSection === "commissioning"
                            onClicked: root.activeSection = "commissioning"
                        }

                        ConsoleButton {
                            objectName: "setup-section-support"
                            text: "Support"
                            tone: "tab"
                            active: root.activeSection === "support"
                            onClicked: root.activeSection = "support"
                        }
                    }

                    Item {
                        visible: root.activeSection === "commissioning"
                        Layout.fillWidth: true
                        implicitHeight: commissioningLayout.implicitHeight

                        GridLayout {
                            id: commissioningLayout
                            width: parent.width
                            columns: root.wideLayout ? 2 : 1
                            columnSpacing: 12
                            rowSpacing: 12

                            ColumnLayout {
                                Layout.alignment: Qt.AlignTop
                                Layout.preferredWidth: root.wideLayout ? root.leftRailWidth : -1
                                Layout.fillWidth: !root.wideLayout
                                spacing: 14

                                SetupQuickSetupPanel {
                                    rootWindow: root.rootWindow
                                    engineController: root.engineController
                                    denseMode: false
                                }

                                SetupConnectionProbePanel {
                                    rootWindow: root.rootWindow
                                    engineController: root.engineController
                                    denseMode: false
                                }

                                SetupGuidePanel {
                                    id: setupGuidePanel
                                    denseMode: false
                                }

                                SetupInstallerHelpPanel {
                                    id: setupInstallerHelpPanel
                                    denseMode: false
                                }
                            }

                                SetupControlSurfacePanel {
                                    id: setupControlSurfacePanel
                                    rootWindow: root.rootWindow
                                    engineController: root.engineController
                                    preferWideRailLayout: root.widescreenParityMode
                                    Layout.alignment: Qt.AlignTop
                                    Layout.fillWidth: true
                                    Layout.minimumWidth: root.wideLayout ? 760 : 0
                                denseMode: false
                            }
                        }
                    }

                    Item {
                        visible: root.activeSection === "support"
                        Layout.fillWidth: true
                        implicitHeight: supportLayout.implicitHeight

                        GridLayout {
                            id: supportLayout
                            width: parent.width
                            columns: root.width >= 1520 ? 3 : 1
                            columnSpacing: 12
                            rowSpacing: 12

                            ConsoleSurface {
                                tone: "soft"
                                padding: theme.spacing6
                                Layout.fillWidth: true
                                implicitHeight: backupArchiveLayout.implicitHeight + 2 * padding

                                ColumnLayout {
                                    id: backupArchiveLayout
                                    anchors.fill: parent
                                    spacing: theme.spacing4

                                    Label {
                                        text: "Backup Archive"
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                    }
                                    Label {
                                        text: engineController.supportSnapshotLoaded
                                              ? engineController.supportDetails
                                              : "Support snapshot is waiting for the engine."
                                        color: theme.studio050
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textSm
                                        wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: "Backup dir: "
                                              + (engineController.supportBackupDir.length > 0
                                                 ? engineController.supportBackupDir
                                                 : "unavailable")
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: engineController.supportLatestBackupPath.length > 0
                                              ? "Latest archive: " + engineController.supportLatestBackupPath
                                              : "No backup archive has been created yet."
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    RowLayout {
                                        spacing: theme.spacing4

                                        ConsoleButton {
                                            text: "Export Backup"
                                            tone: "primary"
                                            enabled: engineController.operatorUiReady
                                            onClicked: engineController.exportSupportBackup()
                                        }

                                        ConsoleButton {
                                            text: "Open Backups"
                                            tone: "secondary"
                                            enabled: engineController.supportBackupDir.length > 0
                                            onClicked: engineController.openSupportBackupDirectory()
                                        }

                                        ConsoleButton {
                                            text: "Refresh"
                                            tone: "ghost"
                                            enabled: engineController.operatorUiReady
                                            onClicked: engineController.requestSupportSnapshot()
                                        }
                                    }
                                }
                            }

                            ConsoleSurface {
                                tone: "soft"
                                padding: theme.spacing6
                                Layout.fillWidth: true
                                implicitHeight: availableBackupsLayout.implicitHeight + 2 * padding

                                ColumnLayout {
                                    id: availableBackupsLayout
                                    anchors.fill: parent
                                    spacing: theme.spacing4

                                    Label {
                                        text: "Available Backups"
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                    }

                                    Label {
                                        visible: engineController.supportBackupCount === 0
                                        text: "No JSON backup archives are present in the backup directory."
                                        color: theme.studio300
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textSm
                                        wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                    }

                                    Repeater {
                                        model: Math.min(engineController.supportBackupFiles.length, 3)

                                        Rectangle {
                                            property var entry: engineController.supportBackupFiles[index]
                                            radius: theme.radiusBadge
                                            color: Qt.rgba(theme.surfaceDefault.r, theme.surfaceDefault.g, theme.surfaceDefault.b, 0.94)
                                            border.color: theme.surfaceBorder
                                            border.width: 1
                                            Layout.fillWidth: true
                                            implicitHeight: backupEntryLayout.implicitHeight + 2 * theme.spacing4

                                            ColumnLayout {
                                                id: backupEntryLayout
                                                anchors.fill: parent
                                                anchors.margins: theme.spacing4
                                                spacing: theme.spacing2

                                                Label {
                                                    text: entry.name
                                                    color: theme.studio050
                                                    font.family: theme.uiFontFamily
                                                    font.pixelSize: theme.textXs
                                                    font.weight: Font.DemiBold
                                                    wrapMode: Text.WrapAnywhere
                                                    Layout.fillWidth: true
                                                }

                                                Label {
                                                    text: root.rootWindow.formatFileSize(entry.sizeBytes)
                                                          + " | "
                                                          + root.rootWindow.formatUnixTimestamp(entry.modifiedAt)
                                                    color: theme.studio500
                                                    font.family: theme.uiFontFamily
                                                    font.pixelSize: theme.textXxs
                                                    wrapMode: Text.WordWrap
                                                    Layout.fillWidth: true
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            ConsoleSurface {
                                tone: "soft"
                                padding: theme.spacing6
                                Layout.fillWidth: true
                                implicitHeight: restoreDiagnosticsLayout.implicitHeight + 2 * padding

                                ColumnLayout {
                                    id: restoreDiagnosticsLayout
                                    anchors.fill: parent
                                    spacing: theme.spacing4

                                    Label {
                                        text: "Restore And Diagnostics"
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                    }
                                    Label {
                                        text: engineController.supportSnapshotLoaded
                                              ? engineController.supportRestoreDetails
                                              : "Support restore state is waiting for the engine."
                                        color: theme.studio050
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textSm
                                        wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                    }
                                    ConsoleTextField {
                                        Layout.fillWidth: true
                                        text: root.rootWindow.supportRestorePathDraft
                                        placeholderText: "Path to backup JSON"
                                        onTextChanged: root.rootWindow.supportRestorePathDraft = text
                                    }
                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: theme.spacing4

                                        ConsoleButton {
                                            text: "Restore Backup"
                                            tone: "primary"
                                            enabled: root.rootWindow.supportRestorePathDraft.trim().length > 0
                                                     && engineController.operatorUiReady
                                            onClicked: engineController.restoreSupportBackup(root.rootWindow.supportRestorePathDraft)
                                        }

                                        ConsoleButton {
                                            text: "Export Shell Diagnostics"
                                            tone: "secondary"
                                            onClicked: engineController.exportShellDiagnostics()
                                        }
                                    }
                                    Label {
                                        text: engineController.shellDiagnosticsExportPath.length > 0
                                              ? "Shell diagnostics: " + engineController.shellDiagnosticsExportPath
                                              : "No shell diagnostics bundle exported yet."
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                }
                            }

                            ConsoleSurface {
                                tone: "soft"
                                padding: theme.spacing6
                                Layout.fillWidth: true
                                implicitHeight: installUpdateLayout.implicitHeight + 2 * padding

                                ColumnLayout {
                                    id: installUpdateLayout
                                    anchors.fill: parent
                                    spacing: theme.spacing4

                                    Label {
                                        text: "Install And Update"
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                    }
                                    Label {
                                        text: "Use offline installers or the maintenance-tool update repository instead of background auto-updates."
                                        color: theme.studio050
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textSm
                                        wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: "Preferred installer for " + root.rootWindow.hostPlatformLabel() + ": " + root.rootWindow.hostInstallerArtifact()
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: "Update repository archive: " + root.rootWindow.hostUpdateArtifact()
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: "Current engine version: " + engineController.engineVersion + " | Protocol: " + engineController.protocolVersion
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                    }
                                }
                            }

                            ConsoleSurface {
                                tone: "soft"
                                padding: theme.spacing6
                                Layout.fillWidth: true
                                implicitHeight: runtimePathsLayout.implicitHeight + 2 * padding

                                ColumnLayout {
                                    id: runtimePathsLayout
                                    anchors.fill: parent
                                    spacing: theme.spacing4

                                    Label {
                                        text: "Runtime Paths"
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: theme.textXs
                                    }
                                    Label {
                                        text: "App data: " + engineController.appDataPath
                                        color: theme.studio050
                                        font.family: theme.monoFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: "Database: " + engineController.databasePath
                                        color: theme.studio500
                                        font.family: theme.monoFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: "Logs: " + engineController.logsPath
                                        color: theme.studio500
                                        font.family: theme.monoFontFamily
                                        font.pixelSize: theme.textXs
                                        wrapMode: Text.WrapAnywhere
                                        Layout.fillWidth: true
                                    }
                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: theme.spacing4

                                        ConsoleButton {
                                            text: "Open App Data"
                                            tone: "secondary"
                                            onClicked: engineController.openAppDataDirectory()
                                        }

                                        ConsoleButton {
                                            text: "Open Logs"
                                            tone: "secondary"
                                            onClicked: engineController.openLogsDirectory()
                                        }

                                        ConsoleButton {
                                            text: "Open Engine Log"
                                            tone: "ghost"
                                            enabled: engineController.engineLogPath.length > 0
                                            onClicked: engineController.openEngineLogFile()
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        }
    }
}
