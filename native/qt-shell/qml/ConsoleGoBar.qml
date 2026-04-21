import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root

    property string activeCueLabel: ""
    property string nextCueLabel: ""
    property real progress: 0
    property bool disabled: false

    signal go()
    signal back()

    ConsoleTheme {
        id: theme
    }

    implicitHeight: 72
    color: theme.surfaceStrongTop
    border.color: theme.surfaceBorder
    border.width: 1
    radius: theme.radiusCard

    Rectangle {
        id: progressFill
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.margins: 1
        width: Math.max(0, Math.min(1, root.progress)) * (parent.width - 2)
        color: theme.timelineNowTint
        radius: theme.radiusCard
        visible: root.progress > 0 && root.progress < 1
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: theme.spacing6
        anchors.rightMargin: theme.spacing6
        anchors.topMargin: theme.spacing4
        anchors.bottomMargin: theme.spacing4
        spacing: theme.spacing6

        ConsoleButton {
            Layout.preferredWidth: 80
            Layout.fillHeight: true
            text: "BACK"
            tone: "ghost"
            enabled: !root.disabled
            onClicked: root.back()
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Label {
                text: "ACTIVE"
                color: theme.studio500
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXxs
                font.letterSpacing: 0.8
                font.weight: Font.DemiBold
            }
            Label {
                Layout.fillWidth: true
                text: root.activeCueLabel.length > 0 ? root.activeCueLabel : "—"
                color: theme.studio050
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textMd
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }
            Label {
                Layout.fillWidth: true
                text: root.nextCueLabel.length > 0 ? ("NEXT → " + root.nextCueLabel) : "no next cue queued"
                color: theme.studio400
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXs
                elide: Text.ElideRight
            }
        }

        ConsoleButton {
            Layout.preferredWidth: 140
            Layout.fillHeight: true
            text: "GO"
            tone: "primary"
            enabled: !root.disabled
            onClicked: root.go()
        }
    }
}
