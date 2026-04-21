import QtQuick
import QtQuick.Controls
import QtQuick.Effects
import QtQuick.Layouts

Rectangle {
    id: root
    property string text: ""
    property color badgeColor: theme.studio600
    property color textColor: theme.studio100
    property bool filled: false
    property bool uppercase: false
    property string tone: "default"

    ConsoleTheme {
        id: theme
    }

    readonly property bool isOperator: tone === "operator"
    readonly property bool isRail: tone === "rail"

    radius: isRail ? 4 : theme.radiusPill
    color: filled ? badgeColor : Qt.rgba(badgeColor.r, badgeColor.g, badgeColor.b, isRail ? 0.08 : 0.12)
    border.width: isRail ? 0 : 1
    border.color: Qt.rgba(badgeColor.r, badgeColor.g, badgeColor.b, filled ? 0.18 : 0.55)
    implicitHeight: isOperator ? 30 : isRail ? 16 : 24
    implicitWidth: badgeLabel.implicitWidth + (isOperator ? 24 : isRail ? 10 : 18)

    layer.enabled: isOperator
    layer.effect: MultiEffect {
        shadowEnabled: true
        shadowColor: theme.elevation1Shadow
        shadowVerticalOffset: theme.elevation1OffsetY
        shadowBlur: theme.elevation1Blur / 32.0
        shadowOpacity: 0.8
    }

    Label {
        id: badgeLabel
        anchors.centerIn: parent
        text: root.uppercase ? root.text.toUpperCase() : root.text
        color: root.filled ? theme.studio950 : root.textColor
        font.family: root.isRail ? theme.monoFontFamily : theme.uiFontFamily
        font.pixelSize: root.isOperator ? theme.textXs : theme.textXxs
        font.weight: root.isOperator ? Font.Bold : Font.DemiBold
        font.capitalization: root.uppercase ? Font.AllUppercase : Font.MixedCase
        font.letterSpacing: root.uppercase ? (root.isRail ? 0.6 : 0.8) : 0
    }
}
