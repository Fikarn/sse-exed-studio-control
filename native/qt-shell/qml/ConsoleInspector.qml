import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root

    property var selectionIds: []
    property var cueDelta: null
    property var engine: null
    property bool commissioningActive: false

    // external: which tab label is currently active ("fixture" | "group" | "cue" | "patch")
    readonly property string mode: {
        if (root.commissioningActive) return "patch"
        const n = (root.selectionIds || []).length
        if (n === 0) return "cue"
        if (n === 1) return "fixture"
        return "group"
    }

    signal fixtureChanged(string fixtureId, var changes)
    signal cueFieldChanged(string cueId, var changes)
    signal patchRequested()

    color: theme.surfaceDefault
    border.color: theme.surfaceBorder
    border.width: 1
    radius: theme.radiusCard

    ConsoleTheme {
        id: theme
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: theme.spacing4
        spacing: theme.spacing4

        Label {
            Layout.fillWidth: true
            text: "INSPECTOR · " + root.mode.toUpperCase()
            color: theme.studio500
            font.family: theme.monoFontFamily
            font.pixelSize: theme.textXxs
            font.letterSpacing: 0.8
            font.weight: Font.DemiBold
        }

        Loader {
            Layout.fillWidth: true
            Layout.fillHeight: true
            sourceComponent: {
                switch (root.mode) {
                case "fixture": return fixtureLayout
                case "group":   return groupLayout
                case "cue":     return cueLayout
                case "patch":   return patchLayout
                default:        return cueLayout
                }
            }
        }
    }

    Component {
        id: fixtureLayout

        ColumnLayout {
            spacing: theme.spacing4

            Label {
                text: "Fixture properties"
                color: theme.studio050
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textMd
                font.weight: Font.DemiBold
            }
            Label {
                Layout.fillWidth: true
                text: "Selected: " + (root.selectionIds && root.selectionIds.length
                                       ? String(root.selectionIds[0]) : "—")
                color: theme.studio300
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXs
                wrapMode: Text.WrapAnywhere
                elide: Text.ElideRight
            }
            Label {
                Layout.fillWidth: true
                text: "Intensity, CCT, rig height, and beam angle editors wire here."
                color: theme.studio400
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textXs
                wrapMode: Text.WordWrap
            }
            Item { Layout.fillHeight: true }
        }
    }

    Component {
        id: groupLayout

        ColumnLayout {
            spacing: theme.spacing4
            Label {
                text: "Group editor"
                color: theme.studio050
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textMd
                font.weight: Font.DemiBold
            }
            Label {
                text: (root.selectionIds || []).length + " fixtures selected"
                color: theme.studio400
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXs
            }
            Item { Layout.fillHeight: true }
        }
    }

    Component {
        id: cueLayout

        ColumnLayout {
            spacing: theme.spacing4
            Label {
                text: "Cue editor"
                color: theme.studio050
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textMd
                font.weight: Font.DemiBold
            }
            Label {
                Layout.fillWidth: true
                text: root.cueDelta ? "Editing cue" : "Select or add a cue to edit its fade, follow, and notes."
                color: theme.studio400
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textXs
                wrapMode: Text.WordWrap
            }
            Item { Layout.fillHeight: true }
        }
    }

    Component {
        id: patchLayout

        ColumnLayout {
            spacing: theme.spacing4
            Label {
                text: "Patch mode"
                color: theme.accentAmber
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textMd
                font.weight: Font.DemiBold
            }
            Label {
                Layout.fillWidth: true
                text: "Commissioning is active — fixture patch and DMX start addresses can be edited here."
                color: theme.studio300
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textXs
                wrapMode: Text.WordWrap
            }
            Item { Layout.fillHeight: true }
        }
    }
}
