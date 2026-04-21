import QtQuick
import QtQml

Item {
    id: root
    objectName: "operator-shortcut-layer"
    required property var rootWindow
    required property QtObject engineController
    required property Item newProjectTitleField

    function operatorShortcutsEnabled() {
        return !!engineController && engineController.operatorUiReady && !rootWindow.inputFieldHasFocus()
    }

    function planningShortcutsEnabled() {
        return operatorShortcutsEnabled() && engineController.workspaceMode === "planning"
    }

    Shortcut {
        sequence: "L"
        enabled: root.operatorShortcutsEnabled()
        onActivated: engineController.setWorkspaceMode("lighting")
    }

    Shortcut {
        sequence: "A"
        enabled: root.operatorShortcutsEnabled()
        onActivated: engineController.setWorkspaceMode("audio")
    }

    Shortcut {
        sequence: "K"
        enabled: root.operatorShortcutsEnabled()
        onActivated: engineController.setWorkspaceMode("planning")
    }

    Shortcut {
        sequence: "Shift+S"
        enabled: root.operatorShortcutsEnabled()
        onActivated: engineController.setWorkspaceMode("setup")
    }

    Shortcut {
        sequence: "N"
        enabled: root.planningShortcutsEnabled()
        onActivated: {
            if (rootWindow.openPlanningCreateProject) {
                rootWindow.openPlanningCreateProject("todo")
            }

            Qt.callLater(function() {
                newProjectTitleField.forceActiveFocus()
                if (newProjectTitleField.selectAll) {
                    newProjectTitleField.selectAll()
                }
            })
        }
    }

    Shortcut {
        sequence: "S"
        enabled: root.planningShortcutsEnabled()
        onActivated: rootWindow.focusPlanningSearch()
    }

    Shortcut {
        sequence: "/"
        enabled: root.planningShortcutsEnabled()
        onActivated: rootWindow.focusPlanningSearch()
    }

    Shortcut {
        sequence: "0"
        enabled: root.planningShortcutsEnabled()
        onActivated: engineController.updatePlanningSettings({ "viewFilter": "all" })
    }

    Shortcut {
        sequence: "1"
        enabled: root.planningShortcutsEnabled()
        onActivated: engineController.updatePlanningSettings({ "viewFilter": "todo" })
    }

    Shortcut {
        sequence: "2"
        enabled: root.planningShortcutsEnabled()
        onActivated: engineController.updatePlanningSettings({ "viewFilter": "in-progress" })
    }

    Shortcut {
        sequence: "3"
        enabled: root.planningShortcutsEnabled()
        onActivated: engineController.updatePlanningSettings({ "viewFilter": "blocked" })
    }

    Shortcut {
        sequence: "4"
        enabled: root.planningShortcutsEnabled()
        onActivated: engineController.updatePlanningSettings({ "viewFilter": "done" })
    }

    Shortcut {
        sequence: "R"
        enabled: root.planningShortcutsEnabled()
        onActivated: {
            rootWindow.planningTimeReportVisible = !rootWindow.planningTimeReportVisible
            if (rootWindow.planningTimeReportVisible) {
                engineController.requestPlanningTimeReport()
            }
        }
    }

    Shortcut {
        sequence: "E"
        enabled: root.operatorShortcutsEnabled()
        onActivated: engineController.exportSupportBackup()
    }

    Shortcut {
        sequence: "Shift+/"
        enabled: root.operatorShortcutsEnabled()
        onActivated: rootWindow.keyboardHelpVisible = !rootWindow.keyboardHelpVisible
    }

    Shortcut {
        sequence: "Esc"
        enabled: rootWindow.aboutDialogVisible
                 || rootWindow.keyboardHelpVisible
                 || rootWindow.planningTimeReportVisible
                 || rootWindow.planningProjectDetailVisible
        onActivated: rootWindow.closeTransientPanels()
    }
}
