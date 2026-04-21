import QtQuick
import QtQuick.Controls
import QtTest
import "../../qml"

TestCase {
    name: "LightingWorkspacePanel"
    when: windowShown
    width: 1920
    height: 1080

    Item {
        id: container
        width: parent.width
        height: parent.height
    }

    Component {
        id: workspaceHostComponent

        ApplicationWindow {
            id: host
            width: 1920
            height: 1080
            visible: true

            property alias panel: lightingPanel
            property alias engine: engineControllerStub
            property real dashboardUiScale: 1.0
            property bool lightingEnabledDraft: true
            property string lightingBridgeIpDraft: "127.0.0.1"
            property int lightingUniverseDraft: 1
            property int lightingGrandMasterDraft: 100
            property string lightingNewFixtureNameDraft: "Add Key"
            property string lightingNewFixtureTypeDraft: "astra-bicolor"
            property int lightingNewFixtureDmxDraft: 97
            property string lightingNewFixtureGroupDraft: "group-key"

            function lightingGroupOptions() {
                return [{ "id": "", "name": "Ungrouped" }].concat(engineControllerStub.lightingGroups)
            }

            function lightingGroupIndex(groupId, options) {
                const target = groupId || ""
                for (let i = 0; i < options.length; i += 1) {
                    if (options[i].id === target) return i
                }
                return 0
            }

            function lightingGroupName(groupId) {
                return groupId ? groupId : "Ungrouped"
            }

            function lightingFixtureTypeOptions() {
                return [
                    { "id": "astra-bicolor", "name": "Litepanels Astra", "channels": 2, "minCct": 3200, "maxCct": 5600 },
                    { "id": "infinibar-pb12", "name": "Aputure Infinibar PB12", "channels": 8, "minCct": 2000, "maxCct": 10000 }
                ]
            }

            function lightingFixtureTypeIndex(fixtureType, options) {
                for (let i = 0; i < options.length; i += 1) {
                    if (options[i].id === fixtureType) return i
                }
                return 0
            }

            function lightingFixtureTypeName(fixtureType) {
                return fixtureType === "infinibar-pb12" ? "Aputure Infinibar PB12" : "Litepanels Astra"
            }

            function lightingFixtureMaxStartAddress(fixtureType) {
                return fixtureType === "infinibar-pb12" ? 505 : 511
            }

            function lightingFixtureMinCct(fixtureType) {
                return fixtureType === "infinibar-pb12" ? 2000 : 3200
            }

            function lightingFixtureMaxCct(fixtureType) {
                return fixtureType === "infinibar-pb12" ? 10000 : 5600
            }

            function formatEnumLabel(value) {
                return value.charAt(0).toUpperCase() + value.slice(1)
            }

            QtObject {
                id: engineControllerStub

                property string workspaceMode: "lighting"
                property bool lightingSnapshotLoaded: true
                property int lightingFixtureCount: 2
                property int lightingGroupCount: 1
                property int lightingSceneCount: 1
                property bool lightingReachable: true
                property bool lightingEnabled: true
                property string lightingBridgeIp: "127.0.0.1"
                property int lightingUniverse: 1
                property int lightingGrandMaster: 100
                property string lightingSelectedFixtureId: "fixture-1"
                property string lightingSelectedSceneId: "scene-1"
                property string lightingActiveCueId: ""
                property string commissioningStage: "ready"
                property bool operatorUiReady: true
                property var lightingCameraMarker: { "x": 0.5, "y": 0.84, "rotation": 0 }
                property var lightingSubjectMarker: { "x": 0.5, "y": 0.46, "rotation": 0 }
                property var lightingGroups: [
                    { "id": "group-key", "name": "Key", "fixtureCount": 2 }
                ]
                property var lightingScenes: [
                    { "id": "scene-1", "name": "Interview", "lastRecalled": false, "lastRecalledAt": "" }
                ]
                property var lightingCues: [
                    { "id": "cue-1", "label": "Cue 1", "fadeMs": 1500 },
                    { "id": "cue-2", "label": "Cue 2", "fadeMs": 2500 }
                ]
                property var lightingFixtures: [
                    {
                        "id": "fixture-1", "name": "Key Left", "groupId": "group-key",
                        "dmxStartAddress": 1, "type": "astra-bicolor", "on": true,
                        "intensity": 72, "cct": 5600,
                        "spatialX": 0.24, "spatialY": 0.32, "spatialRotation": 0, "effect": null
                    },
                    {
                        "id": "fixture-2", "name": "Key Right", "groupId": "group-key",
                        "dmxStartAddress": 17, "type": "astra-bicolor", "on": false,
                        "intensity": 46, "cct": 4300,
                        "spatialX": 0.72, "spatialY": 0.33, "spatialRotation": 0,
                        "effect": { "type": "pulse", "speed": 5 }
                    }
                ]
                property bool lightingDmxMonitorLoaded: true
                property var lightingDmxChannels: [
                    { "channel": 1, "value": 255, "lightName": "Key Left", "label": "Intensity" },
                    { "channel": 2, "value": 128, "lightName": "Key Left", "label": "CCT" }
                ]
                property int lightingDmxRequests: 0

                property string lastFiredCueId: ""
                property var lastCreatedCuePayload: null
                property string lastDeletedCueId: ""
                property var lastUpdateSettings: null
                property var lastFixtureUpdate: null
                property string lastRecalledSceneId: ""

                function requestLightingSnapshot() {}
                function requestLightingDmxMonitorSnapshot() { lightingDmxRequests += 1 }
                function setLightingAllPower(on) {}
                function updateLightingSettings(changes) {
                    lastUpdateSettings = changes
                    if (changes.selectedFixtureId !== undefined) {
                        lightingSelectedFixtureId = changes.selectedFixtureId ? changes.selectedFixtureId : ""
                    }
                }
                function runLightingProbe(bridgeIp, universe) {}
                function createLightingFixture(fixture) {}
                function setLightingFixturePower(fixtureId, on) {}
                function updateLightingFixture(fixtureId, changes) {
                    lastFixtureUpdate = { "fixtureId": fixtureId, "changes": changes }
                }
                function deleteLightingFixture(fixtureId) {}
                function createLightingScene(name) {}
                function updateLightingScene(sceneId, changes) {}
                function deleteLightingScene(sceneId) {}
                function createLightingGroup(name) {}
                function updateLightingGroup(groupId, changes) {}
                function deleteLightingGroup(groupId) {}
                function setLightingGroupPower(groupId, on) {}
                function recallLightingScene(sceneId, fadeMs) { lastRecalledSceneId = sceneId }
                function fireLightingCue(cueId, fadeOverrideMs) {
                    lastFiredCueId = cueId
                    lightingActiveCueId = cueId
                }
                function createLightingCue(payload) { lastCreatedCuePayload = payload }
                function updateLightingCue(cueId, changes) {}
                function deleteLightingCue(cueId) { lastDeletedCueId = cueId }
            }

            LightingWorkspacePanel {
                id: lightingPanel
                anchors.fill: parent
                rootWindow: host
                engineController: engineControllerStub
                scaleFactor: host.dashboardUiScale
            }
        }
    }

    function createHost(properties) {
        const host = createTemporaryObject(workspaceHostComponent, container, properties || {})
        verify(host !== null)
        waitForRendering(host.contentItem)
        wait(0)
        return host
    }

    function test_workspaceFitsOperatorViewport() {
        const host = createHost()
        compare(host.panel.contentFitsViewport(), true)
    }

    function test_fireNextCue_routesFirstCueWhenIdle() {
        const host = createHost()
        compare(host.engine.lastFiredCueId, "")
        host.panel.fireNextCue()
        compare(host.engine.lastFiredCueId, "cue-1")
    }

    function test_fireNextCue_advancesFromActive() {
        const host = createHost()
        host.engine.lightingActiveCueId = "cue-1"
        host.panel.fireNextCue()
        compare(host.engine.lastFiredCueId, "cue-2")
    }

    function test_addCueAfterSelection_sendsLabelAndAnchor() {
        const host = createHost()
        host.panel.selectedCueId = "cue-1"
        host.panel.addCueAfterSelection()
        verify(host.engine.lastCreatedCuePayload !== null)
        compare(host.engine.lastCreatedCuePayload.afterCueId, "cue-1")
        compare(host.engine.lastCreatedCuePayload.label, "Cue 3")
    }

    function test_selectFixture_routesEmptyIdAsClear() {
        const host = createHost()
        host.panel.selectFixture("")
        verify(host.engine.lastUpdateSettings !== null)
        compare(host.engine.lastUpdateSettings.selectedFixtureId, null)
    }

    function test_dmxOverlayToggle_isShellLocal() {
        const host = createHost()
        compare(host.panel.dmxOverlayVisible, false)
        host.panel.dmxOverlayVisible = true
        compare(host.panel.dmxOverlayVisible, true)
    }

    function test_openAddFixtureDialogForVerify_returnsTrue() {
        const host = createHost()
        compare(host.panel.openAddFixtureDialogForVerify(), true)
    }
}
