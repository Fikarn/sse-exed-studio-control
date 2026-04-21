import QtQuick
import QtQuick.Controls
import QtQuick.Shapes
import QtQuick.Effects
import "LightingParityHelpers.js" as LightingHelpers

Item {
    id: root

    property int cct: 5600
    property int intensity: 100
    property bool on: false
    property real beamRotation: 0
    property bool selected: false
    property bool stale: false
    property string kind: "profile"
    property string label: ""
    property bool parityFrozen: false
    property int dotRadius: 22
    property real beamAngleDegrees: 40
    property int beamReach: 120

    signal clicked()

    implicitWidth: dotRadius * 2
    implicitHeight: dotRadius * 2

    ConsoleTheme {
        id: theme
    }

    readonly property color fixtureColor: LightingHelpers.kelvinToColor(cct)
    readonly property real intensityFactor: Math.max(0.12, Math.min(1.0, intensity / 100))

    Shape {
        id: beamCone
        anchors.centerIn: parent
        visible: on && !root.stale
        width: root.beamReach * 2
        height: root.beamReach * 2
        layer.enabled: !root.parityFrozen
        layer.samples: 4

        ShapePath {
            strokeWidth: 0
            strokeColor: "transparent"
            fillColor: Qt.rgba(root.fixtureColor.r, root.fixtureColor.g, root.fixtureColor.b,
                               root.intensityFactor * 0.28)

            startX: beamCone.width / 2
            startY: beamCone.height / 2

            PathAngleArc {
                centerX: beamCone.width / 2
                centerY: beamCone.height / 2
                radiusX: root.beamReach
                radiusY: root.beamReach
                startAngle: -90 + root.beamRotation - root.beamAngleDegrees / 2
                sweepAngle: root.beamAngleDegrees
                moveToStart: false
            }

            PathLine {
                x: beamCone.width / 2
                y: beamCone.height / 2
            }
        }
    }

    Rectangle {
        id: dot
        anchors.centerIn: parent
        width: root.dotRadius * 2
        height: root.dotRadius * 2
        radius: width / 2
        color: root.on ? Qt.rgba(root.fixtureColor.r, root.fixtureColor.g, root.fixtureColor.b, root.intensityFactor)
                       : Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.9)
        border.width: root.stale ? 2 : (root.selected ? 2 : 1)
        border.color: root.stale ? theme.accentRed
                     : root.selected ? theme.accentPrimary
                     : theme.surfaceBorder

        Label {
            anchors.centerIn: parent
            text: root.label
            color: root.on ? theme.studio950 : theme.studio200
            font.family: theme.monoFontFamily
            font.pixelSize: theme.textXxs
            font.weight: Font.DemiBold
            visible: root.label.length > 0
        }
    }

    MultiEffect {
        anchors.fill: dot
        source: dot
        visible: root.on && !root.parityFrozen && !root.stale
        blurEnabled: true
        blurMax: 16
        blur: 0.4
        brightness: 0.2
    }

    MouseArea {
        anchors.fill: dot
        onClicked: root.clicked()
        cursorShape: Qt.PointingHandCursor
    }
}
