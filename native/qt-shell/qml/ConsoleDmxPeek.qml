import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

RowLayout {
    id: root

    property var channels: []
    property bool stale: false
    property int visibleCount: 12

    signal channelClicked(int index)
    signal openFullMonitor()

    spacing: 4

    ConsoleTheme {
        id: theme
    }

    Repeater {
        model: Math.min(root.visibleCount, (root.channels || []).length)

        delegate: Rectangle {
            id: cell
            required property int index

            readonly property var channel: (root.channels || [])[index] || { "index": index + 1, "value": 0, "stale": false }
            readonly property real normalized: Math.max(0, Math.min(1, Number(channel.value || 0) / 255))

            Layout.fillWidth: true
            Layout.preferredHeight: 36
            radius: theme.radiusBadge
            color: channel.stale || root.stale ? theme.dmxUnreachableTint : theme.surfaceSoft
            border.width: 1
            border.color: channel.stale || root.stale ? theme.accentRed : theme.surfaceBorder

            Rectangle {
                anchors.bottom: parent.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.margins: 1
                height: Math.max(2, (parent.height - 2) * cell.normalized)
                color: theme.accentPrimary
                opacity: channel.stale || root.stale ? 0.35 : 0.7
                radius: theme.radiusBadge
            }

            Label {
                anchors.centerIn: parent
                text: String(Math.round(Number(cell.channel.value || 0)))
                color: theme.studio200
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXxs
                font.weight: Font.DemiBold
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    root.channelClicked(cell.channel.index !== undefined ? cell.channel.index : cell.index + 1)
                    root.openFullMonitor()
                }
            }
        }
    }
}
