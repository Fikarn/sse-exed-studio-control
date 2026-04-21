import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

RowLayout {
    id: root

    property var items: []
    property int maxVisible: 6
    property string activeId: ""

    signal chipClicked(string id)
    signal overflowRequested(var hiddenItems)

    spacing: 6

    ConsoleTheme {
        id: theme
    }

    function toneAccent(tone) {
        switch (tone) {
        case "ok":
            return theme.accentGreen
        case "warn":
            return theme.accentAmber
        case "danger":
            return theme.accentRed
        case "primary":
            return theme.accentPrimary
        default:
            return theme.studio400
        }
    }

    readonly property var visibleItems: (root.items || []).slice(0, root.maxVisible)
    readonly property var hiddenItems: (root.items || []).slice(root.maxVisible)

    Repeater {
        model: root.visibleItems

        delegate: Rectangle {
            id: chip
            required property var modelData

            readonly property bool isActive: chip.modelData && chip.modelData.id === root.activeId
            readonly property color accent: root.toneAccent(chip.modelData && chip.modelData.tone
                                                              ? chip.modelData.tone : "default")

            height: theme.compactControlHeight
            implicitWidth: chipRow.implicitWidth + 20
            radius: theme.radiusPill
            color: chip.isActive ? Qt.rgba(chip.accent.r, chip.accent.g, chip.accent.b, 0.22)
                                 : Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.9)
            border.width: 1
            border.color: chip.isActive ? chip.accent : theme.surfaceBorder

            RowLayout {
                id: chipRow
                anchors.centerIn: parent
                spacing: 6

                Label {
                    text: chip.modelData && chip.modelData.label ? String(chip.modelData.label) : ""
                    color: chip.isActive ? chip.accent : theme.studio050
                    font.family: theme.uiFontFamily
                    font.pixelSize: theme.textXs
                    font.weight: Font.DemiBold
                }

                Label {
                    visible: chip.modelData && chip.modelData.meta !== undefined && String(chip.modelData.meta).length > 0
                    text: chip.modelData && chip.modelData.meta !== undefined ? String(chip.modelData.meta) : ""
                    color: theme.studio400
                    font.family: theme.monoFontFamily
                    font.pixelSize: theme.textXxs
                }
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    if (chip.modelData && chip.modelData.id !== undefined) {
                        root.chipClicked(String(chip.modelData.id))
                    }
                }
            }
        }
    }

    Rectangle {
        visible: root.hiddenItems.length > 0
        height: theme.compactControlHeight
        implicitWidth: overflowLabel.implicitWidth + 20
        radius: theme.radiusPill
        color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.9)
        border.width: 1
        border.color: theme.surfaceBorder

        Label {
            id: overflowLabel
            anchors.centerIn: parent
            text: "+" + root.hiddenItems.length
            color: theme.studio300
            font.family: theme.monoFontFamily
            font.pixelSize: theme.textXs
            font.weight: Font.DemiBold
        }

        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.overflowRequested(root.hiddenItems)
        }
    }
}
