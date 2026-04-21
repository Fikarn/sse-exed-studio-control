import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root
    property var model: []
    property string activeId: ""
    property int activeIndex: {
        for (let i = 0; i < model.length; i += 1) {
            if (model[i].id === activeId) {
                return i
            }
        }
        return 0
    }

    signal segmentClicked(string id, int index)

    ConsoleTheme {
        id: theme
    }

    implicitHeight: 96
    implicitWidth: rowLayout.implicitWidth

    RowLayout {
        id: rowLayout
        anchors.fill: parent
        spacing: 4

        Repeater {
            model: root.model

            Item {
                id: segment
                required property var modelData
                required property int index
                readonly property bool isActive: segment.modelData.id === root.activeId
                readonly property bool isCompleted: segment.index < root.activeIndex
                readonly property bool isError: segment.modelData.status === "error"

                Layout.fillWidth: true
                Layout.minimumWidth: theme.stepIndicatorWidth
                Layout.preferredHeight: root.height

                Rectangle {
                    id: cell
                    anchors.fill: parent
                    radius: theme.radiusCard
                    color: segment.isActive
                           ? theme.bgStepActive
                           : segment.isCompleted
                             ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.04)
                             : theme.surfaceSoft
                    border.width: 1
                    border.color: segment.isActive
                                  ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.34)
                                  : theme.surfaceBorder

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: theme.spacing6
                        spacing: theme.spacing2

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: theme.spacing3

                            Rectangle {
                                Layout.preferredWidth: 22
                                Layout.preferredHeight: 22
                                radius: height / 2
                                color: segment.isError
                                       ? Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.18)
                                       : segment.isCompleted
                                         ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.22)
                                         : segment.isActive
                                           ? theme.accentPrimary
                                           : theme.surfaceBorder

                                Label {
                                    anchors.centerIn: parent
                                    text: segment.isCompleted ? "✓" : String(segment.index + 1)
                                    color: segment.isActive ? theme.studio950 : theme.studio100
                                    font.family: theme.monoFontFamily
                                    font.pixelSize: theme.textXxs
                                    font.weight: Font.DemiBold
                                }
                            }

                            Label {
                                text: segment.modelData.label || ""
                                color: segment.isActive ? theme.studio050 : theme.studio300
                                font.family: theme.uiFontFamily
                                font.pixelSize: theme.textSm
                                font.weight: segment.isActive ? Font.DemiBold : Font.Medium
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }
                        }

                        Label {
                            visible: (segment.modelData.summary || "").length > 0
                            text: segment.modelData.summary || ""
                            color: theme.studio500
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            elide: Text.ElideRight
                            wrapMode: Text.NoWrap
                            Layout.fillWidth: true
                        }

                        Item {
                            Layout.fillHeight: true
                        }
                    }

                    Rectangle {
                        visible: segment.isActive
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        height: 3
                        color: theme.accentPrimary
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.segmentClicked(segment.modelData.id, segment.index)
                }
            }
        }
    }
}
