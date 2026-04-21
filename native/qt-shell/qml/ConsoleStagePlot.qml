import QtQuick
import QtQuick.Controls
import QtQuick.Shapes
import "LightingParityHelpers.js" as LightingHelpers

Rectangle {
    id: root

    property var fixtures: []
    property var sectionBounds: null
    property var selectionIds: []
    property bool commissioningActive: false
    property bool parityFrozen: false
    property bool showGrid: true
    property bool snapToGrid: true
    property real zoom: 1.0
    property real panX: 0
    property real panY: 0
    property int gridMinorMeters: 1
    property int gridMajorMeters: 5
    property real roomWidthMeters: 12
    property real roomDepthMeters: 9
    property int beamReach: 120

    signal fixtureClicked(string fixtureId)
    signal lassoReleased(var fixtureIds)
    signal fixtureDragReleased(string fixtureId, real x, real y)
    signal sectionRequested(string fixtureId)
    signal emptyCanvasClicked()

    color: theme.stageCanvas
    border.color: theme.stageOutline
    border.width: 1
    radius: theme.radiusCard
    clip: true

    ConsoleTheme {
        id: theme
    }

    readonly property var resolvedFixtures: LightingHelpers.resolvedFixtures(root.fixtures || [])
    readonly property var selectionLookup: {
        const map = {}
        const ids = root.selectionIds || []
        for (let i = 0; i < ids.length; i += 1) {
            map[ids[i]] = true
        }
        return map
    }

    // 1 m = roomWidth / roomWidthMeters pixels
    readonly property real metersToPixels: Math.min(
        (width - 40) / Math.max(1, roomWidthMeters),
        (height - 40) / Math.max(1, roomDepthMeters)
    )

    Item {
        id: viewport
        anchors.fill: parent
        anchors.margins: 20
        transform: [
            Translate { x: root.panX; y: root.panY },
            Scale { origin.x: viewport.width / 2; origin.y: viewport.height / 2;
                    xScale: root.zoom; yScale: root.zoom }
        ]

        Canvas {
            id: gridCanvas
            anchors.fill: parent
            visible: root.showGrid

            onWidthChanged: requestPaint()
            onHeightChanged: requestPaint()
            Component.onCompleted: requestPaint()

            onPaint: {
                const ctx = getContext("2d")
                ctx.reset()

                const pxPerMeter = root.metersToPixels
                if (pxPerMeter <= 0) return

                const widthM = root.roomWidthMeters
                const depthM = root.roomDepthMeters
                const originX = (width - widthM * pxPerMeter) / 2
                const originY = (height - depthM * pxPerMeter) / 2

                ctx.strokeStyle = Qt.rgba(theme.stageGridLine.r, theme.stageGridLine.g,
                                          theme.stageGridLine.b, theme.stageGridLine.a)
                ctx.lineWidth = 1

                for (let m = 0; m <= widthM; m += root.gridMinorMeters) {
                    const x = originX + m * pxPerMeter
                    ctx.beginPath()
                    ctx.moveTo(x, originY)
                    ctx.lineTo(x, originY + depthM * pxPerMeter)
                    ctx.stroke()
                }
                for (let m = 0; m <= depthM; m += root.gridMinorMeters) {
                    const y = originY + m * pxPerMeter
                    ctx.beginPath()
                    ctx.moveTo(originX, y)
                    ctx.lineTo(originX + widthM * pxPerMeter, y)
                    ctx.stroke()
                }

                ctx.strokeStyle = Qt.rgba(theme.stageGridMajor.r, theme.stageGridMajor.g,
                                          theme.stageGridMajor.b, theme.stageGridMajor.a)
                ctx.lineWidth = 1.4

                for (let m = 0; m <= widthM; m += root.gridMajorMeters) {
                    const x = originX + m * pxPerMeter
                    ctx.beginPath()
                    ctx.moveTo(x, originY)
                    ctx.lineTo(x, originY + depthM * pxPerMeter)
                    ctx.stroke()
                }
                for (let m = 0; m <= depthM; m += root.gridMajorMeters) {
                    const y = originY + m * pxPerMeter
                    ctx.beginPath()
                    ctx.moveTo(originX, y)
                    ctx.lineTo(originX + widthM * pxPerMeter, y)
                    ctx.stroke()
                }

                ctx.strokeStyle = theme.stageOutline
                ctx.lineWidth = 2
                ctx.strokeRect(originX, originY,
                               widthM * pxPerMeter, depthM * pxPerMeter)
            }
        }

        MouseArea {
            id: canvasMouse
            anchors.fill: parent
            acceptedButtons: Qt.LeftButton
            propagateComposedEvents: true
            onClicked: function(mouse) {
                root.emptyCanvasClicked()
            }
        }

        Repeater {
            model: root.resolvedFixtures

            delegate: Item {
                id: fixtureItem
                required property var modelData

                readonly property var fixture: fixtureItem.modelData.fixture || {}
                readonly property real nx: fixtureItem.modelData.resolvedX
                readonly property real ny: fixtureItem.modelData.resolvedY

                x: nx * viewport.width - width / 2
                y: ny * viewport.height - height / 2
                width: theme.fixtureDotRadius * 2
                height: theme.fixtureDotRadius * 2

                ConsoleFixtureBadge {
                    anchors.centerIn: parent
                    cct: Number(fixtureItem.fixture.cct || 5600)
                    intensity: Number(fixtureItem.fixture.intensity || 0)
                    on: Boolean(fixtureItem.fixture.on)
                    rotation: Number(fixtureItem.fixture.spatialRotation || 0)
                    selected: root.selectionLookup[fixtureItem.fixture.id] === true
                    stale: fixtureItem.fixture.spatialX === undefined || fixtureItem.fixture.spatialX === null
                    kind: String(fixtureItem.fixture.kind || "profile")
                    label: ""
                    parityFrozen: root.parityFrozen
                    dotRadius: theme.fixtureDotRadius
                    beamAngleDegrees: Number(fixtureItem.fixture.beamAngleDegrees || 40)
                    beamReach: root.beamReach

                    onClicked: root.fixtureClicked(fixtureItem.fixture.id)
                }

                MouseArea {
                    anchors.fill: parent
                    drag.target: fixtureItem
                    drag.axis: Drag.XAndYAxis
                    cursorShape: Qt.OpenHandCursor
                    acceptedButtons: Qt.LeftButton | Qt.RightButton
                    onClicked: function(mouse) {
                        if (mouse.button === Qt.RightButton) {
                            root.sectionRequested(fixtureItem.fixture.id)
                        } else {
                            root.fixtureClicked(fixtureItem.fixture.id)
                        }
                    }
                    onReleased: function(mouse) {
                        if (!drag.active) return
                        const cx = fixtureItem.x + fixtureItem.width / 2
                        const cy = fixtureItem.y + fixtureItem.height / 2
                        let normX = cx / viewport.width
                        let normY = cy / viewport.height
                        if (root.snapToGrid && root.metersToPixels > 0) {
                            const pxPerMeter = root.metersToPixels
                            const step = root.gridMinorMeters * pxPerMeter
                            const snappedX = Math.round(cx / step) * step
                            const snappedY = Math.round(cy / step) * step
                            normX = snappedX / viewport.width
                            normY = snappedY / viewport.height
                        }
                        normX = Math.max(0, Math.min(1, normX))
                        normY = Math.max(0, Math.min(1, normY))
                        root.fixtureDragReleased(fixtureItem.fixture.id, normX, normY)
                    }
                }
            }
        }
    }

    // Scale legend
    Rectangle {
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.margins: 12
        height: 22
        width: scaleLabel.implicitWidth + 20
        radius: theme.radiusBadge
        color: Qt.rgba(theme.surfaceSoft.r, theme.surfaceSoft.g, theme.surfaceSoft.b, 0.85)
        border.width: 1
        border.color: theme.surfaceBorder

        Label {
            id: scaleLabel
            anchors.centerIn: parent
            text: "1 m grid · " + root.gridMajorMeters + " m major"
            color: theme.studio400
            font.family: theme.monoFontFamily
            font.pixelSize: theme.textXxs
        }
    }
}
