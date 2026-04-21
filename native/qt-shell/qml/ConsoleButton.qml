import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Button {
    id: root
    property string tone: "secondary"
    property bool active: false
    property bool compact: false
    property string iconText: ""
    property string iconFontFamily: theme.uiFontFamily
    property bool dense: false
    property string subtitle: ""
    property string iconSvgName: ""
    property int iconSvgPixelSize: tone === "workspaceTab" ? 18 : 16
    property int iconPixelSize: tone === "icon"
                                 ? (dense ? theme.textXs : theme.textSm)
                                 : (dense ? theme.textXxs : theme.textXs)

    ConsoleTheme {
        id: theme
    }

    implicitHeight: tone === "workspaceTab" ? theme.toolbarHeight
                   : tone === "monoRail" ? 22
                   : compact || dense ? theme.compactControlHeight
                   : theme.controlHeight
    implicitWidth: Math.max(background ? background.implicitWidth : 0, contentRow.implicitWidth + leftPadding + rightPadding)
    leftPadding: tone === "icon" ? 0
                : tone === "workspaceTab" ? (iconSvgName.length > 0 ? 16 : 14)
                : tone === "monoRail" ? 6
                : iconText.length > 0 ? (dense ? 9 : 10) : (dense ? 10 : 12)
    rightPadding: tone === "icon" ? 0
                 : tone === "workspaceTab" ? 18
                 : tone === "monoRail" ? 6
                 : dense ? 10 : 12
    topPadding: 0
    bottomPadding: 0
    hoverEnabled: true
    focusPolicy: Qt.StrongFocus

    function backgroundColor() {
        if (!enabled) {
            return Qt.rgba(theme.studio700.r, theme.studio700.g, theme.studio700.b, 0.18)
        }

        if (tone === "icon") {
            if (root.active) {
                return root.down ? Qt.rgba(theme.accentBlue.r, theme.accentBlue.g, theme.accentBlue.b, 0.22)
                                 : root.hovered ? Qt.rgba(theme.accentBlue.r, theme.accentBlue.g, theme.accentBlue.b, 0.18)
                                                : Qt.rgba(theme.accentBlue.r, theme.accentBlue.g, theme.accentBlue.b, 0.12)
            }

            return root.down ? Qt.rgba(theme.studio700.r, theme.studio700.g, theme.studio700.b, 0.72)
                             : root.hovered ? Qt.rgba(theme.studio700.r, theme.studio700.g, theme.studio700.b, 0.5)
                                            : Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.92)
        }

        if (tone === "danger") {
            return root.down ? Qt.darker(theme.accentRed, 1.18)
                             : root.hovered ? Qt.lighter(theme.accentRed, 1.04)
                                            : Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.16)
        }

        if (tone === "primary") {
            return root.down ? Qt.darker(theme.accentPrimary, 1.18)
                             : root.hovered ? Qt.lighter(theme.accentPrimary, 1.04)
                                            : theme.accentPrimary
        }

        if (tone === "ghost") {
            return root.down ? Qt.rgba(theme.studio700.r, theme.studio700.g, theme.studio700.b, 0.48)
                             : root.hovered ? Qt.rgba(theme.studio700.r, theme.studio700.g, theme.studio700.b, 0.32)
                                            : "transparent"
        }

        if (tone === "chip") {
            return active ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.16)
                          : root.down ? theme.studio700
                                      : root.hovered ? theme.studio700 : theme.surfaceSoft
        }

        if (tone === "tab") {
            if (active) {
                return Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.14)
            }

            return root.down ? Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.86)
                             : root.hovered ? Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.64)
                                            : Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.86)
        }

        if (tone === "workspaceTab") {
            if (active) {
                return theme.accentPrimaryGlow
            }

            return root.down ? Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.72)
                             : root.hovered ? Qt.rgba(theme.studio750.r, theme.studio750.g, theme.studio750.b, 0.48)
                                            : "transparent"
        }

        if (tone === "monoRail") {
            return "transparent"
        }

        return root.down ? theme.studio700 : root.hovered ? theme.studio750 : theme.surfaceSoft
    }

    function borderColor() {
        if (tone === "icon") {
            return root.active ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.34)
                               : root.hovered ? theme.studio600 : theme.surfaceBorder
        }

        if (tone === "danger") {
            return Qt.rgba(theme.accentRed.r, theme.accentRed.g, theme.accentRed.b, 0.44)
        }

        if (tone === "primary") {
            return Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.44)
        }

        if (tone === "ghost") {
            return root.hovered ? theme.studio600 : theme.surfaceBorder
        }

        if (tone === "chip") {
            return active ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.44) : theme.surfaceBorder
        }

        if (tone === "tab") {
            return active ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.38) : theme.surfaceBorder
        }

        if (tone === "workspaceTab" || tone === "monoRail") {
            return "transparent"
        }

        return theme.surfaceBorder
    }

    function textColor() {
        if (!enabled) {
            return theme.studio500
        }

        if (tone === "icon") {
            return root.active ? theme.accentPrimary : root.hovered ? theme.studio100 : theme.studio400
        }

        if (tone === "danger") {
            return theme.studio050
        }

        if (tone === "primary") {
            return theme.studio950
        }

        if (tone === "chip" && active) {
            return theme.studio950
        }

        if (tone === "ghost") {
            return root.hovered ? theme.studio100 : theme.studio300
        }

        if (tone === "tab") {
            return active ? theme.studio050 : theme.studio300
        }

        if (tone === "workspaceTab") {
            return root.active ? theme.studio050 : root.hovered ? theme.studio100 : theme.studio300
        }

        if (tone === "monoRail") {
            return root.hovered ? theme.studio300 : theme.studio500
        }

        return theme.studio100
    }

    background: Rectangle {
        implicitWidth: root.tone === "icon" ? root.implicitHeight : 124
        radius: root.tone === "chip" ? theme.radiusPill
                                     : root.tone === "workspaceTab" || root.tone === "monoRail" ? 0
                                                                                                 : theme.radiusBadge
        color: root.backgroundColor()
        border.width: root.tone === "ghost" ? (root.hovered || root.activeFocus ? 1 : 0)
                                             : root.tone === "workspaceTab" || root.tone === "monoRail" ? 0
                                                                                                        : 1
        border.color: root.activeFocus ? Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.72)
                                       : root.borderColor()

        Rectangle {
            visible: root.tone === "workspaceTab" && root.active
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 3
            color: theme.accentPrimary
        }

        Rectangle {
            visible: root.tone === "workspaceTab" && root.activeFocus && !root.active
            anchors.fill: parent
            color: "transparent"
            border.width: 1
            border.color: Qt.rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.72)
        }
    }

    contentItem: Item {
        implicitWidth: contentRow.implicitWidth
        implicitHeight: contentRow.implicitHeight

        RowLayout {
            id: contentRow
            anchors.centerIn: parent
            spacing: (iconLabel.visible || iconSvg.visible) && textStack.visible ? 6 : 0

            ConsoleIcon {
                id: iconSvg
                visible: root.iconSvgName.length > 0
                iconName: root.iconSvgName
                tint: root.textColor()
                pixelSize: root.iconSvgPixelSize
                Layout.alignment: Qt.AlignVCenter
                Layout.preferredWidth: root.iconSvgPixelSize
                Layout.preferredHeight: root.iconSvgPixelSize
            }

            Label {
                id: iconLabel
                visible: root.iconText.length > 0 && !iconSvg.visible
                text: root.iconText
                color: root.textColor()
                font.family: root.iconFontFamily
                font.pixelSize: root.iconPixelSize
                font.weight: Font.DemiBold
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
            }

            ColumnLayout {
                id: textStack
                visible: textLabel.visible || subtitleLabel.visible
                spacing: 1

                Label {
                    id: textLabel
                    Layout.alignment: Qt.AlignHCenter
                    visible: root.text.length > 0
                    text: root.text
                    color: root.textColor()
                    font.family: theme.uiFontFamily
                    font.pixelSize: root.compact || root.dense ? theme.textXs : theme.textSm
                    font.weight: root.active || root.tone === "primary" ? Font.DemiBold : Font.Medium
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                Label {
                    id: subtitleLabel
                    Layout.alignment: Qt.AlignHCenter
                    visible: root.subtitle.length > 0
                    text: root.subtitle
                    color: root.tone === "workspaceTab" && root.active ? theme.studio300 : theme.studio500
                    font.family: theme.monoFontFamily
                    font.pixelSize: theme.textXxs
                    font.weight: Font.Medium
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
            }
        }
    }
}
