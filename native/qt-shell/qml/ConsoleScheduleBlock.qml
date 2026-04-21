import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root

    property string title: ""
    property string meta: ""
    property string status: "todo"
    property bool running: false
    property bool blocked: false
    property bool selected: false
    property bool draggable: true
    property bool dragging: false
    property bool parityFrozen: false

    signal blockClicked()
    signal dragStarted()
    signal dragFinished(real deltaX)

    ConsoleTheme {
        id: theme
    }

    readonly property color statusTint: running ? theme.accentPrimary
                                       : blocked ? theme.accentRed
                                       : status === "done" ? theme.accentGreen
                                                           : theme.studio500

    radius: theme.scheduleBlockRadius
    color: running ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.22)
         : blocked ? Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.20)
         : status === "done" ? Qt.rgba(theme.accentGreen.r, theme.accentGreen.g, theme.accentGreen.b, 0.15)
                             : Qt.rgba(theme.studio800.r, theme.studio800.g, theme.studio800.b, 0.94)
    border.width: root.dragging ? 2 : 1
    border.color: selected ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.72)
                : root.dragging ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.85)
                                : Qt.rgba(root.statusTint.r, root.statusTint.g, root.statusTint.b, 0.38)

    Rectangle {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 2
        radius: parent.radius
        color: root.statusTint
    }

    SequentialAnimation on opacity {
        running: root.running && !root.parityFrozen
        loops: Animation.Infinite
        NumberAnimation { from: 0.82; to: 1.0; duration: 900; easing.type: Easing.InOutQuad }
        NumberAnimation { from: 1.0; to: 0.82; duration: 900; easing.type: Easing.InOutQuad }
    }

    TapHandler {
        onTapped: root.blockClicked()
    }

    DragHandler {
        enabled: root.draggable
        target: null
        xAxis.enabled: true
        yAxis.enabled: false

        property real startX: 0

        onActiveChanged: {
            if (active) {
                startX = root.x
                root.dragging = true
                root.dragStarted()
            } else {
                const delta = root.x - startX
                root.dragging = false
                root.dragFinished(delta)
            }
        }

        onTranslationChanged: {
            if (active) {
                root.x = startX + translation.x
            }
        }
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: theme.spacing5
        anchors.rightMargin: theme.spacing4
        anchors.topMargin: theme.spacing3
        anchors.bottomMargin: theme.spacing3
        spacing: 6

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 2

            Label {
                Layout.fillWidth: true
                text: root.title
                color: theme.studio050
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textXs
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }

            Label {
                Layout.fillWidth: true
                visible: root.meta.length > 0
                text: root.meta
                color: theme.studio400
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXxs
                elide: Text.ElideRight
            }
        }
    }
}
