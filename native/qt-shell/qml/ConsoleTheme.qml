import QtQuick

QtObject {
    id: root

    readonly property string uiFontFamily: "IBM Plex Sans"
    readonly property string monoFontFamily: "IBM Plex Mono"

    readonly property color studio950: "#0a0a0f"
    readonly property color studio900: "#111118"
    readonly property color studio850: "#16161f"
    readonly property color studio800: "#1c1c27"
    readonly property color studio750: "#242430"
    readonly property color studio700: "#2e2e3b"
    readonly property color studio650: "#363644"
    readonly property color studio600: "#3e3e4d"
    readonly property color studio500: "#8d8da5"
    readonly property color studio400: "#a0a0b8"
    readonly property color studio300: "#b0b0c4"
    readonly property color studio200: "#d0d0e0"
    readonly property color studio100: "#eaeaf0"
    readonly property color studio050: "#f5f5fa"

    readonly property color accentPrimary: "#99BA92"
    readonly property color accentBlue: accentPrimary
    readonly property color accentGreen: "#22c55e"
    readonly property color accentRed: "#ef4444"
    readonly property color accentAmber: "#f59e0b"
    readonly property color accentOrange: "#f97316"
    readonly property color accentCyan: "#06b6d4"

    readonly property color shellBase: studio950
    readonly property color shellTop: studio900
    readonly property color shellGridLine: "#08ffffff"
    readonly property color shellNeutralGlow: "#14c9d4da"

    readonly property color surfaceBorder: "#343543"
    readonly property color surfaceBorderStrong: "#4a584f"
    readonly property color surfaceStroke: "#252633"
    readonly property color surfaceDefault: "#12131a"
    readonly property color surfaceSoft: "#0f1016"
    readonly property color surfaceRaised: "#181922"
    readonly property color surfaceStrongTop: "#1a1b23"
    readonly property color surfaceStrongBottom: "#0f1015"
    readonly property color overlayScrim: "#09090dcc"

    readonly property color surfaceScrim: "#5c0a0a0f"
    readonly property color surfaceScrimStrong: "#800a0a0f"
    readonly property color surfaceScrimSoft: "#470a0a0f"

    readonly property color accentPrimarySoft: "#2e99ba92"
    readonly property color accentPrimaryGlow: "#1499ba92"
    readonly property color bgStepActive: "#14101a10"

    readonly property int stepIndicatorWidth: 72

    readonly property color focusRing: "#99ba92"
    readonly property int focusRingWidth: 2
    readonly property int focusRingOffset: 2

    readonly property color elevation1Shadow: "#4d000000"
    readonly property int elevation1OffsetY: 2
    readonly property int elevation1Blur: 8

    readonly property color elevation2Shadow: "#66000000"
    readonly property int elevation2OffsetY: 6
    readonly property int elevation2Blur: 20

    readonly property int copyMaxWidth: 760

    readonly property int radiusBadge: 6
    readonly property int radiusCard: 10
    readonly property int radiusSoft: 18
    readonly property int radiusSurface: 20
    readonly property int radiusSurfaceStrong: 24
    readonly property int radiusPill: 999

    readonly property int spacing2: 4
    readonly property int spacing3: 6
    readonly property int spacing4: 8
    readonly property int spacing5: 10
    readonly property int spacing6: 12
    readonly property int spacing7: 14
    readonly property int spacing8: 16
    readonly property int spacing9: 18
    readonly property int spacing10: 20

    readonly property int controlHeight: 36
    readonly property int compactControlHeight: 30
    readonly property int toolbarHeight: 44

    readonly property int textXxs: 10
    readonly property int textXs: 12
    readonly property int textSm: 13
    readonly property int textMd: 14
    readonly property int textLg: 20
    readonly property int textXl: 24
    readonly property int textHero: 30

    readonly property color timelineTrack: surfaceDefault
    readonly property color timelineNowTint: Qt.rgba(accentPrimary.r, accentPrimary.g, accentPrimary.b, 0.14)
    readonly property color timelineGridLine: Qt.rgba(studio500.r, studio500.g, studio500.b, 0.10)
    readonly property int timelineLaneHeight: 84
    readonly property int timelineLaneCompact: 48
    readonly property int timelineLaneHeadWidth: 280
    readonly property int timelineScaleHeight: 36
    readonly property int scheduleBlockRadius: radiusBadge

    function statusColor(status) {
        switch (status) {
        case "healthy":
        case "ready":
        case "connected":
        case "verified":
        case "live":
            return accentGreen
        case "degraded":
        case "starting":
        case "await":
        case "pending":
        case "warning":
            return accentAmber
        case "off":
        case "disabled":
        case "idle":
            return studio500
        default:
            return accentRed
        }
    }
}
