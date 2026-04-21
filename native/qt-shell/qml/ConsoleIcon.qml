import QtQuick
import QtQuick.Effects

Item {
    id: root
    property string iconName: ""
    property color tint: "#ffffff"
    property int pixelSize: 18

    implicitWidth: pixelSize
    implicitHeight: pixelSize

    Image {
        id: source
        anchors.fill: parent
        source: root.iconName.length > 0
                ? "qrc:/qt/qml/StudioControl/assets/icons/lucide/" + root.iconName + ".svg"
                : ""
        sourceSize.width: root.pixelSize * 2
        sourceSize.height: root.pixelSize * 2
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
        visible: false
    }

    MultiEffect {
        anchors.fill: source
        source: source
        colorization: 1.0
        colorizationColor: root.tint
        brightness: 0
    }
}
