import QtQuick
import QtQuick.Controls
import QtQuick.Effects
import QtQuick.Layouts

Rectangle {
    id: root

    property string title: ""
    property string meta: ""
    property var tags: []
    property bool running: false
    property bool blocked: false
    property string handoffTarget: ""
    property string priority: ""
    property bool selected: false

    signal cardClicked()

    ConsoleTheme {
        id: theme
    }

    readonly property color statusTint: running ? theme.accentPrimary
                                       : blocked ? theme.accentRed
                                                 : theme.studio500

    implicitWidth: 248
    implicitHeight: contentColumn.implicitHeight + theme.spacing7 * 2
    radius: theme.radiusCard
    color: Qt.rgba(theme.surfaceRaised.r, theme.surfaceRaised.g, theme.surfaceRaised.b, 0.96)
    border.width: 1
    border.color: selected ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.72)
                           : theme.surfaceBorder

    layer.enabled: running
    layer.effect: MultiEffect {
        shadowEnabled: true
        shadowColor: theme.accentPrimaryGlow
        shadowVerticalOffset: 0
        shadowBlur: 0.35
        shadowOpacity: 0.8
    }

    Rectangle {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 2
        radius: parent.radius
        color: root.statusTint
    }

    TapHandler {
        onTapped: root.cardClicked()
    }

    ColumnLayout {
        id: contentColumn
        anchors.fill: parent
        anchors.leftMargin: theme.spacing7
        anchors.rightMargin: theme.spacing7
        anchors.topMargin: theme.spacing6
        anchors.bottomMargin: theme.spacing6
        spacing: 6

        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            Label {
                Layout.fillWidth: true
                text: root.title
                color: theme.studio050
                font.family: theme.uiFontFamily
                font.pixelSize: theme.textSm
                font.weight: Font.DemiBold
                elide: Text.ElideRight
                maximumLineCount: 2
                wrapMode: Text.WordWrap
            }

            ConsoleBadge {
                visible: root.priority.length > 0
                text: root.priority.toUpperCase()
                tone: "rail"
                uppercase: true
                badgeColor: root.priority === "urgent" ? theme.accentRed
                          : root.priority === "high" ? theme.accentAmber
                          : theme.studio500
            }
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

        Flow {
            Layout.fillWidth: true
            visible: root.tags && root.tags.length > 0
            spacing: 4

            Repeater {
                model: root.tags

                delegate: ConsoleBadge {
                    required property var modelData
                    text: String(modelData)
                    tone: "rail"
                    badgeColor: theme.studio500
                }
            }
        }

        Label {
            Layout.fillWidth: true
            visible: root.handoffTarget.length > 0
            text: "→ " + root.handoffTarget
            color: theme.studio400
            font.family: theme.monoFontFamily
            font.pixelSize: theme.textXxs
            elide: Text.ElideRight
        }
    }
}
