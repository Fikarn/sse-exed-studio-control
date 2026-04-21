import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root

    property var tasks: []
    property bool expanded: false
    property int collapsedHeight: 28
    property int expandedHeight: 120

    signal taskDragStarted(string taskId)
    signal taskClicked(string taskId)

    ConsoleTheme {
        id: theme
    }

    readonly property int taskCount: tasks ? tasks.length : 0

    implicitHeight: expanded ? expandedHeight : collapsedHeight
    Behavior on implicitHeight { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

    color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.94)
    border.width: 1
    border.color: theme.surfaceBorder
    radius: theme.radiusCard

    RowLayout {
        id: collapsedRow
        visible: !root.expanded
        anchors.fill: parent
        anchors.leftMargin: theme.spacing6
        anchors.rightMargin: theme.spacing5
        spacing: 8

        Label {
            Layout.fillWidth: true
            text: "UNSCHEDULED (" + root.taskCount + ")"
            color: theme.studio400
            font.family: theme.monoFontFamily
            font.pixelSize: theme.textXxs
            font.weight: Font.DemiBold
            font.letterSpacing: 0.8
        }

        ConsoleButton {
            text: "Expand"
            tone: "ghost"
            dense: true
            enabled: root.taskCount > 0
            onClicked: {
                root.expanded = true
                root.expandedChanged()
            }
        }
    }

    ColumnLayout {
        visible: root.expanded
        anchors.fill: parent
        anchors.margins: theme.spacing5
        spacing: 6

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            Label {
                Layout.fillWidth: true
                text: "UNSCHEDULED (" + root.taskCount + ") — DRAG INTO A LANE TO SCHEDULE"
                color: theme.studio400
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXxs
                font.weight: Font.DemiBold
                font.letterSpacing: 0.8
            }

            ConsoleButton {
                text: "Collapse"
                tone: "ghost"
                dense: true
                onClicked: {
                    root.expanded = false
                    root.expandedChanged()
                }
            }
        }

        Flickable {
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: chipRow.implicitWidth
            contentHeight: height
            clip: true
            flickableDirection: Flickable.HorizontalFlick

            Row {
                id: chipRow
                spacing: 6

                Repeater {
                    model: root.tasks

                    delegate: Rectangle {
                        id: chip
                        required property var modelData

                        readonly property string taskId: modelData && modelData.id ? modelData.id : ""
                        readonly property string titleText: modelData && modelData.title ? modelData.title : ""

                        width: Math.max(120, titleLabel.implicitWidth + 20)
                        height: theme.controlHeight
                        radius: theme.radiusBadge
                        color: Qt.rgba(theme.surfaceRaised.r, theme.surfaceRaised.g, theme.surfaceRaised.b, 0.98)
                        border.width: 1
                        border.color: theme.surfaceBorder

                        Rectangle {
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.bottom: parent.bottom
                            width: 2
                            radius: parent.radius
                            color: theme.studio500
                        }

                        Label {
                            id: titleLabel
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 12
                            anchors.rightMargin: 8
                            text: chip.titleText
                            color: theme.studio100
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textXs
                            font.weight: Font.Medium
                            elide: Text.ElideRight
                        }

                        TapHandler {
                            onTapped: root.taskClicked(chip.taskId)
                        }

                        DragHandler {
                            target: null
                            onActiveChanged: {
                                if (active && chip.taskId.length > 0) {
                                    root.taskDragStarted(chip.taskId)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
