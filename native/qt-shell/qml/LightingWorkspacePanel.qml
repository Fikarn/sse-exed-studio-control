import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "LightingParityHelpers.js" as LightingHelpers

Item {
    id: root
    objectName: "lighting-workspace-panel"
    required property var rootWindow
    required property var engineController
    property bool persistState: true
    property real scaleFactor: 1.0
    property bool parityFrozen: false
    property string selectedCueId: ""
    property bool dmxOverlayVisible: false
    property var editingFixture: null
    property var pendingDeleteFixture: null
    property bool addFixtureDialogOpen: false

    function lightingFixtureById(fixtureId) {
        const list = root.lightingFixtures || []
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === fixtureId) return list[i]
        }
        return null
    }

    signal requestAddFixtureDialog()
    signal requestFixtureEdit(string fixtureId)
    signal requestFixtureDelete(string fixtureId)

    ConsoleTheme {
        id: theme
    }

    visible: !!engineController && engineController.workspaceMode === "lighting"
    Layout.fillWidth: true
    Layout.fillHeight: true

    readonly property bool compact: width < 2400
    readonly property int cueRailWidth: compact ? theme.cueRailWidth1080 : theme.cueRailWidth2k
    readonly property int inspectorWidth: compact ? theme.inspectorWidth1080 : theme.inspectorWidth2k
    readonly property int controlStripHeight: compact ? theme.controlStripHeight1080 : theme.controlStripHeight2k

    readonly property var lightingFixtures: engineController ? engineController.lightingFixtures : []
    readonly property var lightingGroups: engineController ? engineController.lightingGroups : []
    readonly property var lightingScenes: engineController ? engineController.lightingScenes : []
    readonly property var lightingCues: engineController ? engineController.lightingCues : []
    readonly property string activeCueId: engineController ? engineController.lightingActiveCueId : ""
    readonly property string selectedFixtureId: engineController ? engineController.lightingSelectedFixtureId : ""
    readonly property var dmxChannels: engineController ? engineController.lightingDmxChannels : []
    readonly property bool lightingReachable: engineController ? engineController.lightingReachable : false

    function contentFitsViewport() {
        return lightingToolbarPanel.height
             + mainRow.height
             + controlStrip.height
             + rootColumn.spacing * 2
             <= height + 1
    }

    function closeTransientDialogs() {
        root.addFixtureDialogOpen = false
        root.editingFixture = null
        root.pendingDeleteFixture = null
        root.dmxOverlayVisible = false
    }

    function openAddFixtureDialogForVerify() {
        root.editingFixture = null
        root.addFixtureDialogOpen = true
        return true
    }

    function openFixtureEditDialogForVerify() {
        if (!root.selectedFixtureId) return false
        const fixture = root.lightingFixtureById(root.selectedFixtureId)
        if (!fixture) return false
        root.addFixtureDialogOpen = false
        root.editingFixture = fixture
        return true
    }

    function openFixtureDeleteDialogForVerify() {
        if (!root.selectedFixtureId) return false
        const fixture = root.lightingFixtureById(root.selectedFixtureId)
        if (!fixture) return false
        root.pendingDeleteFixture = fixture
        return true
    }

    function openDeleteSceneDialogForVerify() { return false }
    function openRenameSceneDialogForVerify() { return false }
    function openRenameGroupDialogForVerify() { return false }
    function openDeleteGroupDialogForVerify() { return false }

    function fireNextCue() {
        if (!engineController) return
        const cues = root.lightingCues || []
        if (!cues.length) return
        let target = ""
        if (!root.activeCueId.length) {
            target = cues[0].id
        } else {
            for (let i = 0; i < cues.length - 1; i += 1) {
                if (cues[i].id === root.activeCueId) {
                    target = cues[i + 1].id
                    break
                }
            }
        }
        if (target) {
            engineController.fireLightingCue(target, undefined)
        }
    }

    function firePreviousCue() {
        if (!engineController) return
        const cues = root.lightingCues || []
        if (!cues.length || !root.activeCueId.length) return
        for (let i = 1; i < cues.length; i += 1) {
            if (cues[i].id === root.activeCueId) {
                engineController.fireLightingCue(cues[i - 1].id, undefined)
                return
            }
        }
    }

    function addCueAfterSelection() {
        if (!engineController) return
        const cues = root.lightingCues || []
        const label = "Cue " + (cues.length + 1)
        const payload = { "label": label }
        if (root.selectedCueId.length) {
            payload.afterCueId = root.selectedCueId
        }
        engineController.createLightingCue(payload)
    }

    function selectFixture(fixtureId) {
        if (!engineController) return
        engineController.updateLightingSettings({
            "selectedFixtureId": fixtureId && fixtureId.length ? fixtureId : null
        })
    }

    function persistFixtureDrag(fixtureId, normX, normY) {
        if (!engineController) return
        engineController.updateLightingFixture(fixtureId, {
            "spatialX": normX,
            "spatialY": normY
        })
    }

    Item {
        anchors.fill: parent

        Item {
            width: parent.width / root.scaleFactor
            height: parent.height / root.scaleFactor
            scale: root.scaleFactor
            transformOrigin: Item.TopLeft

            ColumnLayout {
                id: rootColumn
                anchors.fill: parent
                spacing: 6

                LightingToolbarPanel {
                    id: lightingToolbarPanel
                    rootWindow: root.rootWindow
                    engineController: root.engineController
                    Layout.fillWidth: true
                }

                RowLayout {
                    id: mainRow
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 6

                    // CUE RAIL (left)
                    ConsoleCueRail {
                        id: cueRail
                        Layout.preferredWidth: root.cueRailWidth
                        Layout.fillHeight: true
                        cues: root.lightingCues
                        activeCueId: root.activeCueId
                        selectedCueId: root.selectedCueId
                        disabled: !root.lightingReachable && root.activeCueId.length > 0
                        compact: root.compact

                        onGo: root.fireNextCue()
                        onBack: root.firePreviousCue()
                        onCueSelected: function(cueId) { root.selectedCueId = cueId }
                        onCueAdded: root.addCueAfterSelection()
                        onCueEdit: function(cueId) { root.selectedCueId = cueId }
                        onCueDelete: function(cueId) {
                            if (root.engineController) {
                                root.engineController.deleteLightingCue(cueId)
                            }
                        }
                    }

                    // STAGE PLOT (center)
                    ConsoleStagePlot {
                        id: stagePlot
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        fixtures: root.lightingFixtures
                        selectionIds: root.selectedFixtureId.length ? [root.selectedFixtureId] : []
                        parityFrozen: root.parityFrozen

                        onFixtureClicked: function(fixtureId) { root.selectFixture(fixtureId) }
                        onFixtureDragReleased: function(fixtureId, x, y) { root.persistFixtureDrag(fixtureId, x, y) }
                        onEmptyCanvasClicked: root.selectFixture("")
                    }

                    // INSPECTOR (right)
                    ConsoleInspector {
                        id: inspector
                        Layout.preferredWidth: root.inspectorWidth
                        Layout.fillHeight: true
                        selectionIds: root.selectedFixtureId.length ? [root.selectedFixtureId] : []
                        engine: root.engineController
                        commissioningActive: root.engineController
                                             && root.engineController.commissioningStage !== "ready"
                    }
                }

                // CONTROL STRIP (bottom)
                Rectangle {
                    id: controlStrip
                    Layout.fillWidth: true
                    Layout.preferredHeight: root.controlStripHeight
                    color: theme.surfaceDefault
                    border.color: theme.surfaceBorder
                    border.width: 1
                    radius: theme.radiusCard

                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: theme.spacing4
                        spacing: theme.spacing6

                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            spacing: 4

                            Label {
                                text: "GROUPS"
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                                font.letterSpacing: 0.8
                                font.weight: Font.DemiBold
                            }

                            ConsoleChipRow {
                                Layout.fillWidth: true
                                items: {
                                    const groups = root.lightingGroups || []
                                    return groups.map(function(g) {
                                        return { "id": g.id, "label": g.name, "meta": g.fixtureCount, "tone": "default" }
                                    })
                                }
                                maxVisible: root.compact ? 4 : 6
                            }
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            spacing: 4

                            Label {
                                text: "SCENES"
                                color: theme.studio500
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                                font.letterSpacing: 0.8
                                font.weight: Font.DemiBold
                            }

                            ConsoleChipRow {
                                Layout.fillWidth: true
                                items: {
                                    const scenes = root.lightingScenes || []
                                    return scenes.map(function(s) {
                                        return {
                                            "id": s.id,
                                            "label": s.name,
                                            "tone": s.lastRecalled ? "primary" : "default"
                                        }
                                    })
                                }
                                maxVisible: root.compact ? 4 : 6
                                onChipClicked: function(id) {
                                    if (root.engineController) {
                                        root.engineController.recallLightingScene(id, 0.0)
                                    }
                                }
                            }
                        }

                        ColumnLayout {
                            Layout.preferredWidth: root.compact ? 280 : 360
                            Layout.fillHeight: true
                            spacing: 4

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 6
                                Label {
                                    text: "DMX PEEK"
                                    color: theme.studio500
                                    font.family: theme.monoFontFamily
                                    font.pixelSize: theme.textXxs
                                    font.letterSpacing: 0.8
                                    font.weight: Font.DemiBold
                                    Layout.fillWidth: true
                                }
                                ConsoleBadge {
                                    text: root.lightingReachable ? "ONLINE" : "UNREACHABLE"
                                    badgeColor: root.lightingReachable ? theme.accentGreen : theme.accentRed
                                    filled: true
                                    uppercase: true
                                }
                            }

                            ConsoleDmxPeek {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                channels: root.dmxChannels
                                stale: !root.lightingReachable
                                visibleCount: 12
                                onOpenFullMonitor: root.dmxOverlayVisible = true
                            }
                        }
                    }
                }
            }
        }
    }

    // Retained standalone dialogs (per spec §10 — untouched)
    LightingFixtureDialog {
        id: fixtureDialog
        rootWindow: root.rootWindow
        engineController: root.engineController
        open: root.addFixtureDialogOpen || root.editingFixture !== null
        fixtureData: root.editingFixture
        onCloseRequested: {
            root.addFixtureDialogOpen = false
            root.editingFixture = null
        }
    }

    LightingDeleteFixtureDialog {
        id: deleteFixtureDialog
        rootWindow: root.rootWindow
        engineController: root.engineController
        open: root.pendingDeleteFixture !== null
        fixtureData: root.pendingDeleteFixture
        onCloseRequested: root.pendingDeleteFixture = null
    }

    // DMX full-universe overlay — opened by Ctrl+M or the peek strip
    Rectangle {
        anchors.fill: parent
        visible: root.dmxOverlayVisible
        color: theme.overlayScrim
        z: 50

        MouseArea {
            anchors.fill: parent
            onClicked: root.dmxOverlayVisible = false
        }

        LightingDmxMonitorPanel {
            anchors.centerIn: parent
            width: Math.min(1400, parent.width - 120)
            height: Math.min(900, parent.height - 120)
            engineController: root.engineController
        }
    }
}
