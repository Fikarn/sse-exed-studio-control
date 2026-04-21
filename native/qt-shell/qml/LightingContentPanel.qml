import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "LightingParityHelpers.js" as LightingParityHelpers

Rectangle {
    id: root
    objectName: "lighting-content-panel"
    required property var rootWindow
    required property var engineController
    required property string viewMode
    property bool embeddedChrome: false
    property var collapsedSections: ({})
    property var editingFixture: null
    property var pendingDeleteFixture: null
    signal viewModeSelected(string nextViewMode)
    signal addLightRequested()

    ConsoleTheme {
        id: theme
    }

    function toggleSection(sectionId) {
        const next = Object.assign({}, collapsedSections)
        next[sectionId] = !next[sectionId]
        collapsedSections = next
    }

    function sectionCollapsed(sectionId) {
        return !!collapsedSections[sectionId]
    }

    function fixtureCctMinimum(fixture) {
        return rootWindow.lightingFixtureMinCct(fixture.type)
    }

    function fixtureCctMaximum(fixture) {
        return rootWindow.lightingFixtureMaxCct(fixture.type)
    }

    function updateFixtureSelection(fixtureId) {
        engineController.updateLightingSettings({ "selectedFixtureId": fixtureId })
    }

    function openEditFixture(fixture) {
        root.updateFixtureSelection(fixture.id)
        root.editingFixture = fixture
    }

    function openDeleteFixture(fixture) {
        root.updateFixtureSelection(fixture.id)
        root.pendingDeleteFixture = fixture
    }

    function fixtureForVerify() {
        const fixtures = engineController ? engineController.lightingFixtures : []
        if (!fixtures || !fixtures.length) {
            return null
        }

        const selectedFixtureId = engineController ? engineController.lightingSelectedFixtureId : ""
        if (selectedFixtureId && selectedFixtureId.length > 0) {
            for (let index = 0; index < fixtures.length; index += 1) {
                if (fixtures[index].id === selectedFixtureId) {
                    return fixtures[index]
                }
            }
        }

        return fixtures[0]
    }

    function closeTransientDialogs() {
        root.editingFixture = null
        root.pendingDeleteFixture = null
    }

    function openFixtureEditDialogForVerify() {
        const fixture = root.fixtureForVerify()
        if (!fixture) {
            return false
        }

        root.closeTransientDialogs()
        root.openEditFixture(fixture)
        return true
    }

    function openFixtureDeleteDialogForVerify() {
        const fixture = root.fixtureForVerify()
        if (!fixture) {
            return false
        }

        root.closeTransientDialogs()
        root.openDeleteFixture(fixture)
        return true
    }

    visible: !!engineController && engineController.workspaceMode === "lighting"
    radius: theme.radiusCard
    color: root.embeddedChrome ? "transparent" : Qt.rgba(theme.studio950.r, theme.studio950.g, theme.studio950.b, 0.36)
    border.color: theme.surfaceBorder
    border.width: root.embeddedChrome ? 0 : 1
    Layout.fillWidth: true
    Layout.fillHeight: true

    ScrollView {
        anchors.fill: parent
        anchors.margins: root.viewMode === "spatial" ? 0 : 8
        clip: true
        contentWidth: availableWidth
        visible: root.viewMode !== "spatial"

        Item {
            width: parent.width
            implicitHeight: contentLayout.implicitHeight

            ColumnLayout {
                id: contentLayout
                width: parent.width
                spacing: theme.spacing4

                Item {
                    visible: !(engineController && engineController.lightingFixtures.length)
                    Layout.fillWidth: true
                    implicitHeight: emptyState.implicitHeight

                    ColumnLayout {
                        id: emptyState
                        anchors.horizontalCenter: parent.horizontalCenter
                        spacing: theme.spacing4

                        Label {
                            text: "No lights configured"
                            color: theme.studio300
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textMd
                            font.weight: Font.DemiBold
                            horizontalAlignment: Text.AlignHCenter
                        }

                        ConsoleButton {
                            text: "Add Light"
                            tone: "primary"
                            dense: true
                            onClicked: root.addLightRequested()
                        }
                    }
                }

                Repeater {
                    model: LightingParityHelpers.fixtureSections(
                               engineController ? engineController.lightingFixtures : [],
                               engineController ? engineController.lightingGroups : []
                           )

                    ConsoleSurface {
                        required property var modelData
                        readonly property var sectionState: LightingParityHelpers.sectionPowerState(modelData.fixtures)
                        tone: "soft"
                        padding: theme.spacing3
                        Layout.fillWidth: true
                        implicitHeight: sectionLayout.implicitHeight + theme.spacing3 * 2

                        ColumnLayout {
                            id: sectionLayout
                            anchors.fill: parent
                            spacing: 2

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: theme.spacing3

                                ConsoleButton {
                                    dense: true
                                    tone: "icon"
                                    iconText: root.sectionCollapsed(modelData.id) ? "+" : "\u2212"
                                    onClicked: root.toggleSection(modelData.id)
                                }

                                Label {
                                    text: modelData.name
                                    color: theme.studio100
                                    font.family: theme.uiFontFamily
                                    font.pixelSize: theme.textSm
                                    font.weight: Font.DemiBold
                                }

                                Rectangle {
                                    radius: theme.radiusPill
                                    color: theme.studio800
                                    border.width: 1
                                    border.color: theme.surfaceBorder
                                    implicitWidth: fixtureCountLabel.implicitWidth + 12
                                    implicitHeight: 14

                                    Label {
                                        id: fixtureCountLabel
                                        anchors.centerIn: parent
                                        text: modelData.fixtureCount
                                        color: theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: 10
                                        font.weight: Font.DemiBold
                                    }
                                }

                                Rectangle {
                                    radius: theme.radiusPill
                                    color: theme.studio800
                                    border.width: 1
                                    border.color: theme.surfaceBorder
                                    implicitWidth: liveCountLabel.implicitWidth + 12
                                    implicitHeight: 14

                                    Label {
                                        id: liveCountLabel
                                        anchors.centerIn: parent
                                        text: modelData.liveCount + " live"
                                        color: modelData.liveCount > 0 ? theme.accentGreen : theme.studio500
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: 10
                                        font.weight: Font.DemiBold
                                    }
                                }

                                Item { Layout.fillWidth: true }

                                Rectangle {
                                    radius: theme.radiusPill
                                    color: sectionState.backgroundColor
                                    border.width: 1
                                    border.color: Qt.rgba(theme.studio050.r, theme.studio050.g, theme.studio050.b, 0.08)
                                    implicitWidth: powerStateLabel.implicitWidth + 14
                                    implicitHeight: 14

                                    Label {
                                        id: powerStateLabel
                                        anchors.centerIn: parent
                                        text: sectionState.label
                                        color: sectionState.color
                                        font.family: theme.uiFontFamily
                                        font.pixelSize: 10
                                        font.weight: Font.DemiBold
                                    }
                                }
                            }

                            GridLayout {
                                visible: !root.sectionCollapsed(modelData.id) && root.viewMode === "expanded"
                                Layout.fillWidth: true
                                columns: width >= 900 ? 2 : 1
                                columnSpacing: theme.spacing3
                                rowSpacing: theme.spacing3

                                Repeater {
                                    model: modelData.fixtures

                                    Rectangle {
                                        required property var modelData
                                        readonly property var fixtureData: modelData
                                        readonly property int minimumCct: root.fixtureCctMinimum(modelData)
                                        readonly property int maximumCct: root.fixtureCctMaximum(modelData)
                                        readonly property var presetOptions: LightingParityHelpers.cctPresetOptions(minimumCct, maximumCct)
                                        readonly property var effectOptions: LightingParityHelpers.effectOptions()
                                        readonly property color accentColor: LightingParityHelpers.fixtureAccentColor(modelData)
                                        radius: theme.radiusCard
                                        color: modelData.on
                                               ? Qt.rgba(theme.studio850.r, theme.studio850.g, theme.studio850.b, 0.98)
                                               : Qt.rgba(theme.studio900.r, theme.studio900.g, theme.studio900.b, 0.86)
                                        border.width: engineController.lightingSelectedFixtureId === modelData.id ? 1.5 : 1
                                        border.color: engineController.lightingSelectedFixtureId === modelData.id
                                                      ? Qt.rgba(theme.accentBlue.r, theme.accentBlue.g, theme.accentBlue.b, 0.72)
                                                      : theme.surfaceBorder
                                        Layout.fillWidth: true
                                        implicitHeight: cardLayout.implicitHeight + 10

                                        Item {
                                            anchors.fill: parent
                                            z: -1

                                            TapHandler {
                                                onTapped: root.updateFixtureSelection(modelData.id)
                                            }
                                        }

                                        Rectangle {
                                            visible: modelData.on
                                            anchors.left: parent.left
                                            anchors.right: parent.right
                                            anchors.top: parent.top
                                            height: 2
                                            radius: theme.radiusCard
                                            color: accentColor
                                            opacity: 0.75
                                        }

                                        ColumnLayout {
                                            id: cardLayout
                                            anchors.fill: parent
                                            anchors.margins: 7
                                            spacing: 1

                                            RowLayout {
                                                Layout.fillWidth: true
                                                spacing: theme.spacing3

                                                Rectangle {
                                                    implicitWidth: 6
                                                    implicitHeight: 6
                                                    radius: 3
                                                    color: engineController.lightingEnabled && engineController.lightingReachable
                                                           ? theme.accentGreen
                                                           : theme.accentRed
                                                }

                                                Label {
                                                    text: modelData.name
                                                    color: theme.studio100
                                                    font.family: theme.uiFontFamily
                                                    font.pixelSize: theme.textSm
                                                    font.weight: Font.DemiBold
                                                    Layout.fillWidth: true
                                                    elide: Text.ElideRight
                                                }

                                                Rectangle {
                                                    radius: theme.radiusPill
                                                    color: Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.48)
                                                    border.width: 1
                                                    border.color: theme.surfaceBorder
                                                    implicitWidth: typeLabel.implicitWidth + 12
                                                    implicitHeight: 16

                                                    Label {
                                                        id: typeLabel
                                                        anchors.centerIn: parent
                                                        text: LightingParityHelpers.fixtureTypeBadgeLabel(modelData.type)
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: 10
                                                        font.weight: Font.Medium
                                                    }
                                                }

                                                RowLayout {
                                                    spacing: 2

                                                    ConsoleButton {
                                                        objectName: "lighting-fixture-edit-" + modelData.id
                                                        tone: "icon"
                                                        dense: true
                                                        iconText: "\u2699"
                                                        onClicked: root.openEditFixture(modelData)
                                                    }

                                                    ConsoleButton {
                                                        objectName: "lighting-fixture-delete-" + modelData.id
                                                        tone: "icon"
                                                        dense: true
                                                        iconText: "\u2715"
                                                        onClicked: root.openDeleteFixture(modelData)
                                                    }
                                                }

                                                ConsoleSwitch {
                                                    dense: true
                                                    checked: modelData.on
                                                    onToggled: engineController.setLightingFixturePower(modelData.id, checked)
                                                }
                                            }

                                            Label {
                                                text: "DMX " + modelData.dmxStartAddress + "  \u2022  "
                                                      + LightingParityHelpers.fixtureColorModeLabel(modelData) + "  \u2022  "
                                                      + modelData.intensity + "%"
                                                color: theme.studio400
                                                font.family: theme.uiFontFamily
                                                font.pixelSize: 10
                                                wrapMode: Text.WordWrap
                                                Layout.fillWidth: true
                                            }

                                            ColumnLayout {
                                                Layout.fillWidth: true
                                                spacing: 2

                                                RowLayout {
                                                    Layout.fillWidth: true

                                                    Label {
                                                        text: "Intensity"
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: theme.textXxs
                                                        font.weight: Font.Bold
                                                        font.capitalization: Font.AllUppercase
                                                        font.letterSpacing: 1.2
                                                        Layout.fillWidth: true
                                                    }

                                                    Label {
                                                        text: modelData.intensity + "%"
                                                        color: theme.studio300
                                                        font.family: theme.monoFontFamily
                                                        font.pixelSize: theme.textXxs
                                                    }
                                                }

                                                ConsoleSlider {
                                                    Layout.fillWidth: true
                                                    dense: true
                                                    from: 0
                                                    to: 100
                                                    stepSize: 1
                                                    value: modelData.intensity
                                                    fillColor: theme.accentAmber
                                                    onPressedChanged: {
                                                        if (!pressed) {
                                                            engineController.updateLightingFixture(modelData.id, { "intensity": Math.round(value) })
                                                        }
                                                    }
                                                }
                                            }

                                            ColumnLayout {
                                                Layout.fillWidth: true
                                                spacing: 2

                                                RowLayout {
                                                    Layout.fillWidth: true

                                                    Label {
                                                        text: "CCT"
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: theme.textXxs
                                                        font.weight: Font.Bold
                                                        font.capitalization: Font.AllUppercase
                                                        font.letterSpacing: 1.2
                                                        Layout.fillWidth: true
                                                    }

                                                    Label {
                                                        text: modelData.cct + "K"
                                                        color: theme.studio300
                                                        font.family: theme.monoFontFamily
                                                        font.pixelSize: theme.textXxs
                                                    }
                                                }

                                                ConsoleSlider {
                                                    Layout.fillWidth: true
                                                    dense: true
                                                    from: minimumCct
                                                    to: maximumCct
                                                    stepSize: 100
                                                    value: modelData.cct
                                                    fillColor: "#f8b55d"
                                                    trackColor: "#d5deea"
                                                    onPressedChanged: {
                                                        if (!pressed) {
                                                            engineController.updateLightingFixture(modelData.id, { "cct": Math.round(value / 100) * 100 })
                                                        }
                                                    }
                                                }

                                                RowLayout {
                                                    Layout.fillWidth: true
                                                    spacing: 2

                                                    Label {
                                                        text: minimumCct + "K"
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: 10
                                                    }

                                                    Item { Layout.fillWidth: true }

                                                    Label {
                                                        text: maximumCct + "K"
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: 10
                                                    }
                                                }
                                            }

                                            Flow {
                                                visible: presetOptions.length > 0
                                                Layout.fillWidth: true
                                                spacing: 4

                                                Repeater {
                                                    model: presetOptions

                                                    Rectangle {
                                                        required property var modelData
                                                        readonly property bool activePreset: fixtureData.cct === modelData.value
                                                        radius: theme.radiusPill
                                                        color: activePreset
                                                               ? (modelData.bordered
                                                                      ? Qt.rgba(theme.studio600.r, theme.studio600.g, theme.studio600.b, 0.96)
                                                                      : Qt.rgba(theme.studio600.r, theme.studio600.g, theme.studio600.b, 0.9))
                                                               : (modelData.bordered
                                                                      ? "transparent"
                                                                      : Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.28))
                                                        border.width: modelData.bordered ? 1 : 0
                                                        border.color: activePreset
                                                                      ? theme.studio500
                                                                      : Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.5)
                                                        implicitWidth: presetRow.implicitWidth + 10
                                                        implicitHeight: 18

                                                        RowLayout {
                                                            id: presetRow
                                                            anchors.centerIn: parent
                                                            spacing: 4

                                                            Rectangle {
                                                                implicitWidth: modelData.bordered ? 7 : 5
                                                                implicitHeight: implicitWidth
                                                                radius: modelData.bordered ? 2 : implicitWidth / 2
                                                                color: modelData.color
                                                            }

                                                            Label {
                                                                text: modelData.label
                                                                color: activePreset ? theme.studio100 : theme.studio500
                                                                font.family: theme.uiFontFamily
                                                                font.pixelSize: 10
                                                                font.weight: activePreset ? Font.Medium : Font.Normal
                                                            }
                                                        }

                                                        TapHandler {
                                                            onTapped: engineController.updateLightingFixture(fixtureData.id, { "cct": modelData.value })
                                                        }
                                                    }
                                                }
                                            }

                                            ColumnLayout {
                                                Layout.fillWidth: true
                                                spacing: 2

                                                RowLayout {
                                                    Layout.fillWidth: true
                                                    spacing: 4

                                                    Label {
                                                        text: "FX"
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: theme.textXxs
                                                        font.weight: Font.Bold
                                                        font.capitalization: Font.AllUppercase
                                                        font.letterSpacing: 1.2
                                                    }

                                                    Repeater {
                                                        model: effectOptions

                                                        ConsoleButton {
                                                            required property var modelData
                                                            tone: "chip"
                                                            active: fixtureData.effect && fixtureData.effect.type === modelData.id
                                                            compact: true
                                                            dense: true
                                                            text: modelData.label
                                                            onClicked: {
                                                                const currentEffect = fixtureData.effect
                                                                if (currentEffect && currentEffect.type === modelData.id) {
                                                                    engineController.updateLightingFixture(fixtureData.id, { "effect": null })
                                                                } else {
                                                                    engineController.updateLightingFixture(fixtureData.id, {
                                                                        "effect": {
                                                                            "type": modelData.id,
                                                                            "speed": currentEffect && currentEffect.speed ? currentEffect.speed : 5
                                                                        }
                                                                    })
                                                                }
                                                            }
                                                        }
                                                    }
                                                }

                                                RowLayout {
                                                    visible: !!fixtureData.effect
                                                    Layout.fillWidth: true
                                                    spacing: 2

                                                    Label {
                                                        text: "Speed"
                                                        color: theme.studio500
                                                        font.family: theme.uiFontFamily
                                                        font.pixelSize: theme.textXxs
                                                        font.weight: Font.Bold
                                                        font.capitalization: Font.AllUppercase
                                                        font.letterSpacing: 1.2
                                                    }

                                                    ConsoleSlider {
                                                        Layout.fillWidth: true
                                                        dense: true
                                                        from: 1
                                                        to: 10
                                                        stepSize: 1
                                                        value: fixtureData.effect ? fixtureData.effect.speed : 5
                                                        fillColor: theme.accentAmber
                                                        onPressedChanged: {
                                                            if (!pressed && fixtureData.effect) {
                                                                engineController.updateLightingFixture(fixtureData.id, {
                                                                    "effect": {
                                                                        "type": fixtureData.effect.type,
                                                                        "speed": Math.round(value)
                                                                    }
                                                                })
                                                            }
                                                        }
                                                    }

                                                    Label {
                                                        text: fixtureData.effect ? String(fixtureData.effect.speed) : ""
                                                        color: theme.studio300
                                                        font.family: theme.monoFontFamily
                                                        font.pixelSize: theme.textXxs
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                                ColumnLayout {
                                    visible: !root.sectionCollapsed(modelData.id) && root.viewMode === "compact"
                                    Layout.fillWidth: true
                                    spacing: 4

                                Repeater {
                                    model: modelData.fixtures

                                    Rectangle {
                                        required property var modelData
                                        radius: theme.radiusBadge
                                        color: Qt.rgba(theme.studio900.r, theme.studio900.g, theme.studio900.b, 0.82)
                                        border.width: 1
                                        border.color: engineController.lightingSelectedFixtureId === modelData.id
                                                      ? Qt.rgba(theme.accentBlue.r, theme.accentBlue.g, theme.accentBlue.b, 0.42)
                                                      : theme.surfaceBorder
                                        Layout.fillWidth: true
                                        implicitHeight: 42

                                        Item {
                                            anchors.fill: parent
                                            z: -1

                                            TapHandler {
                                                onTapped: root.updateFixtureSelection(modelData.id)
                                            }
                                        }

                                        RowLayout {
                                            anchors.fill: parent
                                            anchors.margins: 8
                                            spacing: theme.spacing3

                                            Rectangle {
                                                implicitWidth: 6
                                                implicitHeight: 6
                                                radius: 3
                                                color: modelData.on ? theme.accentGreen : theme.studio600
                                            }

                                            ColumnLayout {
                                                Layout.fillWidth: true
                                                spacing: 1

                                                Label {
                                                    text: modelData.name
                                                    color: theme.studio100
                                                    font.family: theme.uiFontFamily
                                                    font.pixelSize: theme.textXs
                                                    font.weight: Font.DemiBold
                                                    elide: Text.ElideRight
                                                }

                                                Label {
                                                    text: "DMX " + modelData.dmxStartAddress + "  \u2022  "
                                                          + modelData.intensity + "%  \u2022  " + modelData.cct + "K"
                                                    color: theme.studio500
                                                    font.family: theme.uiFontFamily
                                                    font.pixelSize: 10
                                                }
                                            }

                                            ConsoleSwitch {
                                                dense: true
                                                checked: modelData.on
                                                onToggled: engineController.setLightingFixturePower(modelData.id, checked)
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

    LightingFixtureDialog {
        open: root.editingFixture !== null
        rootWindow: root.rootWindow
        engineController: root.engineController
        fixtureData: root.editingFixture
        onCloseRequested: root.editingFixture = null
    }

    LightingDeleteFixtureDialog {
        open: root.pendingDeleteFixture !== null
        rootWindow: root.rootWindow
        engineController: root.engineController
        fixtureData: root.pendingDeleteFixture
        onCloseRequested: root.pendingDeleteFixture = null
    }

    LightingSpatialPlotPanel {
        id: spatialPlot
        objectName: "lighting-spatial-view"
        anchors.fill: parent
        anchors.margins: 10
        visible: root.viewMode === "spatial"
        rootWindow: root.rootWindow
        engineController: root.engineController
    }
}
