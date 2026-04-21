#pragma once

#include <QByteArray>
#include <QJsonObject>
#include <QObject>
#include <QProcess>
#include <QString>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

class EngineProcess : public QObject {
  Q_OBJECT
  Q_PROPERTY(State state READ state NOTIFY stateChanged)
  Q_PROPERTY(StartupPhase startupPhase READ startupPhase NOTIFY startupPhaseChanged)
  Q_PROPERTY(QString stateLabel READ stateLabel NOTIFY stateChanged)
  Q_PROPERTY(QString startupPhaseLabel READ startupPhaseLabel NOTIFY startupPhaseChanged)
  Q_PROPERTY(QString message READ message NOTIFY messageChanged)
  Q_PROPERTY(QString healthStatus READ healthStatus NOTIFY healthStatusChanged)
  Q_PROPERTY(QString diagnosticsPath READ diagnosticsPath NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString appDataPath READ appDataPath NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString logsPath READ logsPath NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString engineLogPath READ engineLogPath NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString databasePath READ databasePath NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString lastError READ lastError NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString engineVersion READ engineVersion NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString protocolVersion READ protocolVersion NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString recentLogExcerpt READ recentLogExcerpt NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString healthDetails READ healthDetails NOTIFY healthStatusChanged)
  Q_PROPERTY(QString storageDetails READ storageDetails NOTIFY healthStatusChanged)
  Q_PROPERTY(QString storageSqliteVersion READ storageSqliteVersion NOTIFY healthStatusChanged)
  Q_PROPERTY(QString workspaceMode READ workspaceMode NOTIFY settingsChanged)
  Q_PROPERTY(int windowWidth READ windowWidth NOTIFY settingsChanged)
  Q_PROPERTY(int windowHeight READ windowHeight NOTIFY settingsChanged)
  Q_PROPERTY(QString windowMode READ windowMode NOTIFY settingsChanged)
  Q_PROPERTY(bool windowMaximized READ windowMaximized NOTIFY settingsChanged)
  Q_PROPERTY(bool windowSettingsLoaded READ windowSettingsLoaded NOTIFY settingsChanged)
  Q_PROPERTY(QString settingsDetails READ settingsDetails NOTIFY settingsChanged)
  Q_PROPERTY(QString startupTargetSurface READ startupTargetSurface NOTIFY appSnapshotChanged)
  Q_PROPERTY(QString commissioningStage READ commissioningStage NOTIFY appSnapshotChanged)
  Q_PROPERTY(QString hardwareProfile READ hardwareProfile NOTIFY appSnapshotChanged)
  Q_PROPERTY(QString controlSurfaceBaseUrl READ controlSurfaceBaseUrl NOTIFY appSnapshotChanged)
  Q_PROPERTY(bool controlSurfaceAvailable READ controlSurfaceAvailable NOTIFY appSnapshotChanged)
  Q_PROPERTY(QString controlSurfaceStatus READ controlSurfaceStatus NOTIFY appSnapshotChanged)
  Q_PROPERTY(QString controlSurfaceDetails READ controlSurfaceDetails NOTIFY appSnapshotChanged)
  Q_PROPERTY(bool appSnapshotLoaded READ appSnapshotLoaded NOTIFY appSnapshotChanged)
  Q_PROPERTY(QString appSnapshotDetails READ appSnapshotDetails NOTIFY appSnapshotChanged)
  Q_PROPERTY(bool commissioningSnapshotLoaded READ commissioningSnapshotLoaded NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QString commissioningDetails READ commissioningDetails NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QString commissioningConfigDetails READ commissioningConfigDetails NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QString commissioningReadinessDetails READ commissioningReadinessDetails NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QVariantList commissioningSteps READ commissioningSteps NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QVariantList commissioningChecks READ commissioningChecks NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(int commissioningPlanningProjectCount READ commissioningPlanningProjectCount NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(int commissioningPlanningTaskCount READ commissioningPlanningTaskCount NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QString commissioningLightingBridgeIp READ commissioningLightingBridgeIp NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(int commissioningLightingUniverse READ commissioningLightingUniverse NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(QString commissioningAudioSendHost READ commissioningAudioSendHost NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(int commissioningAudioSendPort READ commissioningAudioSendPort NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(int commissioningAudioReceivePort READ commissioningAudioReceivePort NOTIFY commissioningSnapshotChanged)
  Q_PROPERTY(bool lightingSnapshotLoaded READ lightingSnapshotLoaded NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QString lightingDetails READ lightingDetails NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QString lightingStatus READ lightingStatus NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QString lightingAdapterMode READ lightingAdapterMode NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(bool lightingEnabled READ lightingEnabled NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QString lightingBridgeIp READ lightingBridgeIp NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(int lightingUniverse READ lightingUniverse NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(int lightingGrandMaster READ lightingGrandMaster NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QVariantList lightingFixtures READ lightingFixtures NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QVariantList lightingGroups READ lightingGroups NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QVariantList lightingScenes READ lightingScenes NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(int lightingFixtureCount READ lightingFixtureCount NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(int lightingGroupCount READ lightingGroupCount NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(int lightingSceneCount READ lightingSceneCount NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(bool lightingConnected READ lightingConnected NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(bool lightingReachable READ lightingReachable NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QString lightingSelectedSceneId READ lightingSelectedSceneId NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QString lightingSelectedFixtureId READ lightingSelectedFixtureId NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QVariantMap lightingCameraMarker READ lightingCameraMarker NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(QVariantMap lightingSubjectMarker READ lightingSubjectMarker NOTIFY lightingSnapshotChanged)
  Q_PROPERTY(bool lightingDmxMonitorLoaded READ lightingDmxMonitorLoaded NOTIFY lightingDmxMonitorChanged)
  Q_PROPERTY(QVariantList lightingDmxChannels READ lightingDmxChannels NOTIFY lightingDmxMonitorChanged)
  Q_PROPERTY(bool audioSnapshotLoaded READ audioSnapshotLoaded NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioDetails READ audioDetails NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioStatus READ audioStatus NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioAdapterMode READ audioAdapterMode NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioMeteringState READ audioMeteringState NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioConsoleStateConfidence READ audioConsoleStateConfidence NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastConsoleSyncAt READ audioLastConsoleSyncAt NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastConsoleSyncReason READ audioLastConsoleSyncReason NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastRecalledSnapshotId READ audioLastRecalledSnapshotId NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastSnapshotRecallAt READ audioLastSnapshotRecallAt NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastActionStatus READ audioLastActionStatus NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastActionCode READ audioLastActionCode NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioLastActionMessage READ audioLastActionMessage NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool audioOscEnabled READ audioOscEnabled NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioSelectedChannelId READ audioSelectedChannelId NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioSelectedMixTargetId READ audioSelectedMixTargetId NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool audioExpectedPeakData READ audioExpectedPeakData NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool audioExpectedSubmixLock READ audioExpectedSubmixLock NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool audioExpectedCompatibilityMode READ audioExpectedCompatibilityMode NOTIFY audioSnapshotChanged)
  Q_PROPERTY(int audioFadersPerBank READ audioFadersPerBank NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QString audioSendHost READ audioSendHost NOTIFY audioSnapshotChanged)
  Q_PROPERTY(int audioSendPort READ audioSendPort NOTIFY audioSnapshotChanged)
  Q_PROPERTY(int audioReceivePort READ audioReceivePort NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QVariantList audioChannels READ audioChannels NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QVariantList audioMixTargets READ audioMixTargets NOTIFY audioSnapshotChanged)
  Q_PROPERTY(QVariantList audioSnapshots READ audioSnapshots NOTIFY audioSnapshotChanged)
  Q_PROPERTY(int audioChannelCount READ audioChannelCount NOTIFY audioSnapshotChanged)
  Q_PROPERTY(int audioMixTargetCount READ audioMixTargetCount NOTIFY audioSnapshotChanged)
  Q_PROPERTY(int audioSnapshotCount READ audioSnapshotCount NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool audioConnected READ audioConnected NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool audioVerified READ audioVerified NOTIFY audioSnapshotChanged)
  Q_PROPERTY(bool supportSnapshotLoaded READ supportSnapshotLoaded NOTIFY supportSnapshotChanged)
  Q_PROPERTY(QString supportDetails READ supportDetails NOTIFY supportSnapshotChanged)
  Q_PROPERTY(QString supportRestoreDetails READ supportRestoreDetails NOTIFY supportSnapshotChanged)
  Q_PROPERTY(QString supportBackupDir READ supportBackupDir NOTIFY supportSnapshotChanged)
  Q_PROPERTY(QVariantList supportBackupFiles READ supportBackupFiles NOTIFY supportSnapshotChanged)
  Q_PROPERTY(int supportBackupCount READ supportBackupCount NOTIFY supportSnapshotChanged)
  Q_PROPERTY(QString supportLatestBackupPath READ supportLatestBackupPath NOTIFY supportSnapshotChanged)
  Q_PROPERTY(QString shellDiagnosticsExportPath READ shellDiagnosticsExportPath NOTIFY diagnosticsChanged)
  Q_PROPERTY(QString companionExportPath READ companionExportPath NOTIFY diagnosticsChanged)
  Q_PROPERTY(bool planningSnapshotLoaded READ planningSnapshotLoaded NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QString planningDetails READ planningDetails NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QVariantList planningProjects READ planningProjects NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QVariantList planningTasks READ planningTasks NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QVariantList planningActivityLog READ planningActivityLog NOTIFY planningSnapshotChanged)
  Q_PROPERTY(int planningProjectCount READ planningProjectCount NOTIFY planningSnapshotChanged)
  Q_PROPERTY(int planningTaskCount READ planningTaskCount NOTIFY planningSnapshotChanged)
  Q_PROPERTY(int planningRunningTaskCount READ planningRunningTaskCount NOTIFY planningSnapshotChanged)
  Q_PROPERTY(int planningCompletedTaskCount READ planningCompletedTaskCount NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QString planningViewFilter READ planningViewFilter NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QString planningSortBy READ planningSortBy NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QString planningModeSection READ planningModeSection NOTIFY planningSnapshotChanged)
  Q_PROPERTY(int planningTimelineStartHour READ planningTimelineStartHour NOTIFY planningSnapshotChanged)
  Q_PROPERTY(int planningTimelineEndHour READ planningTimelineEndHour NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QString planningSelectedProjectId READ planningSelectedProjectId NOTIFY planningSnapshotChanged)
  Q_PROPERTY(QString planningSelectedTaskId READ planningSelectedTaskId NOTIFY planningSnapshotChanged)
  Q_PROPERTY(bool planningTimeReportLoaded READ planningTimeReportLoaded NOTIFY planningTimeReportChanged)
  Q_PROPERTY(int planningTotalTrackedSeconds READ planningTotalTrackedSeconds NOTIFY planningTimeReportChanged)
  Q_PROPERTY(QVariantList planningTimeByProject READ planningTimeByProject NOTIFY planningTimeReportChanged)
  Q_PROPERTY(QVariantList planningTimeByTask READ planningTimeByTask NOTIFY planningTimeReportChanged)
  Q_PROPERTY(QVariantList planningTimerEvents READ planningTimerEvents NOTIFY planningTimeReportChanged)
  Q_PROPERTY(bool controlSurfaceSnapshotLoaded READ controlSurfaceSnapshotLoaded NOTIFY controlSurfaceSnapshotChanged)
  Q_PROPERTY(QVariantList controlSurfacePages READ controlSurfacePages NOTIFY controlSurfaceSnapshotChanged)
  Q_PROPERTY(bool operatorUiReady READ operatorUiReady NOTIFY operatorUiReadyChanged)
  Q_PROPERTY(bool canRetry READ canRetry NOTIFY stateChanged)

public:
  enum class State {
    Stopped,
    Starting,
    Running,
    Failed,
  };
  Q_ENUM(State)

  enum class StartupPhase {
    Idle,
    LaunchingProcess,
    WaitingForReadyEvent,
    WaitingForHealthSnapshot,
    WaitingForAppSnapshot,
    Ready,
    Failed,
  };
  Q_ENUM(StartupPhase)

  explicit EngineProcess(QObject *parent = nullptr);

  State state() const;
  StartupPhase startupPhase() const;
  QString stateLabel() const;
  QString startupPhaseLabel() const;
  QString message() const;
  QString healthStatus() const;
  QString diagnosticsPath() const;
  QString appDataPath() const;
  QString logsPath() const;
  QString engineLogPath() const;
  QString databasePath() const;
  QString lastError() const;
  QString engineVersion() const;
  QString protocolVersion() const;
  QString recentLogExcerpt() const;
  QString healthDetails() const;
  QString storageDetails() const;
  QString storageSqliteVersion() const;
  QString workspaceMode() const;
  int windowWidth() const;
  int windowHeight() const;
  QString windowMode() const;
  bool windowMaximized() const;
  bool windowSettingsLoaded() const;
  QString settingsDetails() const;
  QString startupTargetSurface() const;
  QString commissioningStage() const;
  QString hardwareProfile() const;
  QString controlSurfaceBaseUrl() const;
  bool controlSurfaceAvailable() const;
  QString controlSurfaceStatus() const;
  QString controlSurfaceDetails() const;
  bool appSnapshotLoaded() const;
  QString appSnapshotDetails() const;
  bool commissioningSnapshotLoaded() const;
  QString commissioningDetails() const;
  QString commissioningConfigDetails() const;
  QString commissioningReadinessDetails() const;
  QVariantList commissioningSteps() const;
  QVariantList commissioningChecks() const;
  int commissioningPlanningProjectCount() const;
  int commissioningPlanningTaskCount() const;
  QString commissioningLightingBridgeIp() const;
  int commissioningLightingUniverse() const;
  QString commissioningAudioSendHost() const;
  int commissioningAudioSendPort() const;
  int commissioningAudioReceivePort() const;
  bool lightingSnapshotLoaded() const;
  QString lightingDetails() const;
  QString lightingStatus() const;
  QString lightingAdapterMode() const;
  bool lightingEnabled() const;
  QString lightingBridgeIp() const;
  int lightingUniverse() const;
  int lightingGrandMaster() const;
  QVariantList lightingFixtures() const;
  QVariantList lightingGroups() const;
  QVariantList lightingScenes() const;
  int lightingFixtureCount() const;
  int lightingGroupCount() const;
  int lightingSceneCount() const;
  bool lightingConnected() const;
  bool lightingReachable() const;
  QString lightingSelectedSceneId() const;
  QString lightingSelectedFixtureId() const;
  QVariantMap lightingCameraMarker() const;
  QVariantMap lightingSubjectMarker() const;
  bool lightingDmxMonitorLoaded() const;
  QVariantList lightingDmxChannels() const;
  bool audioSnapshotLoaded() const;
  QString audioDetails() const;
  QString audioStatus() const;
  QString audioAdapterMode() const;
  QString audioMeteringState() const;
  QString audioConsoleStateConfidence() const;
  QString audioLastConsoleSyncAt() const;
  QString audioLastConsoleSyncReason() const;
  QString audioLastRecalledSnapshotId() const;
  QString audioLastSnapshotRecallAt() const;
  QString audioLastActionStatus() const;
  QString audioLastActionCode() const;
  QString audioLastActionMessage() const;
  bool audioOscEnabled() const;
  QString audioSelectedChannelId() const;
  QString audioSelectedMixTargetId() const;
  bool audioExpectedPeakData() const;
  bool audioExpectedSubmixLock() const;
  bool audioExpectedCompatibilityMode() const;
  int audioFadersPerBank() const;
  QString audioSendHost() const;
  int audioSendPort() const;
  int audioReceivePort() const;
  QVariantList audioChannels() const;
  QVariantList audioMixTargets() const;
  QVariantList audioSnapshots() const;
  int audioChannelCount() const;
  int audioMixTargetCount() const;
  int audioSnapshotCount() const;
  bool audioConnected() const;
  bool audioVerified() const;
  bool supportSnapshotLoaded() const;
  QString supportDetails() const;
  QString supportRestoreDetails() const;
  QString supportBackupDir() const;
  QVariantList supportBackupFiles() const;
  int supportBackupCount() const;
  QString supportLatestBackupPath() const;
  QString shellDiagnosticsExportPath() const;
  QString companionExportPath() const;
  bool planningSnapshotLoaded() const;
  QString planningDetails() const;
  QVariantList planningProjects() const;
  QVariantList planningTasks() const;
  QVariantList planningActivityLog() const;
  int planningProjectCount() const;
  int planningTaskCount() const;
  int planningRunningTaskCount() const;
  int planningCompletedTaskCount() const;
  QString planningViewFilter() const;
  QString planningSortBy() const;
  QString planningModeSection() const;
  int planningTimelineStartHour() const;
  int planningTimelineEndHour() const;
  QString planningSelectedProjectId() const;
  QString planningSelectedTaskId() const;
  bool planningTimeReportLoaded() const;
  int planningTotalTrackedSeconds() const;
  QVariantList planningTimeByProject() const;
  QVariantList planningTimeByTask() const;
  QVariantList planningTimerEvents() const;
  bool controlSurfaceSnapshotLoaded() const;
  QVariantList controlSurfacePages() const;
  bool operatorUiReady() const;
  bool canRetry() const;
  bool processRunning() const;

  Q_INVOKABLE void start();
  Q_INVOKABLE void stop();
  Q_INVOKABLE void ping();
  Q_INVOKABLE void requestHealthSnapshot();
  Q_INVOKABLE void retryStart();
  Q_INVOKABLE void requestSettings();
  Q_INVOKABLE void requestCommissioningSnapshot();
  Q_INVOKABLE void requestLightingSnapshot();
  Q_INVOKABLE void requestAudioSnapshot();
  Q_INVOKABLE void requestSupportSnapshot();
  Q_INVOKABLE void requestPlanningSnapshot();
  Q_INVOKABLE void requestPlanningTimeReport(const QString &projectId = QString());
  Q_INVOKABLE void requestControlSurfaceSnapshot();
  Q_INVOKABLE void requestLightingDmxMonitorSnapshot();
  Q_INVOKABLE void recallLightingScene(const QString &sceneId, double fadeDurationSeconds = 0.0);
  Q_INVOKABLE void createLightingGroup(const QString &name);
  Q_INVOKABLE void updateLightingGroup(const QString &groupId, const QVariantMap &changes);
  Q_INVOKABLE void deleteLightingGroup(const QString &groupId);
  Q_INVOKABLE void createLightingScene(const QString &name);
  Q_INVOKABLE void updateLightingScene(const QString &sceneId, const QVariantMap &changes);
  Q_INVOKABLE void deleteLightingScene(const QString &sceneId);
  Q_INVOKABLE void createLightingFixture(const QVariantMap &fixture);
  Q_INVOKABLE void updateLightingFixture(const QString &fixtureId, const QVariantMap &changes);
  Q_INVOKABLE void deleteLightingFixture(const QString &fixtureId);
  Q_INVOKABLE void updateLightingSettings(const QVariantMap &changes);
  Q_INVOKABLE void setLightingFixturePower(const QString &fixtureId, bool on);
  Q_INVOKABLE void setLightingAllPower(bool on);
  Q_INVOKABLE void setLightingGroupPower(const QString &groupId, bool on);
  Q_INVOKABLE void syncAudioConsole();
  Q_INVOKABLE void createAudioSnapshot(const QString &name, int oscIndex);
  Q_INVOKABLE void updateAudioSnapshot(const QString &snapshotId, const QVariantMap &changes);
  Q_INVOKABLE void deleteAudioSnapshot(const QString &snapshotId);
  Q_INVOKABLE void recallAudioSnapshot(const QString &snapshotId);
  Q_INVOKABLE void updateAudioChannel(const QString &channelId, const QVariantMap &changes);
  Q_INVOKABLE void updateAudioMixTarget(const QString &mixTargetId, const QVariantMap &changes);
  Q_INVOKABLE void updateAudioSettings(const QVariantMap &changes);
  Q_INVOKABLE void openAppDataDirectory();
  Q_INVOKABLE void openDiagnosticsDirectory();
  Q_INVOKABLE void openLogsDirectory();
  Q_INVOKABLE void openEngineLogFile();
  Q_INVOKABLE void openSupportBackupDirectory();
  Q_INVOKABLE void exportSupportBackup();
  Q_INVOKABLE void exportCompanionConfig(const QString &baseUrlOverride = QString());
  Q_INVOKABLE void restoreSupportBackup(const QString &path);
  Q_INVOKABLE void exportShellDiagnostics();
  Q_INVOKABLE void openShellDiagnosticsFile();
  Q_INVOKABLE void createPlanningProject(const QString &title);
  Q_INVOKABLE void createPlanningProjectWithDetails(
    const QString &title,
    const QString &description,
    const QString &status,
    const QString &priority
  );
  Q_INVOKABLE void createPlanningTask(const QString &projectId, const QString &title);
  Q_INVOKABLE void createPlanningTaskWithDetails(
    const QString &projectId,
    const QString &title,
    const QString &description,
    const QString &priority,
    const QString &dueDate,
    const QString &labelsCsv
  );
  Q_INVOKABLE void selectPlanningProject(const QString &projectId);
  Q_INVOKABLE void selectPlanningTask(const QString &taskId);
  Q_INVOKABLE void cyclePlanningProject(const QString &direction);
  Q_INVOKABLE void cyclePlanningTask(const QString &direction);
  Q_INVOKABLE void updatePlanningProject(
    const QString &projectId,
    const QString &title,
    const QString &description,
    const QString &priority
  );
  Q_INVOKABLE void deletePlanningProject(const QString &projectId);
  Q_INVOKABLE void movePlanningProject(const QString &projectId, const QString &direction);
  Q_INVOKABLE void setPlanningProjectStatus(const QString &projectId, const QString &status);
  Q_INVOKABLE void reorderPlanningProject(
    const QString &projectId,
    const QString &status,
    int newIndex
  );
  Q_INVOKABLE void updatePlanningTask(
    const QString &taskId,
    const QString &title,
    const QString &description,
    const QString &priority,
    const QString &dueDate,
    const QString &labelsCsv
  );
  Q_INVOKABLE void reschedulePlanningTask(
    const QString &taskId,
    const QVariant &scheduledStart,
    const QVariant &scheduledDuration
  );
  Q_INVOKABLE void deletePlanningTask(const QString &taskId);
  Q_INVOKABLE void movePlanningTask(const QString &taskId, const QString &direction);
  Q_INVOKABLE void addPlanningChecklistItem(const QString &taskId, const QString &text);
  Q_INVOKABLE void setPlanningChecklistItemDone(const QString &taskId, const QString &itemId, bool done);
  Q_INVOKABLE void deletePlanningChecklistItem(const QString &taskId, const QString &itemId);
  Q_INVOKABLE void togglePlanningTaskTimer(const QString &taskId);
  Q_INVOKABLE void togglePlanningTaskComplete(const QString &taskId);
  Q_INVOKABLE void updatePlanningSettings(const QVariantMap &changes);
  Q_INVOKABLE void updateCommissioningStage(const QString &stage);
  Q_INVOKABLE void updateHardwareProfile(const QString &hardwareProfile);
  Q_INVOKABLE void runControlSurfaceProbe();
  Q_INVOKABLE void runLightingProbe(const QString &bridgeIp, int universe);
  Q_INVOKABLE void runAudioProbe(const QString &sendHost, int sendPort, int receivePort);
  Q_INVOKABLE void loadParityFixture(const QString &fixtureId, bool replaceExistingData = true);
  Q_INVOKABLE void seedCommissioningSamplePlanning(bool replaceExistingData);
  Q_INVOKABLE void setWorkspaceMode(const QString &workspaceMode);
  Q_INVOKABLE void syncWindowState(int width, int height, const QString &windowMode);

signals:
  void stateChanged();
  void startupPhaseChanged();
  void operatorUiReadyChanged();
  void messageChanged();
  void healthStatusChanged();
  void diagnosticsChanged();
  void settingsChanged();
  void appSnapshotChanged();
  void commissioningSnapshotChanged();
  void lightingSnapshotChanged();
  void lightingDmxMonitorChanged();
  void audioSnapshotChanged();
  void supportSnapshotChanged();
  void planningSnapshotChanged();
  void planningTimeReportChanged();
  void controlSurfaceSnapshotChanged();

private:
  void setState(State nextState, const QString &nextMessage = QString());
  void setStartupPhase(StartupPhase nextPhase);
  void setHealthStatus(const QString &nextHealthStatus);
  void setFailure(const QString &message, const QString &errorCode = QString());
  bool ensureRuntimeDirectories(QString *errorMessage = nullptr) const;
  QString resolveEngineProgram() const;
  QByteArray buildRequest(const QString &id, const QString &method, const QJsonObject &params) const;
  QString formatError(const QJsonObject &error) const;
  bool openPathTarget(const QString &path, const QString &targetLabel, bool requireFile = false);
  void refreshLogExcerpt();
  void updateRuntimePaths(const QJsonObject &paths);
  void startStartupWatchdog();
  void stopStartupWatchdog();
  void resetCommissioningSnapshot(const QString &details);
  void resetLightingSnapshot(const QString &details);
  void resetLightingDmxMonitor();
  void resetAudioSnapshot(const QString &details);
  void resetSupportSnapshot(const QString &details);
  void resetPlanningSnapshot(const QString &details);
  void resetPlanningTimeReport();
  void resetControlSurfaceSnapshot();
  void applyAppSnapshot(const QJsonObject &result);
  void requestAppSnapshot(const QString &requestId, bool startupRequest);
  void handleStdout();
  void handleStderr();
  void processMessage(const QJsonObject &object);

  QProcess m_process;
  QTimer m_startupWatchdog;
  QTimer m_runtimeRefreshTimer;
  QByteArray m_stdoutBuffer;
  QByteArray m_stderrBuffer;
  State m_state = State::Stopped;
  StartupPhase m_startupPhase = StartupPhase::Idle;
  QString m_message = "Engine has not started yet.";
  QString m_healthStatus = "Unknown";
  QString m_engineLogPath;
  QString m_databasePath;
  QString m_lastError;
  QString m_engineVersion = "unknown";
  QString m_protocolVersion = "1";
  QString m_runtimeAppDataPath;
  QString m_runtimeLogsPath;
  QString m_recentLogExcerpt = "No engine log excerpt available yet.";
  QString m_healthDetails = "Health snapshot not loaded yet.";
  QString m_storageDetails = "No storage diagnostics available yet.";
  QString m_storageSqliteVersion = "unknown";
  QString m_workspaceMode = "planning";
  int m_windowWidth = 1280;
  int m_windowHeight = 800;
  QString m_windowMode = "fullscreen";
  bool m_windowMaximized = false;
  bool m_windowSettingsLoaded = false;
  QString m_settingsDetails = "Settings not loaded yet.";
  QString m_startupTargetSurface = "unknown";
  QString m_commissioningStage = "unknown";
  QString m_hardwareProfile = "unknown";
  QString m_controlSurfaceBaseUrl;
  bool m_controlSurfaceAvailable = false;
  QString m_controlSurfaceStatus = "unavailable";
  QString m_controlSurfaceDetails = "Control-surface bridge not reported yet.";
  bool m_appSnapshotLoaded = false;
  QString m_appSnapshotDetails = "Application snapshot not loaded yet.";
  bool m_commissioningSnapshotLoaded = false;
  QString m_commissioningDetails = "Commissioning snapshot not loaded yet.";
  QString m_commissioningConfigDetails = "Commissioning configuration not loaded yet.";
  QString m_commissioningReadinessDetails = "Commissioning readiness not loaded yet.";
  QVariantList m_commissioningSteps;
  QVariantList m_commissioningChecks;
  int m_commissioningPlanningProjectCount = 0;
  int m_commissioningPlanningTaskCount = 0;
  QString m_commissioningLightingBridgeIp;
  int m_commissioningLightingUniverse = 1;
  QString m_commissioningAudioSendHost = "127.0.0.1";
  int m_commissioningAudioSendPort = 7001;
  int m_commissioningAudioReceivePort = 9001;
  bool m_lightingSnapshotLoaded = false;
  QString m_lightingDetails = "Lighting snapshot not loaded yet.";
  QString m_lightingStatus = "unconfigured";
  QString m_lightingAdapterMode = "simulated";
  bool m_lightingEnabled = false;
  QString m_lightingBridgeIp;
  int m_lightingUniverse = 1;
  int m_lightingGrandMaster = 100;
  QVariantList m_lightingFixtures;
  QVariantList m_lightingGroups;
  QVariantList m_lightingScenes;
  int m_lightingFixtureCount = 0;
  int m_lightingGroupCount = 0;
  int m_lightingSceneCount = 0;
  bool m_lightingConnected = false;
  bool m_lightingReachable = false;
  QString m_lightingSelectedSceneId;
  QString m_lightingSelectedFixtureId;
  QVariantMap m_lightingCameraMarker;
  QVariantMap m_lightingSubjectMarker;
  bool m_lightingDmxMonitorLoaded = false;
  QVariantList m_lightingDmxChannels;
  bool m_audioSnapshotLoaded = false;
  QString m_audioDetails = "Audio snapshot not loaded yet.";
  QString m_audioStatus = "not-verified";
  QString m_audioAdapterMode = "simulated";
  QString m_audioMeteringState = "disabled";
  QString m_audioConsoleStateConfidence = "unknown";
  QString m_audioLastConsoleSyncAt;
  QString m_audioLastConsoleSyncReason;
  QString m_audioLastRecalledSnapshotId;
  QString m_audioLastSnapshotRecallAt;
  QString m_audioLastActionStatus = "unknown";
  QString m_audioLastActionCode;
  QString m_audioLastActionMessage;
  bool m_audioOscEnabled = true;
  QString m_audioSelectedChannelId;
  QString m_audioSelectedMixTargetId = "audio-mix-main";
  bool m_audioExpectedPeakData = true;
  bool m_audioExpectedSubmixLock = true;
  bool m_audioExpectedCompatibilityMode = false;
  int m_audioFadersPerBank = 12;
  QString m_audioSendHost = "127.0.0.1";
  int m_audioSendPort = 7001;
  int m_audioReceivePort = 9001;
  QVariantList m_audioChannels;
  QVariantList m_audioMixTargets;
  QVariantList m_audioSnapshots;
  int m_audioChannelCount = 0;
  int m_audioMixTargetCount = 0;
  int m_audioSnapshotCount = 0;
  bool m_audioConnected = false;
  bool m_audioVerified = false;
  bool m_supportSnapshotLoaded = false;
  QString m_supportDetails = "Support snapshot not loaded yet.";
  QString m_supportRestoreDetails = "Support restore capabilities not loaded yet.";
  QString m_supportBackupDir;
  QVariantList m_supportBackupFiles;
  int m_supportBackupCount = 0;
  QString m_supportLatestBackupPath;
  QString m_shellDiagnosticsExportPath;
  QString m_companionExportPath;
  bool m_planningSnapshotLoaded = false;
  QString m_planningDetails = "Planning snapshot not loaded yet.";
  QVariantList m_planningProjects;
  QVariantList m_planningTasks;
  QVariantList m_planningActivityLog;
  int m_planningProjectCount = 0;
  int m_planningTaskCount = 0;
  int m_planningRunningTaskCount = 0;
  int m_planningCompletedTaskCount = 0;
  QString m_planningViewFilter = "all";
  QString m_planningSortBy = "manual";
  QString m_planningModeSection = "timeline";
  int m_planningTimelineStartHour = 9;
  int m_planningTimelineEndHour = 22;
  QString m_planningSelectedProjectId;
  QString m_planningSelectedTaskId;
  bool m_planningTimeReportLoaded = false;
  int m_planningTotalTrackedSeconds = 0;
  QVariantList m_planningTimeByProject;
  QVariantList m_planningTimeByTask;
  QVariantList m_planningTimerEvents;
  bool m_controlSurfaceSnapshotLoaded = false;
  QVariantList m_controlSurfacePages;
  bool m_shutdownRequested = false;
};
