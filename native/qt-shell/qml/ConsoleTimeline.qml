import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Shapes

Rectangle {
    id: root

    property date start: new Date()
    property date end: new Date()
    property date clockNow: new Date()
    property var lanes: []
    property string selectedBlockId: ""
    property bool laneCompressionActive: false
    property int laneHeight: theme.timelineLaneHeight
    property bool parityFrozen: false

    signal blockClicked(string taskId)
    signal blockDragReleased(string taskId, date newStart)
    signal selectionChangeRequested(string direction)
    signal dayNudgeRequested(int delta)
    signal scaleNudgeRequested(int hours)
    signal snapScaleToNowRequested()
    signal openSelectedBlockRequested()

    ConsoleTheme {
        id: theme
    }

    readonly property double totalSeconds: Math.max(1, (end.getTime() - start.getTime()) / 1000)
    readonly property double nowProgress: Math.max(0, Math.min(1, (clockNow.getTime() - start.getTime()) / (end.getTime() - start.getTime() || 1)))
    readonly property int laneHeadWidth: theme.timelineLaneHeadWidth
    readonly property int scaleHeight: theme.timelineScaleHeight

    color: "transparent"

    function secondsFromStart(dateValue) {
        return Math.max(0, (dateValue.getTime() - start.getTime()) / 1000)
    }

    function pixelsFromSeconds(seconds, bodyWidth) {
        if (totalSeconds <= 0 || bodyWidth <= 0) {
            return 0
        }
        return (seconds / totalSeconds) * bodyWidth
    }

    Keys.enabled: true
    Keys.onPressed: (event) => {
        if (event.key === Qt.Key_Left) {
            root.selectionChangeRequested("nudge-left")
            event.accepted = true
        } else if (event.key === Qt.Key_Right) {
            root.selectionChangeRequested("nudge-right")
            event.accepted = true
        } else if (event.key === Qt.Key_Up) {
            root.selectionChangeRequested("lane-up")
            event.accepted = true
        } else if (event.key === Qt.Key_Down) {
            root.selectionChangeRequested("lane-down")
            event.accepted = true
        } else if (event.key === Qt.Key_0) {
            root.snapScaleToNowRequested()
            event.accepted = true
        } else if (event.key === Qt.Key_BracketLeft) {
            if (event.modifiers & Qt.ShiftModifier) {
                root.dayNudgeRequested(-1)
            } else {
                root.scaleNudgeRequested(-1)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_BracketRight) {
            if (event.modifiers & Qt.ShiftModifier) {
                root.dayNudgeRequested(1)
            } else {
                root.scaleNudgeRequested(1)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.openSelectedBlockRequested()
            event.accepted = true
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            id: scaleRow
            Layout.fillWidth: true
            Layout.preferredHeight: root.scaleHeight
            color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.88)
            border.width: 0

            Rectangle {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: root.laneHeadWidth
                color: Qt.rgba(theme.surfaceDefault.r, theme.surfaceDefault.g, theme.surfaceDefault.b, 0.8)
                border.width: 0

                Label {
                    anchors.centerIn: parent
                    text: Qt.formatDate(root.start, "ddd d MMM")
                    color: theme.studio400
                    font.family: theme.monoFontFamily
                    font.pixelSize: theme.textXxs
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0.8
                }
            }

            Item {
                id: scaleBody
                anchors.left: parent.left
                anchors.leftMargin: root.laneHeadWidth
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom

                Repeater {
                    model: {
                        const hours = []
                        const startMs = root.start.getTime()
                        const endMs = root.end.getTime()
                        for (let t = startMs; t <= endMs; t += 3600000) {
                            hours.push(new Date(t))
                        }
                        return hours
                    }

                    delegate: Item {
                        required property var modelData
                        readonly property double secondsFrom: root.secondsFromStart(modelData)
                        x: root.pixelsFromSeconds(secondsFrom, scaleBody.width)
                        y: 0
                        width: 0
                        height: scaleBody.height

                        Rectangle {
                            width: 1
                            height: 6
                            color: theme.studio500
                            anchors.bottom: parent.bottom
                        }

                        Label {
                            anchors.bottom: parent.bottom
                            anchors.bottomMargin: 8
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: Qt.formatTime(parent.modelData, "HH:mm")
                            color: theme.studio400
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            font.weight: Font.DemiBold
                        }
                    }
                }
            }
        }

        ListView {
            id: laneList
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            interactive: false
            model: root.lanes
            spacing: 0
            boundsBehavior: Flickable.StopAtBounds

            delegate: Item {
                id: laneItem
                required property int index
                required property var modelData

                width: laneList.width
                height: root.laneHeight

                readonly property var laneBlocks: modelData && modelData.blocks ? modelData.blocks : []
                readonly property string laneTitle: modelData && modelData.title ? modelData.title : ""
                readonly property int runningTaskCount: modelData && modelData.runningTaskCount ? modelData.runningTaskCount : 0

                Rectangle {
                    anchors.fill: parent
                    color: index % 2 === 0 ? Qt.rgba(theme.timelineTrack.r, theme.timelineTrack.g, theme.timelineTrack.b, 0.70)
                                           : Qt.rgba(theme.timelineTrack.r, theme.timelineTrack.g, theme.timelineTrack.b, 0.82)
                    border.width: 0

                    Rectangle {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        height: 1
                        color: theme.surfaceStroke
                    }
                }

                Rectangle {
                    id: laneHead
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: root.laneHeadWidth
                    color: Qt.rgba(theme.surfaceDefault.r, theme.surfaceDefault.g, theme.surfaceDefault.b, 0.75)

                    Rectangle {
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        width: 1
                        color: theme.surfaceBorder
                    }

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: theme.spacing6
                        anchors.rightMargin: theme.spacing5
                        spacing: 8

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Label {
                                Layout.fillWidth: true
                                text: laneItem.laneTitle
                                color: theme.studio050
                                font.family: theme.uiFontFamily
                                font.pixelSize: theme.textSm
                                font.weight: Font.DemiBold
                                elide: Text.ElideRight
                            }

                            Label {
                                Layout.fillWidth: true
                                visible: laneItem.laneBlocks.length > 0
                                text: laneItem.laneBlocks.length + " " + (laneItem.laneBlocks.length === 1 ? "task" : "tasks")
                                color: theme.studio400
                                font.family: theme.monoFontFamily
                                font.pixelSize: theme.textXxs
                            }
                        }

                        ConsoleBadge {
                            visible: laneItem.runningTaskCount > 0
                            text: laneItem.runningTaskCount + "•LIVE"
                            tone: "rail"
                            badgeColor: theme.accentPrimary
                            uppercase: true
                        }
                    }
                }

                Item {
                    id: laneBody
                    anchors.left: parent.left
                    anchors.leftMargin: root.laneHeadWidth
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    clip: true

                    Repeater {
                        model: {
                            const ticks = []
                            const startMs = root.start.getTime()
                            const endMs = root.end.getTime()
                            for (let t = startMs; t <= endMs; t += 3600000) {
                                ticks.push(new Date(t))
                            }
                            return ticks
                        }

                        delegate: Rectangle {
                            required property var modelData
                            x: root.pixelsFromSeconds(root.secondsFromStart(modelData), laneBody.width)
                            y: 0
                            width: 1
                            height: laneBody.height
                            color: theme.timelineGridLine
                        }
                    }

                    Rectangle {
                        x: root.pixelsFromSeconds(root.secondsFromStart(root.clockNow), laneBody.width) - 30
                        y: 0
                        width: 60
                        height: laneBody.height
                        color: theme.timelineNowTint
                        visible: root.nowProgress > 0 && root.nowProgress < 1
                    }

                    Shape {
                        visible: root.nowProgress > 0 && root.nowProgress < 1
                        x: root.pixelsFromSeconds(root.secondsFromStart(root.clockNow), laneBody.width) - 2
                        y: 0
                        width: 4
                        height: laneBody.height

                        ShapePath {
                            strokeColor: theme.accentPrimary
                            strokeWidth: 2
                            fillColor: "transparent"
                            startX: 2
                            startY: 0
                            PathLine { x: 2; y: laneBody.height }
                        }
                    }

                    Repeater {
                        model: laneItem.laneBlocks

                        delegate: ConsoleScheduleBlock {
                            id: block
                            required property var modelData

                            readonly property string taskId: modelData && modelData.taskId ? modelData.taskId : ""
                            readonly property var blockStart: modelData && modelData.start ? modelData.start : root.start
                            readonly property int blockDuration: modelData && modelData.duration ? modelData.duration : 900

                            x: root.pixelsFromSeconds(root.secondsFromStart(blockStart), laneBody.width)
                            y: 6
                            width: Math.max(48, root.pixelsFromSeconds(blockDuration, laneBody.width))
                            height: laneBody.height - 12

                            title: modelData && modelData.title ? modelData.title : ""
                            meta: modelData && modelData.meta ? modelData.meta : ""
                            status: modelData && modelData.status ? modelData.status : "todo"
                            running: modelData && modelData.running ? true : false
                            blocked: modelData && modelData.blocked ? true : false
                            selected: root.selectedBlockId.length > 0 && root.selectedBlockId === taskId
                            parityFrozen: root.parityFrozen

                            onBlockClicked: root.blockClicked(taskId)
                            onDragFinished: (deltaX) => {
                                const secondsPerPixel = root.totalSeconds / Math.max(1, laneBody.width)
                                const deltaSeconds = Math.round((deltaX * secondsPerPixel) / 900) * 900
                                const newStart = new Date(blockStart.getTime() + deltaSeconds * 1000)
                                x = root.pixelsFromSeconds(root.secondsFromStart(blockStart), laneBody.width)
                                root.blockDragReleased(taskId, newStart)
                            }
                        }
                    }
                }
            }
        }
    }
}
