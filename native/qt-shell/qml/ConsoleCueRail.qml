import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root

    property var cues: []
    property string activeCueId: ""
    property string nextCueId: ""
    property string selectedCueId: ""
    property real goProgress: 0
    property bool disabled: false
    property bool compact: false

    signal go()
    signal back()
    signal cueSelected(string cueId)
    signal cueEdit(string cueId)
    signal cueDelete(string cueId)
    signal cueAdded(int ordinal)

    ConsoleTheme {
        id: theme
    }

    color: theme.surfaceDefault
    border.color: theme.surfaceBorder
    border.width: 1
    radius: theme.radiusCard

    readonly property int rowHeight: compact ? theme.cueRowHeightCompact : theme.cueRowHeight

    function cueById(id) {
        const list = root.cues || []
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === id) return list[i]
        }
        return null
    }

    function defaultNextCue() {
        const list = root.cues || []
        if (!list.length) return null
        if (!root.activeCueId) return list[0]
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === root.activeCueId && i + 1 < list.length) {
                return list[i + 1]
            }
        }
        return null
    }

    readonly property var activeCue: cueById(activeCueId)
    readonly property var computedNextCue: nextCueId.length > 0 ? cueById(nextCueId) : defaultNextCue()

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: theme.spacing4
        spacing: theme.spacing4

        ConsoleGoBar {
            Layout.fillWidth: true
            activeCueLabel: root.activeCue ? String(root.activeCue.label || "") : ""
            nextCueLabel: root.computedNextCue ? String(root.computedNextCue.label || "") : ""
            progress: root.goProgress
            disabled: root.disabled || (root.cues || []).length === 0
            onGo: root.go()
            onBack: root.back()
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: theme.spacing4

            Label {
                text: "RUN OF SHOW"
                color: theme.studio500
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXxs
                font.letterSpacing: 0.8
                font.weight: Font.DemiBold
                Layout.fillWidth: true
            }

            Label {
                text: (root.cues || []).length + " cues"
                color: theme.studio400
                font.family: theme.monoFontFamily
                font.pixelSize: theme.textXxs
            }

            ConsoleButton {
                text: "+ Add"
                tone: "chip"
                implicitHeight: 26
                onClicked: root.cueAdded((root.cues || []).length + 1)
            }
        }

        ListView {
            id: cueList
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: root.cues || []
            spacing: 4
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
                id: row
                required property var modelData

                readonly property bool isActive: row.modelData && row.modelData.id === root.activeCueId
                readonly property bool isNext: row.modelData && root.computedNextCue && row.modelData.id === root.computedNextCue.id
                readonly property bool isSelected: row.modelData && row.modelData.id === root.selectedCueId

                width: ListView.view ? ListView.view.width : 0
                height: root.rowHeight
                radius: theme.radiusBadge
                color: row.isActive ? theme.cueActiveTint
                      : row.isNext ? theme.cueNextHint
                      : row.isSelected ? Qt.rgba(theme.studio700.r, theme.studio700.g, theme.studio700.b, 0.6)
                      : theme.surfaceSoft
                border.width: row.isActive ? 2 : 1
                border.color: row.isActive ? theme.accentPrimary
                            : row.isSelected ? theme.surfaceBorderStrong
                            : theme.surfaceBorder

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: theme.spacing3
                    spacing: theme.spacing3

                    Label {
                        text: row.modelData && row.modelData.ordinal !== undefined
                              ? String(row.modelData.ordinal).padStart(3, "0") : "—"
                        color: theme.studio400
                        font.family: theme.monoFontFamily
                        font.pixelSize: theme.textXs
                        font.weight: Font.DemiBold
                        Layout.preferredWidth: 32
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0

                        Label {
                            Layout.fillWidth: true
                            text: row.modelData ? String(row.modelData.label || "Untitled") : ""
                            color: theme.studio050
                            font.family: theme.uiFontFamily
                            font.pixelSize: theme.textSm
                            font.weight: row.isActive ? Font.DemiBold : Font.Medium
                            elide: Text.ElideRight
                        }

                        Label {
                            Layout.fillWidth: true
                            visible: !root.compact
                            text: row.modelData
                                  ? "in " + ((Number(row.modelData.fadeInMs || 0) / 1000).toFixed(1)) + "s"
                                    + "  ·  out " + ((Number(row.modelData.fadeOutMs || 0) / 1000).toFixed(1)) + "s"
                                  : ""
                            color: theme.studio500
                            font.family: theme.monoFontFamily
                            font.pixelSize: theme.textXxs
                            elide: Text.ElideRight
                        }
                    }

                    ConsoleBadge {
                        visible: row.isActive
                        text: "LIVE"
                        badgeColor: theme.accentPrimary
                        filled: true
                        uppercase: true
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    acceptedButtons: Qt.LeftButton | Qt.RightButton
                    onClicked: function(mouse) {
                        if (row.modelData) {
                            root.cueSelected(row.modelData.id)
                            if (mouse.button === Qt.RightButton) {
                                root.cueEdit(row.modelData.id)
                            }
                        }
                    }
                    onDoubleClicked: {
                        if (row.modelData) {
                            root.cueEdit(row.modelData.id)
                        }
                    }
                }
            }
        }

        Label {
            Layout.fillWidth: true
            visible: (root.cues || []).length === 0
            text: "No cues yet. Tap + Add to queue one."
            color: theme.studio400
            font.family: theme.uiFontFamily
            font.pixelSize: theme.textXs
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
        }
    }

    Keys.onPressed: function(event) {
        if (root.disabled) return
        if (event.key === Qt.Key_Space) {
            root.go()
            event.accepted = true
        } else if (event.key === Qt.Key_Backspace) {
            root.back()
            event.accepted = true
        } else if (event.key === Qt.Key_Down || event.key === Qt.Key_Up) {
            const list = root.cues || []
            if (!list.length) return
            let idx = -1
            for (let i = 0; i < list.length; i += 1) {
                if (list[i].id === root.selectedCueId) { idx = i; break }
            }
            const next = event.key === Qt.Key_Down ? (idx + 1) % list.length
                                                   : (idx - 1 + list.length) % list.length
            root.cueSelected(list[next].id)
            event.accepted = true
        }
    }
}
