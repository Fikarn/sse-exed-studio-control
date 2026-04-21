import QtQuick
import QtTest
import "../../qml"

TestCase {
    name: "DashboardHeaderPanel"
    when: windowShown
    width: 1440
    height: 420

    Item {
        id: container
        width: parent.width
        height: parent.height
    }

    Component {
        id: headerHostComponent

        Item {
            id: host
            width: 1440
            height: 420

            property alias header: headerPanel
            property alias engine: engineControllerStub
            property real dashboardUiScale: 1.0
            property bool aboutDialogVisible: false
            property bool keyboardHelpVisible: false

            function formatEnumLabel(value) {
                return value === "in-progress"
                       ? "In Progress"
                       : value.charAt(0).toUpperCase() + value.slice(1)
            }

            QtObject {
                id: engineControllerStub

                property string workspaceMode: "planning"
                property string healthStatus: "healthy"
                property string stateLabel: "Running"
                property string startupPhaseLabel: "Ready"
                property bool appSnapshotLoaded: true
                property bool operatorUiReady: true
                property bool lightingEnabled: true
                property bool lightingReachable: true
                property bool audioOscEnabled: true
                property bool audioVerified: true
                property bool audioConnected: true
                property int lightingFixtureCount: 12
                property int lightingUniverse: 1
                property int audioChannelCount: 18
                property int planningProjectCount: 7
                property string engineVersion: "2.1.0"
                property string protocolVersion: "v3.2"
                property string storageDetails: "Saved locally"
                property string audioSendHost: "127.0.0.1"
                property int audioSendPort: 9000
                property string planningSelectedProjectId: ""
                property var planningProjects: []
                property string lastWorkspaceMode: ""

                function setWorkspaceMode(workspaceMode) {
                    lastWorkspaceMode = workspaceMode
                    this.workspaceMode = workspaceMode
                }

                function requestLightingSnapshot() {}
                function requestAudioSnapshot() {}
            }

            DashboardHeaderPanel {
                id: headerPanel
                anchors.fill: parent
                rootWindow: host
                engineController: engineControllerStub
                scaleFactor: host.dashboardUiScale
            }
        }
    }

    function createHost() {
        const host = createTemporaryObject(headerHostComponent, container)
        verify(host !== null)
        waitForRendering(host)
        waitForRendering(host.header)
        return host
    }

    function findByObjectName(item, objectName) {
        if (!item) {
            return null
        }

        if (item.objectName === objectName) {
            return item
        }

        const childItems = item.children || []
        for (let index = 0; index < childItems.length; index += 1) {
            const match = findByObjectName(childItems[index], objectName)
            if (match) {
                return match
            }
        }

        return null
    }

    function pressButton(button) {
        verify(button !== null)
        if (button.clicked) {
            button.clicked()
        } else {
            mouseClick(button, button.width / 2, button.height / 2, Qt.LeftButton)
        }
        wait(0)
    }

    function test_workspaceTabsAndSetupRouteToExpectedSurface() {
        const host = createHost()
        verify(findByObjectName(host.header, "dashboard-tab-lighting") !== null)
        verify(findByObjectName(host.header, "dashboard-tab-audio") !== null)
        verify(findByObjectName(host.header, "dashboard-tab-planning") !== null)

        host.header.selectWorkspace("lighting")
        compare(host.engine.lastWorkspaceMode, "lighting")

        host.header.selectWorkspace("audio")
        compare(host.engine.lastWorkspaceMode, "audio")

        host.header.selectWorkspace("planning")
        compare(host.engine.lastWorkspaceMode, "planning")

        pressButton(findByObjectName(host.header, "dashboard-setup-button"))
        compare(host.engine.lastWorkspaceMode, "setup")
    }

    function test_scaleAboutAndHelpButtonsUpdateShellState() {
        const host = createHost()

        pressButton(findByObjectName(host.header, "dashboard-scale-90"))
        compare(host.dashboardUiScale, 0.9)

        pressButton(findByObjectName(host.header, "dashboard-scale-108"))
        compare(host.dashboardUiScale, 1.08)

        pressButton(findByObjectName(host.header, "dashboard-about-button"))
        compare(host.aboutDialogVisible, true)

        pressButton(findByObjectName(host.header, "dashboard-help-button"))
        compare(host.keyboardHelpVisible, true)
    }
}
