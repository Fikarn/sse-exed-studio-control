import QtQuick
import QtQuick.Controls
import QtTest
import "../../qml"

TestCase {
    name: "OperatorShortcutLayer"
    when: windowShown
    width: 960
    height: 540

    Item {
        id: container
        width: parent.width
        height: parent.height
    }

    Component {
        id: shortcutHostComponent

        FocusScope {
            id: host
            width: 960
            height: 540
            focus: true

            property alias engine: engineControllerStub
            property alias newProjectField: newProjectTitleField
            property alias searchField: planningSearchField
            property alias shortcutLayer: shortcutLayer
            property bool planningTimeReportVisible: false
            property bool keyboardHelpVisible: false
            property bool aboutDialogVisible: false
            property bool planningProjectDetailVisible: false
            property int focusPlanningSearchCalls: 0

            function inputFieldHasFocus() {
                return newProjectTitleField.activeFocus || planningSearchField.activeFocus
            }

            function focusPlanningSearch() {
                focusPlanningSearchCalls += 1
                planningSearchField.forceActiveFocus()
            }

            function closeTransientPanels() {
                keyboardHelpVisible = false
                aboutDialogVisible = false
                planningTimeReportVisible = false
                planningProjectDetailVisible = false
            }

            QtObject {
                id: engineControllerStub

                property bool operatorUiReady: true
                property string workspaceMode: "planning"
                property string planningModeSection: "board"
                property string lastWorkspaceMode: ""
                property var lastPlanningSettingsUpdate: null
                property int planningTimeReportRequests: 0
                property int exportSupportBackupCalls: 0

                function setWorkspaceMode(workspaceMode) {
                    lastWorkspaceMode = workspaceMode
                }

                function updatePlanningSettings(changes) {
                    lastPlanningSettingsUpdate = changes
                }

                function requestPlanningTimeReport() {
                    planningTimeReportRequests += 1
                }

                function exportSupportBackup() {
                    exportSupportBackupCalls += 1
                }
            }

            TextField {
                id: newProjectTitleField
                anchors.top: parent.top
                anchors.left: parent.left
                width: 220
                text: "Draft"
            }

            TextField {
                id: planningSearchField
                anchors.top: newProjectTitleField.bottom
                anchors.left: parent.left
                width: 240
                text: "Search draft"
            }

            OperatorShortcutLayer {
                id: shortcutLayer
                anchors.fill: parent
                rootWindow: host
                engineController: engineControllerStub
                newProjectTitleField: newProjectTitleField
            }
        }
    }

    function createHost() {
        const host = createTemporaryObject(shortcutHostComponent, container)
        verify(host !== null)
        waitForRendering(host)
        return host
    }

    function resetFocus(host) {
        host.newProjectField.focus = false
        host.searchField.focus = false
        host.forceActiveFocus()
        wait(0)
    }

    function test_workspaceShortcutsSwitchModes() {
        const host = createHost()
        resetFocus(host)

        keyClick(Qt.Key_L)
        wait(0)
        compare(host.engine.lastWorkspaceMode, "lighting")

        keyClick(Qt.Key_A)
        wait(0)
        compare(host.engine.lastWorkspaceMode, "audio")

        keyClick(Qt.Key_K)
        wait(0)
        compare(host.engine.lastWorkspaceMode, "planning")
    }

    function test_planningGlobalShortcutsTargetExpectedFields() {
        const host = createHost()
        resetFocus(host)

        keyClick(Qt.Key_N)
        wait(0)
        compare(host.newProjectField.activeFocus, true)

        resetFocus(host)
        keyClick(Qt.Key_S)
        wait(0)
        compare(host.focusPlanningSearchCalls, 1)
        compare(host.searchField.activeFocus, true)

        resetFocus(host)
        keyClick(Qt.Key_Slash)
        wait(0)
        compare(host.focusPlanningSearchCalls, 2)
        compare(host.searchField.activeFocus, true)
    }

    function test_filterShortcutsUpdatePlanningSettings() {
        const host = createHost()
        resetFocus(host)

        keyClick(Qt.Key_0)
        wait(0)
        compare(host.engine.lastPlanningSettingsUpdate.viewFilter, "all")

        keyClick(Qt.Key_3)
        wait(0)
        compare(host.engine.lastPlanningSettingsUpdate.viewFilter, "blocked")
    }

    function test_reportHelpExportAndEscapeShortcutsUseOperatorFlow() {
        const host = createHost()
        resetFocus(host)

        keyClick(Qt.Key_R)
        wait(0)
        compare(host.planningTimeReportVisible, true)
        compare(host.engine.planningTimeReportRequests, 1)

        keyClick(Qt.Key_E)
        wait(0)
        compare(host.engine.exportSupportBackupCalls, 1)

        keyClick(Qt.Key_Slash, Qt.ShiftModifier)
        wait(0)
        compare(host.keyboardHelpVisible, true)

        host.aboutDialogVisible = true
        host.planningProjectDetailVisible = true
        keyClick(Qt.Key_Escape)
        wait(0)
        compare(host.aboutDialogVisible, false)
        compare(host.keyboardHelpVisible, false)
        compare(host.planningTimeReportVisible, false)
        compare(host.planningProjectDetailVisible, false)
    }

    function test_inputFocusDisablesOperatorShortcuts() {
        const host = createHost()
        host.newProjectField.forceActiveFocus()
        wait(0)

        keyClick(Qt.Key_L)
        wait(0)
        compare(host.engine.lastWorkspaceMode, "")

        keyClick(Qt.Key_1)
        wait(0)
        compare(host.engine.lastPlanningSettingsUpdate, null)
    }
}
