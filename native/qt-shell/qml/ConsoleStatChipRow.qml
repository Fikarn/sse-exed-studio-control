import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Row {
    id: root

    property var stats: []
    property int chipSpacing: 8

    ConsoleTheme {
        id: theme
    }

    spacing: chipSpacing
    implicitHeight: theme.compactControlHeight

    function toneAccent(tone) {
        switch (tone) {
        case "ok":
            return theme.accentGreen
        case "warn":
            return theme.accentAmber
        case "down":
            return theme.accentRed
        case "primary":
            return theme.accentPrimary
        default:
            return theme.studio400
        }
    }

    Repeater {
        model: root.stats

        delegate: Rectangle {
            id: chipRect
            required property var modelData

            readonly property color accent: root.toneAccent(modelData && modelData.tone ? modelData.tone : "default")
            readonly property bool filled: modelData && modelData.tone && modelData.tone !== "default"

            height: theme.compactControlHeight
            width: chipRow.implicitWidth + 20
            radius: theme.radiusBadge
            color: filled ? Qt.rgba(accent.r, accent.g, accent.b, 0.12)
                          : Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.92)
            border.width: 1
            border.color: filled ? Qt.rgba(accent.r, accent.g, accent.b, 0.44) : theme.surfaceBorder

            RowLayout {
                id: chipRow
                anchors.centerIn: parent
                spacing: 8

                Label {
                    text: (chipRect.modelData && chipRect.modelData.label ? chipRect.modelData.label : "").toUpperCase()
                    color: theme.studio400
                    font.family: theme.monoFontFamily
                    font.pixelSize: theme.textXxs
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0.8
                }

                Label {
                    text: chipRect.modelData && chipRect.modelData.value !== undefined ? String(chipRect.modelData.value) : ""
                    color: chipRect.filled ? chipRect.accent : theme.studio050
                    font.family: theme.monoFontFamily
                    font.pixelSize: theme.textSm
                    font.weight: Font.DemiBold
                }
            }
        }
    }
}
