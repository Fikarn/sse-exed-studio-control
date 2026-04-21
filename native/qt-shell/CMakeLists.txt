cmake_minimum_required(VERSION 3.24)

project(SseExEdStudioControlNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(CTest)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 Svg)

qt_standard_project_setup(REQUIRES 6.5)
qt_policy(SET QTP0004 NEW)

qt_add_executable(sse_exed_native
  src/main.cpp
  src/EngineProcess.cpp
  src/EngineProcess.h
)

target_compile_definitions(sse_exed_native
  PRIVATE
    SSE_QT_SHELL_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
)

qt_add_qml_module(sse_exed_native
  URI StudioControl
  VERSION 1.0
  IMPORTS
    QtQuick
    QtQuick.Controls
    QtQuick.Layouts
    QtQuick.Effects
  RESOURCES
    assets/fonts/IBMPlexSans-Regular.ttf
    assets/fonts/IBMPlexSans-Medium.ttf
    assets/fonts/IBMPlexSans-SemiBold.ttf
    assets/fonts/IBMPlexSans-Bold.ttf
    assets/fonts/IBMPlexMono-Regular.ttf
    assets/fonts/IBMPlexMono-Medium.ttf
    assets/fonts/IBMPlexMono-SemiBold.ttf
    assets/fonts/IBMPlexMono-Bold.ttf
    assets/fonts/OFL.txt
    assets/icons/lucide/clipboard-list.svg
    assets/icons/lucide/lamp.svg
    assets/icons/lucide/audio-waveform.svg
    assets/icons/lucide/wrench.svg
    assets/icons/lucide/info.svg
    assets/icons/lucide/circle-help.svg
    assets/icons/lucide/external-link.svg
    assets/icons/lucide/arrow-left.svg
    assets/icons/lucide/triangle-alert.svg
    assets/icons/lucide/LICENSE.txt
  QML_FILES
    qml/Main.qml
    qml/ParityCaptureHarness.qml
    qml/ConsoleTheme.qml
    qml/ConsoleSurface.qml
    qml/ConsoleButton.qml
    qml/ConsoleSlider.qml
    qml/ConsoleSwitch.qml
    qml/ConsoleTextField.qml
    qml/ConsoleTextArea.qml
    qml/ConsoleComboBox.qml
    qml/ConsoleBadge.qml
    qml/ConsoleIcon.qml
    qml/ConsoleStatusBadge.qml
    qml/ConsoleStatCard.qml
    qml/ConsoleStepHeader.qml
    qml/ConsoleTabButton.qml
    qml/ConsoleModal.qml
    qml/OperatorParityHelpers.js
    qml/OperatorShortcutLayer.qml
    qml/SafetyHoldButton.qml
    qml/DashboardHeaderPanel.qml
    qml/DashboardAboutDialog.qml
    qml/OperatorShortcutsDialog.qml
    qml/PlanningSummaryGrid.qml
    qml/PlanningToolbarPanel.qml
    qml/PlanningBoardPanel.qml
    qml/PlanningTimeReportDialog.qml
    qml/PlanningCreateProjectDialog.qml
    qml/PlanningImportDialog.qml
    qml/PlanningQuickActionsPanel.qml
    qml/PlanningFocusPanel.qml
    qml/PlanningWorkspacePanel.qml
    qml/PlanningProjectDetailDialog.qml
    qml/LightingParityHelpers.js
    qml/LightingToolbarPanel.qml
    qml/LightingDmxMonitorPanel.qml
    qml/LightingFixtureDialog.qml
    qml/LightingDeleteFixtureDialog.qml
    qml/LightingSpatialPlotPanel.qml
    qml/LightingContentPanel.qml
    qml/LightingSidebarPanel.qml
    qml/LightingWorkspacePanel.qml
    qml/AudioChannelCard.qml
    qml/AudioToolbarPanel.qml
    qml/AudioMixTargetsPanel.qml
    qml/AudioChannelsPanel.qml
    qml/AudioSelectedStripPanel.qml
    qml/AudioWorkspacePanel.qml
    qml/SetupQuickSetupPanel.qml
    qml/SetupConnectionProbePanel.qml
    qml/SetupGuidePanel.qml
    qml/SetupInstallerHelpPanel.qml
    qml/SetupControlSurfacePanel.qml
    qml/SetupWizardOverlay.qml
    qml/SetupWorkspacePanel.qml
)

set_target_properties(sse_exed_native PROPERTIES
  MACOSX_BUNDLE TRUE
  WIN32_EXECUTABLE TRUE
)

target_link_libraries(sse_exed_native
  PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Svg
)

if(BUILD_TESTING)
  find_package(Qt6 REQUIRED COMPONENTS QuickTest Test)

  qt_add_executable(sse_exed_native_qmltests
    tests/qml/tst_qml.cpp
  )

  target_link_libraries(sse_exed_native_qmltests
    PRIVATE
      Qt6::Core
      Qt6::Gui
      Qt6::Qml
      Qt6::Quick
      Qt6::QuickTest
      Qt6::Svg
      Qt6::Test
  )

  qt_add_resources(sse_exed_native_qmltests "sse_exed_native_qmltests_icons"
    PREFIX "/qt/qml/StudioControl"
    BASE "${CMAKE_CURRENT_SOURCE_DIR}"
    FILES
      assets/icons/lucide/clipboard-list.svg
      assets/icons/lucide/lamp.svg
      assets/icons/lucide/audio-waveform.svg
      assets/icons/lucide/wrench.svg
      assets/icons/lucide/info.svg
      assets/icons/lucide/circle-help.svg
      assets/icons/lucide/external-link.svg
      assets/icons/lucide/arrow-left.svg
      assets/icons/lucide/triangle-alert.svg
  )

  add_test(
    NAME sse_exed_native_qmltests
    COMMAND
      sse_exed_native_qmltests
      -input
      ${CMAKE_CURRENT_SOURCE_DIR}/tests/qml
      -o
      -,txt
      -o
      ${CMAKE_CURRENT_BINARY_DIR}/qmltest-results.tap,tap
      -o
      ${CMAKE_CURRENT_BINARY_DIR}/qmltest-results.xml,junitxml
  )

  set_tests_properties(sse_exed_native_qmltests PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QML_DISABLE_DISK_CACHE=1;QT_QUICK_CONTROLS_STYLE=Basic"
    TIMEOUT 300
  )
endif()
