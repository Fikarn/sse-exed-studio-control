#include "EngineProcess.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <QStandardPaths>
#include <QStringList>
#include <QTextStream>
#include <QUrl>
#include <QVariantMap>

#include <algorithm>

namespace {

QString defaultEngineName() {
#ifdef Q_OS_WIN
  return "studio-control-engine.exe";
#else
  return "studio-control-engine";
#endif
}

constexpr int kStartupWatchdogMs = 12000;
constexpr int kRuntimeRefreshMs = 2500;

QVariantMap findPlanningItemById(const QVariantList &items, const QString &itemId) {
  for (const QVariant &itemValue : items) {
    const QVariantMap item = itemValue.toMap();
    if (item.value("id").toString() == itemId) {
      return item;
    }
  }

  return {};
}

int projectIndexWithinStatus(const QVariantList &projects, const QString &projectId, const QString &status) {
  int indexWithinStatus = 0;
  for (const QVariant &projectValue : projects) {
    const QVariantMap project = projectValue.toMap();
    if (project.value("status").toString() != status) {
      continue;
    }
    if (project.value("id").toString() == projectId) {
      return indexWithinStatus;
    }
    indexWithinStatus += 1;
  }

  return -1;
}

int projectCountForStatus(const QVariantList &projects, const QString &status) {
  int count = 0;
  for (const QVariant &projectValue : projects) {
    if (projectValue.toMap().value("status").toString() == status) {
      count += 1;
    }
  }

  return count;
}

int taskIndexWithinProject(const QVariantList &tasks, const QString &taskId, const QString &projectId) {
  int indexWithinProject = 0;
  for (const QVariant &taskValue : tasks) {
    const QVariantMap task = taskValue.toMap();
    if (task.value("projectId").toString() != projectId) {
      continue;
    }
    if (task.value("id").toString() == taskId) {
      return indexWithinProject;
    }
    indexWithinProject += 1;
  }

  return -1;
}

int taskCountForProject(const QVariantList &tasks, const QString &projectId) {
  int count = 0;
  for (const QVariant &taskValue : tasks) {
    if (taskValue.toMap().value("projectId").toString() == projectId) {
      count += 1;
    }
  }

  return count;
}

int deltaFromDirection(const QString &direction) {
  if (direction == "prev") {
    return -1;
  }
  if (direction == "next") {
    return 1;
  }

  return 0;
}

QJsonArray labelsArrayFromCsv(const QString &labelsCsv) {
  QJsonArray labels;
  for (const QString &part : labelsCsv.split(',', Qt::SkipEmptyParts)) {
    const QString trimmed = part.trimmed();
    if (!trimmed.isEmpty()) {
      labels.append(trimmed);
    }
  }

  return labels;
}

#ifdef SSE_QT_SHELL_SOURCE_DIR
QString shellSourceDir() {
  return QStringLiteral(SSE_QT_SHELL_SOURCE_DIR);
}
#endif

QString normalizedHealthStatus(const QString &status) {
  if (status == "ok") {
    return QStringLiteral("healthy");
  }

  if (status == "warn") {
    return QStringLiteral("degraded");
  }

  return status;
}

}  // namespace

EngineProcess::EngineProcess(QObject *parent) : QObject(parent) {
  m_process.setProcessChannelMode(QProcess::SeparateChannels);
  m_startupWatchdog.setSingleShot(true);
  m_runtimeRefreshTimer.setInterval(kRuntimeRefreshMs);
  m_runtimeRefreshTimer.setSingleShot(false);

  connect(&m_startupWatchdog, &QTimer::timeout, this, [this]() {
    if (m_process.state() == QProcess::NotRunning || m_startupPhase == StartupPhase::Ready) {
      return;
    }

    setFailure(
      QString("Startup timed out while %1 after %2 seconds.")
        .arg(startupPhaseLabel().toLower())
        .arg(kStartupWatchdogMs / 1000),
      "STARTUP_TIMEOUT"
    );
    m_process.kill();
    m_process.waitForFinished(1000);
  });

  connect(&m_runtimeRefreshTimer, &QTimer::timeout, this, [this]() {
    if (m_process.state() != QProcess::Running || m_state != State::Running || m_startupPhase != StartupPhase::Ready) {
      return;
    }

    m_process.write(buildRequest("poll-health", "health.snapshot", QJsonObject{}));
    m_process.write(buildRequest("poll-planning-snapshot", "planning.snapshot", QJsonObject{}));
    m_process.write(buildRequest("poll-planning-time-report", "planning.report.time", QJsonObject{}));
    m_process.write(buildRequest("poll-lighting-snapshot", "lighting.snapshot", QJsonObject{}));
    m_process.write(buildRequest("poll-lighting-dmx-monitor", "lighting.dmxMonitor.snapshot", QJsonObject{}));
    m_process.write(buildRequest("poll-audio-snapshot", "audio.snapshot", QJsonObject{}));
  });

  connect(&m_process, &QProcess::started, this, [this]() {
    setStartupPhase(StartupPhase::WaitingForReadyEvent);
    setState(State::Starting, "Engine process started. Waiting for engine.ready...");
    startStartupWatchdog();
  });

  connect(&m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
    if (m_shutdownRequested) {
      return;
    }

    m_runtimeRefreshTimer.stop();
    setFailure(QString("Engine process error: %1").arg(m_process.errorString()), "PROCESS_ERROR");
  });

  connect(
    &m_process,
    qOverload<int, QProcess::ExitStatus>(&QProcess::finished),
    this,
    [this](int exitCode, QProcess::ExitStatus exitStatus) {
      stopStartupWatchdog();
      m_runtimeRefreshTimer.stop();

      if (m_shutdownRequested) {
        m_shutdownRequested = false;
        setStartupPhase(StartupPhase::Idle);
        setState(State::Stopped, "Engine stopped.");
        return;
      }

      if (m_state == State::Failed && m_startupPhase == StartupPhase::Failed) {
        return;
      }

      const QString statusText = exitStatus == QProcess::NormalExit ? "normal" : "crashed";
      setFailure(QString("Engine exited (%1, code %2).").arg(statusText).arg(exitCode), "PROCESS_EXIT");
    }
  );

  connect(&m_process, &QProcess::readyReadStandardOutput, this, &EngineProcess::handleStdout);
  connect(&m_process, &QProcess::readyReadStandardError, this, &EngineProcess::handleStderr);
}

EngineProcess::State EngineProcess::state() const {
  return m_state;
}

EngineProcess::StartupPhase EngineProcess::startupPhase() const {
  return m_startupPhase;
}

QString EngineProcess::stateLabel() const {
  switch (m_state) {
    case State::Stopped:
      return "Stopped";
    case State::Starting:
      return "Starting";
    case State::Running:
      return "Running";
    case State::Failed:
      return "Failed";
  }

  return "Unknown";
}

QString EngineProcess::startupPhaseLabel() const {
  switch (m_startupPhase) {
    case StartupPhase::Idle:
      return "Idle";
    case StartupPhase::LaunchingProcess:
      return "Launching process";
    case StartupPhase::WaitingForReadyEvent:
      return "Waiting for ready event";
    case StartupPhase::WaitingForHealthSnapshot:
      return "Waiting for health snapshot";
    case StartupPhase::WaitingForAppSnapshot:
      return "Waiting for app snapshot";
    case StartupPhase::Ready:
      return "Ready";
    case StartupPhase::Failed:
      return "Failed";
  }

  return "Unknown";
}

QString EngineProcess::message() const {
  return m_message;
}

QString EngineProcess::healthStatus() const {
  return m_healthStatus;
}

QString EngineProcess::diagnosticsPath() const {
  return appDataPath();
}

QString EngineProcess::appDataPath() const {
  if (!m_runtimeAppDataPath.isEmpty()) {
    return m_runtimeAppDataPath;
  }

  return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
}

QString EngineProcess::logsPath() const {
  if (!m_runtimeLogsPath.isEmpty()) {
    return m_runtimeLogsPath;
  }

  return QDir(appDataPath()).filePath("logs");
}

QString EngineProcess::engineLogPath() const {
  return m_engineLogPath;
}

QString EngineProcess::databasePath() const {
  return m_databasePath;
}

QString EngineProcess::lastError() const {
  return m_lastError;
}

QString EngineProcess::engineVersion() const {
  return m_engineVersion;
}

QString EngineProcess::protocolVersion() const {
  return m_protocolVersion;
}

QString EngineProcess::recentLogExcerpt() const {
  return m_recentLogExcerpt;
}

QString EngineProcess::healthDetails() const {
  return m_healthDetails;
}

QString EngineProcess::storageDetails() const {
  return m_storageDetails;
}

QString EngineProcess::storageSqliteVersion() const {
  return m_storageSqliteVersion;
}

QString EngineProcess::workspaceMode() const {
  return m_workspaceMode;
}

int EngineProcess::windowWidth() const {
  return m_windowWidth;
}

int EngineProcess::windowHeight() const {
  return m_windowHeight;
}

QString EngineProcess::windowMode() const {
  return m_windowMode;
}

bool EngineProcess::windowMaximized() const {
  return m_windowMaximized;
}

bool EngineProcess::windowSettingsLoaded() const {
  return m_windowSettingsLoaded;
}

QString EngineProcess::settingsDetails() const {
  return m_settingsDetails;
}

QString EngineProcess::startupTargetSurface() const {
  return m_startupTargetSurface;
}

QString EngineProcess::commissioningStage() const {
  return m_commissioningStage;
}

QString EngineProcess::hardwareProfile() const {
  return m_hardwareProfile;
}

QString EngineProcess::controlSurfaceBaseUrl() const {
  return m_controlSurfaceBaseUrl;
}

bool EngineProcess::controlSurfaceAvailable() const {
  return m_controlSurfaceAvailable;
}

QString EngineProcess::controlSurfaceStatus() const {
  return m_controlSurfaceStatus;
}

QString EngineProcess::controlSurfaceDetails() const {
  return m_controlSurfaceDetails;
}

bool EngineProcess::appSnapshotLoaded() const {
  return m_appSnapshotLoaded;
}

QString EngineProcess::appSnapshotDetails() const {
  return m_appSnapshotDetails;
}

bool EngineProcess::commissioningSnapshotLoaded() const {
  return m_commissioningSnapshotLoaded;
}

QString EngineProcess::commissioningDetails() const {
  return m_commissioningDetails;
}

QString EngineProcess::commissioningConfigDetails() const {
  return m_commissioningConfigDetails;
}

QString EngineProcess::commissioningReadinessDetails() const {
  return m_commissioningReadinessDetails;
}

QVariantList EngineProcess::commissioningSteps() const {
  return m_commissioningSteps;
}

QVariantList EngineProcess::commissioningChecks() const {
  return m_commissioningChecks;
}

int EngineProcess::commissioningPlanningProjectCount() const {
  return m_commissioningPlanningProjectCount;
}

int EngineProcess::commissioningPlanningTaskCount() const {
  return m_commissioningPlanningTaskCount;
}

QString EngineProcess::commissioningLightingBridgeIp() const {
  return m_commissioningLightingBridgeIp;
}

int EngineProcess::commissioningLightingUniverse() const {
  return m_commissioningLightingUniverse;
}

QString EngineProcess::commissioningAudioSendHost() const {
  return m_commissioningAudioSendHost;
}

int EngineProcess::commissioningAudioSendPort() const {
  return m_commissioningAudioSendPort;
}

int EngineProcess::commissioningAudioReceivePort() const {
  return m_commissioningAudioReceivePort;
}

bool EngineProcess::lightingSnapshotLoaded() const {
  return m_lightingSnapshotLoaded;
}

QString EngineProcess::lightingDetails() const {
  return m_lightingDetails;
}

QString EngineProcess::lightingStatus() const {
  return m_lightingStatus;
}

QString EngineProcess::lightingAdapterMode() const {
  return m_lightingAdapterMode;
}

bool EngineProcess::lightingEnabled() const {
  return m_lightingEnabled;
}

QString EngineProcess::lightingBridgeIp() const {
  return m_lightingBridgeIp;
}

int EngineProcess::lightingUniverse() const {
  return m_lightingUniverse;
}

int EngineProcess::lightingGrandMaster() const {
  return m_lightingGrandMaster;
}

QVariantList EngineProcess::lightingFixtures() const {
  return m_lightingFixtures;
}

QVariantList EngineProcess::lightingGroups() const {
  return m_lightingGroups;
}

QVariantList EngineProcess::lightingScenes() const {
  return m_lightingScenes;
}

int EngineProcess::lightingFixtureCount() const {
  return m_lightingFixtureCount;
}

int EngineProcess::lightingGroupCount() const {
  return m_lightingGroupCount;
}

int EngineProcess::lightingSceneCount() const {
  return m_lightingSceneCount;
}

bool EngineProcess::lightingConnected() const {
  return m_lightingConnected;
}

bool EngineProcess::lightingReachable() const {
  return m_lightingReachable;
}

QString EngineProcess::lightingSelectedSceneId() const {
  return m_lightingSelectedSceneId;
}

QString EngineProcess::lightingSelectedFixtureId() const {
  return m_lightingSelectedFixtureId;
}

QVariantMap EngineProcess::lightingCameraMarker() const {
  return m_lightingCameraMarker;
}

QVariantMap EngineProcess::lightingSubjectMarker() const {
  return m_lightingSubjectMarker;
}

bool EngineProcess::lightingDmxMonitorLoaded() const {
  return m_lightingDmxMonitorLoaded;
}

QVariantList EngineProcess::lightingDmxChannels() const {
  return m_lightingDmxChannels;
}

bool EngineProcess::audioSnapshotLoaded() const {
  return m_audioSnapshotLoaded;
}

QString EngineProcess::audioDetails() const {
  return m_audioDetails;
}

QString EngineProcess::audioStatus() const {
  return m_audioStatus;
}

QString EngineProcess::audioAdapterMode() const {
  return m_audioAdapterMode;
}

QString EngineProcess::audioMeteringState() const {
  return m_audioMeteringState;
}

QString EngineProcess::audioConsoleStateConfidence() const {
  return m_audioConsoleStateConfidence;
}

QString EngineProcess::audioLastConsoleSyncAt() const {
  return m_audioLastConsoleSyncAt;
}

QString EngineProcess::audioLastConsoleSyncReason() const {
  return m_audioLastConsoleSyncReason;
}

QString EngineProcess::audioLastRecalledSnapshotId() const {
  return m_audioLastRecalledSnapshotId;
}

QString EngineProcess::audioLastSnapshotRecallAt() const {
  return m_audioLastSnapshotRecallAt;
}

QString EngineProcess::audioLastActionStatus() const {
  return m_audioLastActionStatus;
}

QString EngineProcess::audioLastActionCode() const {
  return m_audioLastActionCode;
}

QString EngineProcess::audioLastActionMessage() const {
  return m_audioLastActionMessage;
}

bool EngineProcess::audioOscEnabled() const {
  return m_audioOscEnabled;
}

QString EngineProcess::audioSelectedChannelId() const {
  return m_audioSelectedChannelId;
}

QString EngineProcess::audioSelectedMixTargetId() const {
  return m_audioSelectedMixTargetId;
}

bool EngineProcess::audioExpectedPeakData() const {
  return m_audioExpectedPeakData;
}

bool EngineProcess::audioExpectedSubmixLock() const {
  return m_audioExpectedSubmixLock;
}

bool EngineProcess::audioExpectedCompatibilityMode() const {
  return m_audioExpectedCompatibilityMode;
}

int EngineProcess::audioFadersPerBank() const {
  return m_audioFadersPerBank;
}

QString EngineProcess::audioSendHost() const {
  return m_audioSendHost;
}

int EngineProcess::audioSendPort() const {
  return m_audioSendPort;
}

int EngineProcess::audioReceivePort() const {
  return m_audioReceivePort;
}

QVariantList EngineProcess::audioChannels() const {
  return m_audioChannels;
}

QVariantList EngineProcess::audioMixTargets() const {
  return m_audioMixTargets;
}

QVariantList EngineProcess::audioSnapshots() const {
  return m_audioSnapshots;
}

int EngineProcess::audioChannelCount() const {
  return m_audioChannelCount;
}

int EngineProcess::audioMixTargetCount() const {
  return m_audioMixTargetCount;
}

int EngineProcess::audioSnapshotCount() const {
  return m_audioSnapshotCount;
}

bool EngineProcess::audioConnected() const {
  return m_audioConnected;
}

bool EngineProcess::audioVerified() const {
  return m_audioVerified;
}

bool EngineProcess::supportSnapshotLoaded() const {
  return m_supportSnapshotLoaded;
}

QString EngineProcess::supportDetails() const {
  return m_supportDetails;
}

QString EngineProcess::supportRestoreDetails() const {
  return m_supportRestoreDetails;
}

QString EngineProcess::supportBackupDir() const {
  return m_supportBackupDir;
}

QVariantList EngineProcess::supportBackupFiles() const {
  return m_supportBackupFiles;
}

int EngineProcess::supportBackupCount() const {
  return m_supportBackupCount;
}

QString EngineProcess::supportLatestBackupPath() const {
  return m_supportLatestBackupPath;
}

QString EngineProcess::shellDiagnosticsExportPath() const {
  return m_shellDiagnosticsExportPath;
}

QString EngineProcess::companionExportPath() const {
  return m_companionExportPath;
}

bool EngineProcess::planningSnapshotLoaded() const {
  return m_planningSnapshotLoaded;
}

QString EngineProcess::planningDetails() const {
  return m_planningDetails;
}

QVariantList EngineProcess::planningProjects() const {
  return m_planningProjects;
}

QVariantList EngineProcess::planningTasks() const {
  return m_planningTasks;
}

QVariantList EngineProcess::planningActivityLog() const {
  return m_planningActivityLog;
}

int EngineProcess::planningProjectCount() const {
  return m_planningProjectCount;
}

int EngineProcess::planningTaskCount() const {
  return m_planningTaskCount;
}

int EngineProcess::planningRunningTaskCount() const {
  return m_planningRunningTaskCount;
}

int EngineProcess::planningCompletedTaskCount() const {
  return m_planningCompletedTaskCount;
}

QString EngineProcess::planningViewFilter() const {
  return m_planningViewFilter;
}

QString EngineProcess::planningSortBy() const {
  return m_planningSortBy;
}

QString EngineProcess::planningSelectedProjectId() const {
  return m_planningSelectedProjectId;
}

QString EngineProcess::planningSelectedTaskId() const {
  return m_planningSelectedTaskId;
}

bool EngineProcess::planningTimeReportLoaded() const {
  return m_planningTimeReportLoaded;
}

int EngineProcess::planningTotalTrackedSeconds() const {
  return m_planningTotalTrackedSeconds;
}

QVariantList EngineProcess::planningTimeByProject() const {
  return m_planningTimeByProject;
}

QVariantList EngineProcess::planningTimeByTask() const {
  return m_planningTimeByTask;
}

QVariantList EngineProcess::planningTimerEvents() const {
  return m_planningTimerEvents;
}

bool EngineProcess::controlSurfaceSnapshotLoaded() const {
  return m_controlSurfaceSnapshotLoaded;
}

QVariantList EngineProcess::controlSurfacePages() const {
  return m_controlSurfacePages;
}

bool EngineProcess::operatorUiReady() const {
  return m_state == State::Running
         && m_startupPhase == StartupPhase::Ready
         && m_appSnapshotLoaded;
}

bool EngineProcess::canRetry() const {
  return m_state == State::Failed || m_state == State::Stopped;
}

bool EngineProcess::processRunning() const {
  return m_process.state() != QProcess::NotRunning;
}

void EngineProcess::start() {
  if (m_process.state() != QProcess::NotRunning) {
    return;
  }

  const QString program = resolveEngineProgram();
  if (program.isEmpty()) {
    setFailure("Engine binary could not be resolved.", "ENGINE_BINARY_MISSING");
    return;
  }

  QString directoryError;
  const QString envAppDataOverride = qEnvironmentVariable("SSE_APP_DATA_DIR");
  const QString envLogsOverride = qEnvironmentVariable("SSE_LOG_DIR");
  const QString envProtocolOverride = qEnvironmentVariable("SSE_PROTOCOL_VERSION");
  m_runtimeAppDataPath = envAppDataOverride.isEmpty() ? QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) : envAppDataOverride;
  m_runtimeLogsPath = envLogsOverride.isEmpty() ? QDir(m_runtimeAppDataPath).filePath("logs") : envLogsOverride;
  emit diagnosticsChanged();

  if (!ensureRuntimeDirectories(&directoryError)) {
    setFailure(directoryError, "RUNTIME_DIRECTORY_ERROR");
    return;
  }

  QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
  environment.insert("SSE_APP_DATA_DIR", m_runtimeAppDataPath);
  environment.insert("SSE_LOG_DIR", m_runtimeLogsPath);
  environment.insert("SSE_PROTOCOL_VERSION", envProtocolOverride.isEmpty() ? "1" : envProtocolOverride);
  m_process.setProcessEnvironment(environment);

  m_shutdownRequested = false;
  m_lastError.clear();
  m_engineVersion = "unknown";
  m_protocolVersion = envProtocolOverride.isEmpty() ? "1" : envProtocolOverride;
  m_engineLogPath = QDir(m_runtimeLogsPath).filePath("engine.log");
  m_databasePath = QDir(m_runtimeAppDataPath).filePath("studio-control.sqlite3");
  m_recentLogExcerpt = "Waiting for engine diagnostics...";
  emit diagnosticsChanged();
  setHealthStatus("Unknown");
  m_healthDetails = "Waiting for health snapshot...";
  m_storageDetails = "Waiting for storage diagnostics...";
  m_storageSqliteVersion = "unknown";
  emit healthStatusChanged();
  m_workspaceMode = "planning";
  m_windowWidth = 1280;
  m_windowHeight = 800;
  m_windowMode = "fullscreen";
  m_windowMaximized = false;
  m_windowSettingsLoaded = false;
  m_settingsDetails = "Waiting for application snapshot shell state...";
  emit settingsChanged();
  m_startupTargetSurface = "unknown";
  m_commissioningStage = "unknown";
  m_hardwareProfile = "unknown";
  m_controlSurfaceBaseUrl.clear();
  m_controlSurfaceAvailable = false;
  m_controlSurfaceStatus = "unavailable";
  m_controlSurfaceDetails = "Waiting for control-surface bridge details...";
  m_appSnapshotLoaded = false;
  m_appSnapshotDetails = "Waiting for application snapshot...";
  emit appSnapshotChanged();
  resetCommissioningSnapshot("Waiting for commissioning snapshot...");
  resetLightingSnapshot("Waiting for lighting snapshot...");
  resetLightingDmxMonitor();
  resetAudioSnapshot("Waiting for audio snapshot...");
  resetSupportSnapshot("Waiting for support snapshot...");
  resetPlanningSnapshot("Waiting for planning snapshot...");
  resetPlanningTimeReport();
  resetControlSurfaceSnapshot();
  setStartupPhase(StartupPhase::LaunchingProcess);
  setState(State::Starting, QString("Starting engine: %1").arg(program));
  m_process.start(program, {});
  startStartupWatchdog();
}

void EngineProcess::stop() {
  if (m_process.state() == QProcess::NotRunning) {
    stopStartupWatchdog();
    setStartupPhase(StartupPhase::Idle);
    setState(State::Stopped, "Engine is not running.");
    return;
  }

  m_shutdownRequested = true;
  m_process.terminate();
  if (!m_process.waitForFinished(3000)) {
    m_process.kill();
    m_process.waitForFinished(1000);
  }

  stopStartupWatchdog();
  m_runtimeRefreshTimer.stop();
  setHealthStatus("Stopped");
  m_healthDetails = "Health snapshot not loaded yet.";
  m_storageDetails = "No storage diagnostics available yet.";
  m_storageSqliteVersion = "unknown";
  emit healthStatusChanged();
  m_windowSettingsLoaded = false;
  m_settingsDetails = "Application snapshot shell state not loaded yet.";
  emit settingsChanged();
  m_startupTargetSurface = "unknown";
  m_commissioningStage = "unknown";
  m_hardwareProfile = "unknown";
  m_controlSurfaceBaseUrl.clear();
  m_controlSurfaceAvailable = false;
  m_controlSurfaceStatus = "unavailable";
  m_controlSurfaceDetails = "Control-surface bridge not reported yet.";
  m_appSnapshotLoaded = false;
  m_appSnapshotDetails = "Application snapshot not loaded yet.";
  emit appSnapshotChanged();
  resetCommissioningSnapshot("Commissioning snapshot not loaded yet.");
  resetLightingSnapshot("Lighting snapshot not loaded yet.");
  resetLightingDmxMonitor();
  resetAudioSnapshot("Audio snapshot not loaded yet.");
  resetSupportSnapshot("Support snapshot not loaded yet.");
  resetPlanningSnapshot("Planning snapshot not loaded yet.");
  resetPlanningTimeReport();
  resetControlSurfaceSnapshot();
  if (!m_lastError.isEmpty()) {
    m_lastError.clear();
    emit diagnosticsChanged();
  }
  refreshLogExcerpt();
  setStartupPhase(StartupPhase::Idle);
  setState(State::Stopped, "Engine stopped.");
}

void EngineProcess::ping() {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot ping because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  m_process.write(buildRequest("bootstrap-ping", "engine.ping", QJsonObject{}));
}

void EngineProcess::requestHealthSnapshot() {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot request health because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  setStartupPhase(StartupPhase::WaitingForHealthSnapshot);
  startStartupWatchdog();
  m_process.write(buildRequest("startup-health", "health.snapshot", QJsonObject{}));
}

void EngineProcess::retryStart() {
  stop();
  start();
}

void EngineProcess::requestSettings() {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot request app snapshot because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  requestAppSnapshot("app-snapshot", false);
}

void EngineProcess::requestCommissioningSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("commissioning-snapshot", "commissioning.snapshot", QJsonObject{}));
}

void EngineProcess::requestLightingSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("lighting-snapshot", "lighting.snapshot", QJsonObject{}));
}

void EngineProcess::requestAudioSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("audio-snapshot", "audio.snapshot", QJsonObject{}));
}

void EngineProcess::requestSupportSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("support-snapshot", "support.snapshot", QJsonObject{}));
}

void EngineProcess::requestPlanningSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("startup-planning-snapshot", "planning.snapshot", QJsonObject{}));
}

void EngineProcess::requestPlanningTimeReport(const QString &projectId) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  QJsonObject params;
  if (!projectId.trimmed().isEmpty()) {
    params.insert("projectId", projectId.trimmed());
  }
  m_process.write(buildRequest("planning-time-report", "planning.report.time", params));
}

void EngineProcess::requestControlSurfaceSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("control-surface-snapshot", "controlSurface.snapshot", QJsonObject{}));
}

void EngineProcess::requestLightingDmxMonitorSnapshot() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  m_process.write(buildRequest("lighting-dmx-monitor", "lighting.dmxMonitor.snapshot", QJsonObject{}));
}

void EngineProcess::openAppDataDirectory() {
  openPathTarget(appDataPath(), "app data directory");
}

void EngineProcess::openDiagnosticsDirectory() {
  openPathTarget(diagnosticsPath(), "diagnostics directory");
}

void EngineProcess::openLogsDirectory() {
  openPathTarget(logsPath(), "logs directory");
}

void EngineProcess::openEngineLogFile() {
  openPathTarget(engineLogPath(), "engine log file", true);
}

void EngineProcess::openSupportBackupDirectory() {
  openPathTarget(m_supportBackupDir, "backup directory");
}

void EngineProcess::recallLightingScene(const QString &sceneId, double fadeDurationSeconds) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot recall a lighting scene because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedSceneId = sceneId.trimmed();
  if (trimmedSceneId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"sceneId", trimmedSceneId},
    {"fadeDurationSeconds", fadeDurationSeconds},
  };
  m_process.write(buildRequest("lighting-scene-recall", "lighting.scene.recall", params));
}

void EngineProcess::createLightingGroup(const QString &name) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a lighting group because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedName = name.trimmed();
  if (trimmedName.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"name", trimmedName},
  };
  m_process.write(buildRequest("lighting-group-create", "lighting.group.create", params));
}

void EngineProcess::updateLightingGroup(const QString &groupId, const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update a lighting group because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedGroupId = groupId.trimmed();
  if (trimmedGroupId.isEmpty() || changes.isEmpty()) {
    return;
  }

  QJsonObject params = QJsonObject::fromVariantMap(changes);
  params.insert("groupId", trimmedGroupId);
  m_process.write(buildRequest("lighting-group-update", "lighting.group.update", params));
}

void EngineProcess::deleteLightingGroup(const QString &groupId) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot delete a lighting group because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedGroupId = groupId.trimmed();
  if (trimmedGroupId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"groupId", trimmedGroupId},
  };
  m_process.write(buildRequest("lighting-group-delete", "lighting.group.delete", params));
}

void EngineProcess::createLightingScene(const QString &name) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a lighting scene because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedName = name.trimmed();
  if (trimmedName.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"name", trimmedName},
  };
  m_process.write(buildRequest("lighting-scene-create", "lighting.scene.create", params));
}

void EngineProcess::updateLightingScene(const QString &sceneId, const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update a lighting scene because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedSceneId = sceneId.trimmed();
  if (trimmedSceneId.isEmpty() || changes.isEmpty()) {
    return;
  }

  QJsonObject params = QJsonObject::fromVariantMap(changes);
  params.insert("sceneId", trimmedSceneId);
  m_process.write(buildRequest("lighting-scene-update", "lighting.scene.update", params));
}

void EngineProcess::deleteLightingScene(const QString &sceneId) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot delete a lighting scene because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedSceneId = sceneId.trimmed();
  if (trimmedSceneId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"sceneId", trimmedSceneId},
  };
  m_process.write(buildRequest("lighting-scene-delete", "lighting.scene.delete", params));
}

void EngineProcess::createLightingFixture(const QVariantMap &fixture) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a lighting fixture because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  if (fixture.isEmpty()) {
    return;
  }

  const QJsonObject params = QJsonObject::fromVariantMap(fixture);
  m_process.write(buildRequest("lighting-fixture-create", "lighting.fixture.create", params));
}

void EngineProcess::updateLightingFixture(const QString &fixtureId, const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update a lighting fixture because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedFixtureId = fixtureId.trimmed();
  if (trimmedFixtureId.isEmpty() || changes.isEmpty()) {
    return;
  }

  QJsonObject params = QJsonObject::fromVariantMap(changes);
  params.insert("fixtureId", trimmedFixtureId);
  m_process.write(buildRequest("lighting-fixture-update", "lighting.fixture.update", params));
}

void EngineProcess::deleteLightingFixture(const QString &fixtureId) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot delete a lighting fixture because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedFixtureId = fixtureId.trimmed();
  if (trimmedFixtureId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"fixtureId", trimmedFixtureId},
  };
  m_process.write(buildRequest("lighting-fixture-delete", "lighting.fixture.delete", params));
}

void EngineProcess::updateLightingSettings(const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update lighting settings because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  if (changes.isEmpty()) {
    return;
  }

  const QJsonObject params = QJsonObject::fromVariantMap(changes);
  m_process.write(buildRequest("lighting-settings-update", "lighting.settings.update", params));
}

void EngineProcess::setLightingFixturePower(const QString &fixtureId, bool on) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update a lighting fixture because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedFixtureId = fixtureId.trimmed();
  if (trimmedFixtureId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"fixtureId", trimmedFixtureId},
    {"on", on},
  };
  m_process.write(buildRequest("lighting-fixture-update", "lighting.fixture.update", params));
}

void EngineProcess::setLightingAllPower(bool on) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update lighting fixtures because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QJsonObject params{
    {"on", on},
  };
  m_process.write(buildRequest("lighting-all-power", "lighting.power.all", params));
}

void EngineProcess::setLightingGroupPower(const QString &groupId, bool on) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update a lighting group because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedGroupId = groupId.trimmed();
  if (trimmedGroupId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"groupId", trimmedGroupId},
    {"on", on},
  };
  m_process.write(buildRequest("lighting-group-power", "lighting.group.power", params));
}

void EngineProcess::syncAudioConsole() {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot sync audio because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  m_process.write(buildRequest("audio-sync", "audio.sync", QJsonObject{}));
}

void EngineProcess::createAudioSnapshot(const QString &name, int oscIndex) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create an audio snapshot because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedName = name.trimmed();
  if (trimmedName.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"name", trimmedName},
    {"oscIndex", oscIndex},
  };
  m_process.write(buildRequest("audio-snapshot-create", "audio.snapshot.create", params));
}

void EngineProcess::updateAudioSnapshot(const QString &snapshotId, const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update an audio snapshot because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedSnapshotId = snapshotId.trimmed();
  if (trimmedSnapshotId.isEmpty() || changes.isEmpty()) {
    return;
  }

  QJsonObject params = QJsonObject::fromVariantMap(changes);
  params.insert("snapshotId", trimmedSnapshotId);
  m_process.write(buildRequest("audio-snapshot-update", "audio.snapshot.update", params));
}

void EngineProcess::deleteAudioSnapshot(const QString &snapshotId) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot delete an audio snapshot because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedSnapshotId = snapshotId.trimmed();
  if (trimmedSnapshotId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"snapshotId", trimmedSnapshotId},
  };
  m_process.write(buildRequest("audio-snapshot-delete", "audio.snapshot.delete", params));
}

void EngineProcess::recallAudioSnapshot(const QString &snapshotId) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot recall an audio snapshot because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedSnapshotId = snapshotId.trimmed();
  if (trimmedSnapshotId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"snapshotId", trimmedSnapshotId},
  };
  m_process.write(buildRequest("audio-snapshot-recall", "audio.snapshot.recall", params));
}

void EngineProcess::updateAudioChannel(const QString &channelId, const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update an audio channel because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedChannelId = channelId.trimmed();
  if (trimmedChannelId.isEmpty() || changes.isEmpty()) {
    return;
  }

  QJsonObject params = QJsonObject::fromVariantMap(changes);
  params.insert("channelId", trimmedChannelId);
  m_process.write(buildRequest("audio-channel-update", "audio.channel.update", params));
}

void EngineProcess::updateAudioMixTarget(const QString &mixTargetId, const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update an audio mix target because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedMixTargetId = mixTargetId.trimmed();
  if (trimmedMixTargetId.isEmpty() || changes.isEmpty()) {
    return;
  }

  QJsonObject params = QJsonObject::fromVariantMap(changes);
  params.insert("mixTargetId", trimmedMixTargetId);
  m_process.write(buildRequest("audio-mix-target-update", "audio.mixTarget.update", params));
}

void EngineProcess::updateAudioSettings(const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update audio settings because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  if (changes.isEmpty()) {
    return;
  }

  const QJsonObject params = QJsonObject::fromVariantMap(changes);
  m_process.write(buildRequest("audio-settings-update", "audio.settings.update", params));
}

void EngineProcess::createPlanningProject(const QString &title) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a project because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QJsonObject params{
    {"title", title},
  };
  m_process.write(buildRequest("planning-project-create", "planning.project.create", params));
}

void EngineProcess::createPlanningProjectWithDetails(
  const QString &title,
  const QString &description,
  const QString &status,
  const QString &priority
) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a project because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedTitle = title.trimmed();
  if (trimmedTitle.isEmpty()) {
    return;
  }

  QJsonObject params{
    {"title", trimmedTitle},
  };

  const QString trimmedDescription = description.trimmed();
  if (!trimmedDescription.isEmpty()) {
    params.insert("description", trimmedDescription);
  }

  const QString trimmedStatus = status.trimmed();
  if (!trimmedStatus.isEmpty()) {
    params.insert("status", trimmedStatus);
  }

  const QString trimmedPriority = priority.trimmed();
  if (!trimmedPriority.isEmpty()) {
    params.insert("priority", trimmedPriority);
  }

  m_process.write(buildRequest("planning-project-create-detailed", "planning.project.create", params));
}

void EngineProcess::createPlanningTask(const QString &projectId, const QString &title) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a task because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
    {"title", title},
  };
  m_process.write(buildRequest("planning-task-create", "planning.task.create", params));
}

void EngineProcess::createPlanningTaskWithDetails(
  const QString &projectId,
  const QString &title,
  const QString &description,
  const QString &priority,
  const QString &dueDate,
  const QString &labelsCsv
) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot create a task because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmedProjectId = projectId.trimmed();
  const QString trimmedTitle = title.trimmed();
  if (trimmedProjectId.isEmpty() || trimmedTitle.isEmpty()) {
    return;
  }

  QJsonObject params{
    {"projectId", trimmedProjectId},
    {"title", trimmedTitle},
  };

  const QString trimmedDescription = description.trimmed();
  if (!trimmedDescription.isEmpty()) {
    params.insert("description", trimmedDescription);
  }

  const QString trimmedPriority = priority.trimmed();
  if (!trimmedPriority.isEmpty()) {
    params.insert("priority", trimmedPriority);
  }

  params.insert("dueDate", dueDate.trimmed().isEmpty() ? QJsonValue::Null : QJsonValue(dueDate.trimmed()));
  params.insert("labels", labelsArrayFromCsv(labelsCsv));

  m_process.write(buildRequest("planning-task-create-detailed", "planning.task.create", params));
}

void EngineProcess::selectPlanningProject(const QString &projectId) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
  };
  m_process.write(buildRequest("planning-select-project", "planning.select", params));
}

void EngineProcess::selectPlanningTask(const QString &taskId) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
  };
  m_process.write(buildRequest("planning-select-task", "planning.select", params));
}

void EngineProcess::cyclePlanningProject(const QString &direction) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"projectDirection", direction},
  };
  m_process.write(buildRequest("planning-select-project-cycle", "planning.select", params));
}

void EngineProcess::cyclePlanningTask(const QString &direction) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"taskDirection", direction},
  };
  m_process.write(buildRequest("planning-select-task-cycle", "planning.select", params));
}

void EngineProcess::updatePlanningProject(
  const QString &projectId,
  const QString &title,
  const QString &description,
  const QString &priority
) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QString trimmedTitle = title.trimmed();
  const QString trimmedPriority = priority.trimmed();
  if (projectId.isEmpty() || trimmedTitle.isEmpty() || trimmedPriority.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
    {"title", trimmedTitle},
    {"description", description},
    {"priority", trimmedPriority},
  };
  m_process.write(buildRequest("planning-project-update", "planning.project.update", params));
}

void EngineProcess::deletePlanningProject(const QString &projectId) {
  if (m_process.state() != QProcess::Running || projectId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
  };
  m_process.write(buildRequest("planning-project-delete", "planning.project.delete", params));
}

void EngineProcess::movePlanningProject(const QString &projectId, const QString &direction) {
  if (m_process.state() != QProcess::Running || projectId.isEmpty()) {
    return;
  }

  const QVariantMap project = findPlanningItemById(m_planningProjects, projectId);
  const QString status = project.value("status").toString();
  const int currentIndex = projectIndexWithinStatus(m_planningProjects, projectId, status);
  const int laneCount = projectCountForStatus(m_planningProjects, status);
  const int delta = deltaFromDirection(direction);
  if (status.isEmpty() || currentIndex < 0 || laneCount <= 1 || delta == 0) {
    return;
  }

  const int targetIndex = std::max(0, std::min(currentIndex + delta, laneCount - 1));
  if (targetIndex == currentIndex) {
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
    {"newIndex", targetIndex},
  };
  m_process.write(buildRequest("planning-project-move", "planning.project.reorder", params));
}

void EngineProcess::setPlanningProjectStatus(const QString &projectId, const QString &status) {
  if (m_process.state() != QProcess::Running || projectId.isEmpty() || status.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
    {"newStatus", status},
  };
  m_process.write(buildRequest("planning-project-status", "planning.project.reorder", params));
}

void EngineProcess::reorderPlanningProject(
  const QString &projectId,
  const QString &status,
  int newIndex
) {
  if (m_process.state() != QProcess::Running || projectId.isEmpty() || status.isEmpty() || newIndex < 0) {
    return;
  }

  const QJsonObject params{
    {"projectId", projectId},
    {"newStatus", status},
    {"newIndex", newIndex},
  };
  m_process.write(buildRequest("planning-project-reorder", "planning.project.reorder", params));
}

void EngineProcess::updatePlanningTask(
  const QString &taskId,
  const QString &title,
  const QString &description,
  const QString &priority,
  const QString &dueDate,
  const QString &labelsCsv
) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QString trimmedTitle = title.trimmed();
  const QString trimmedPriority = priority.trimmed();
  if (taskId.isEmpty() || trimmedTitle.isEmpty() || trimmedPriority.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
    {"title", trimmedTitle},
    {"description", description},
    {"priority", trimmedPriority},
    {"dueDate", dueDate.trimmed().isEmpty() ? QJsonValue::Null : QJsonValue(dueDate.trimmed())},
    {"labels", labelsArrayFromCsv(labelsCsv)},
  };
  m_process.write(buildRequest("planning-task-update", "planning.task.update", params));
}

void EngineProcess::reschedulePlanningTask(
  const QString &taskId,
  const QVariant &scheduledStart,
  const QVariant &scheduledDuration
) {
  if (m_process.state() != QProcess::Running || taskId.isEmpty()) {
    return;
  }

  QJsonObject params{{"taskId", taskId}};

  if (scheduledStart.isValid()) {
    if (scheduledStart.isNull()) {
      params.insert("scheduledStart", QJsonValue::Null);
    } else {
      const QString trimmed = scheduledStart.toString().trimmed();
      params.insert("scheduledStart", trimmed.isEmpty() ? QJsonValue::Null : QJsonValue(trimmed));
    }
  }

  if (scheduledDuration.isValid()) {
    if (scheduledDuration.isNull()) {
      params.insert("scheduledDurationSeconds", QJsonValue::Null);
    } else {
      bool ok = false;
      const qint64 asInt = scheduledDuration.toLongLong(&ok);
      if (ok) {
        params.insert("scheduledDurationSeconds", QJsonValue(asInt));
      } else {
        params.insert("scheduledDurationSeconds", QJsonValue::Null);
      }
    }
  }

  m_process.write(buildRequest("planning-task-reschedule", "planning.task.reschedule", params));
}

void EngineProcess::deletePlanningTask(const QString &taskId) {
  if (m_process.state() != QProcess::Running || taskId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
  };
  m_process.write(buildRequest("planning-task-delete", "planning.task.delete", params));
}

void EngineProcess::movePlanningTask(const QString &taskId, const QString &direction) {
  if (m_process.state() != QProcess::Running || taskId.isEmpty()) {
    return;
  }

  const QVariantMap task = findPlanningItemById(m_planningTasks, taskId);
  const QString projectId = task.value("projectId").toString();
  const int currentIndex = taskIndexWithinProject(m_planningTasks, taskId, projectId);
  const int taskCount = taskCountForProject(m_planningTasks, projectId);
  const int delta = deltaFromDirection(direction);
  if (projectId.isEmpty() || currentIndex < 0 || taskCount <= 1 || delta == 0) {
    return;
  }

  const int targetIndex = std::max(0, std::min(currentIndex + delta, taskCount - 1));
  if (targetIndex == currentIndex) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
    {"order", targetIndex},
  };
  m_process.write(buildRequest("planning-task-move", "planning.task.update", params));
}

void EngineProcess::addPlanningChecklistItem(const QString &taskId, const QString &text) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QString trimmedText = text.trimmed();
  if (taskId.isEmpty() || trimmedText.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
    {"text", trimmedText},
  };
  m_process.write(buildRequest("planning-task-checklist-add", "planning.task.checklist.add", params));
}

void EngineProcess::setPlanningChecklistItemDone(const QString &taskId, const QString &itemId, bool done) {
  if (m_process.state() != QProcess::Running || taskId.isEmpty() || itemId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
    {"itemId", itemId},
    {"done", done},
  };
  m_process.write(buildRequest("planning-task-checklist-update", "planning.task.checklist.update", params));
}

void EngineProcess::deletePlanningChecklistItem(const QString &taskId, const QString &itemId) {
  if (m_process.state() != QProcess::Running || taskId.isEmpty() || itemId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
    {"itemId", itemId},
  };
  m_process.write(buildRequest("planning-task-checklist-delete", "planning.task.checklist.delete", params));
}

void EngineProcess::togglePlanningTaskTimer(const QString &taskId) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
    {"action", "toggle"},
  };
  m_process.write(buildRequest("planning-task-toggle-timer", "planning.task.timer", params));
}

void EngineProcess::togglePlanningTaskComplete(const QString &taskId) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"taskId", taskId},
  };
  m_process.write(buildRequest("planning-task-toggle-complete", "planning.task.toggleComplete", params));
}

void EngineProcess::updatePlanningSettings(const QVariantMap &changes) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  if (changes.isEmpty()) {
    return;
  }

  const QJsonObject params = QJsonObject::fromVariantMap(changes);
  m_process.write(buildRequest("planning-settings-update", "planning.settings.update", params));
}

void EngineProcess::updateCommissioningStage(const QString &stage) {
  if (m_process.state() != QProcess::Running || stage.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"stage", stage},
  };
  m_process.write(buildRequest("commissioning-update-stage", "commissioning.update", params));
}

void EngineProcess::updateHardwareProfile(const QString &hardwareProfile) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QString trimmed = hardwareProfile.trimmed();
  if (trimmed.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"hardwareProfile", trimmed},
  };
  m_process.write(buildRequest("commissioning-update-profile", "commissioning.update", params));
}

void EngineProcess::runControlSurfaceProbe() {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"target", "control-surface"},
  };
  m_process.write(buildRequest("commissioning-check-control-surface", "commissioning.check.run", params));
}

void EngineProcess::runLightingProbe(const QString &bridgeIp, int universe) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"target", "lighting"},
    {"bridgeIp", bridgeIp.trimmed()},
    {"universe", universe},
  };
  m_process.write(buildRequest("commissioning-check-lighting", "commissioning.check.run", params));
}

void EngineProcess::runAudioProbe(const QString &sendHost, int sendPort, int receivePort) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"target", "audio"},
    {"sendHost", sendHost.trimmed()},
    {"sendPort", sendPort},
    {"receivePort", receivePort},
  };
  m_process.write(buildRequest("commissioning-check-audio", "commissioning.check.run", params));
}

void EngineProcess::loadParityFixture(const QString &fixtureId, bool replaceExistingData) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QString trimmedFixtureId = fixtureId.trimmed();
  if (trimmedFixtureId.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"fixtureId", trimmedFixtureId},
    {"replaceExistingData", replaceExistingData},
  };
  m_process.write(buildRequest("parity-fixture-load", "dev.parityFixture.load", params));
}

void EngineProcess::seedCommissioningSamplePlanning(bool replaceExistingData) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"replaceExistingData", replaceExistingData},
  };
  m_process.write(buildRequest("commissioning-seed-planning", "commissioning.seedPlanningDemo", params));
}

void EngineProcess::exportSupportBackup() {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot export a backup because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  m_process.write(buildRequest("support-backup-export", "support.backup.export", QJsonObject{}));
}

void EngineProcess::exportCompanionConfig(const QString &baseUrlOverride) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot export a Companion profile because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  QJsonObject params;
  const QString trimmedBaseUrlOverride = baseUrlOverride.trimmed();
  if (!trimmedBaseUrlOverride.isEmpty()) {
    params.insert("baseUrl", trimmedBaseUrlOverride);
  }

  m_process.write(buildRequest("companion-export", "exports.companion.export", params));
}

void EngineProcess::restoreSupportBackup(const QString &path) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot restore a backup because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QString trimmed = path.trimmed();
  if (trimmed.isEmpty()) {
    return;
  }

  const QJsonObject params{
    {"path", trimmed},
  };
  m_process.write(buildRequest("support-backup-restore", "support.backup.restore", params));
}

void EngineProcess::exportShellDiagnostics() {
  const QString supportDir = QDir(appDataPath()).filePath("support");
  QDir dir;
  if (!dir.mkpath(supportDir)) {
    const QString error = QString("Failed to create support diagnostics directory: %1").arg(supportDir);
    m_lastError = error;
    emit diagnosticsChanged();
    setState(m_state, error);
    return;
  }

  const QString timestamp = QDateTime::currentDateTimeUtc().toString("yyyy-MM-ddTHH-mm-ss-zzzZ");
  const QString path = QDir(supportDir).filePath(QString("qt-shell-diagnostics-%1.json").arg(timestamp));
  QFile file(path);
  if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
    const QString error = QString("Failed to write shell diagnostics bundle: %1").arg(file.errorString());
    m_lastError = error;
    emit diagnosticsChanged();
    setState(m_state, error);
    return;
  }

  const QJsonObject payload{
    {"exportedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
    {"state", stateLabel()},
    {"startupPhase", startupPhaseLabel()},
    {"message", m_message},
    {"healthStatus", m_healthStatus},
    {"lastError", m_lastError},
    {"runtime",
     QJsonObject{
       {"diagnosticsPath", diagnosticsPath()},
       {"appDataPath", appDataPath()},
       {"logsPath", logsPath()},
       {"engineLogPath", engineLogPath()},
       {"databasePath", databasePath()},
       {"engineVersion", engineVersion()},
       {"protocolVersion", protocolVersion()},
     }},
    {"appSnapshot",
     QJsonObject{
       {"targetSurface", m_startupTargetSurface},
       {"commissioningStage", m_commissioningStage},
       {"hardwareProfile", m_hardwareProfile},
     }},
    {"support",
     QJsonObject{
       {"backupDir", m_supportBackupDir},
       {"backupCount", m_supportBackupCount},
       {"latestBackupPath", m_supportLatestBackupPath},
     }},
    {"recentLogExcerpt", m_recentLogExcerpt},
  };

  file.write(QJsonDocument(payload).toJson(QJsonDocument::Indented));
  file.close();

  m_shellDiagnosticsExportPath = path;
  if (!m_lastError.isEmpty()) {
    m_lastError.clear();
  }
  emit diagnosticsChanged();
  setState(m_state, QString("Shell diagnostics exported to %1").arg(path));
}

void EngineProcess::openShellDiagnosticsFile() {
  openPathTarget(m_shellDiagnosticsExportPath, "shell diagnostics bundle", true);
}

void EngineProcess::setWorkspaceMode(const QString &workspaceMode) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot update settings because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  const QJsonObject params{
    {"workspace", workspaceMode},
  };
  m_process.write(buildRequest("settings-update-workspace", "settings.update", params));
}

void EngineProcess::syncWindowState(int width, int height, const QString &windowMode) {
  if (m_process.state() != QProcess::Running) {
    return;
  }

  const QJsonObject params{
    {"window",
     QJsonObject{
       {"width", width},
       {"height", height},
       {"mode", windowMode},
     }},
  };
  m_process.write(buildRequest("settings-update-window", "settings.update", params));
}

void EngineProcess::setState(State nextState, const QString &nextMessage) {
  const bool operatorUiReadyBefore = operatorUiReady();
  const bool stateChangedFlag = m_state != nextState;
  const bool messageChangedFlag = m_message != nextMessage;

  m_state = nextState;
  if (!nextMessage.isNull()) {
    m_message = nextMessage;
  }
  const bool operatorUiReadyAfter = operatorUiReady();

  if (stateChangedFlag) {
    emit stateChanged();
  }
  if (operatorUiReadyBefore != operatorUiReadyAfter) {
    emit operatorUiReadyChanged();
  }
  if (messageChangedFlag) {
    emit messageChanged();
  }
}

void EngineProcess::setStartupPhase(StartupPhase nextPhase) {
  const bool operatorUiReadyBefore = operatorUiReady();
  if (m_startupPhase == nextPhase) {
    return;
  }

  m_startupPhase = nextPhase;
  emit startupPhaseChanged();
  if (operatorUiReadyBefore != operatorUiReady()) {
    emit operatorUiReadyChanged();
  }
}

void EngineProcess::setHealthStatus(const QString &nextHealthStatus) {
  const bool operatorUiReadyBefore = operatorUiReady();
  const QString normalized = normalizedHealthStatus(nextHealthStatus);
  if (m_healthStatus == normalized) {
    return;
  }

  m_healthStatus = normalized;
  emit healthStatusChanged();
  if (operatorUiReadyBefore != operatorUiReady()) {
    emit operatorUiReadyChanged();
  }
}

void EngineProcess::setFailure(const QString &message, const QString &errorCode) {
  const QString formattedMessage = errorCode.isEmpty() ? message : QString("%1: %2").arg(errorCode).arg(message);
  stopStartupWatchdog();
  m_runtimeRefreshTimer.stop();
  setHealthStatus("Unavailable");
  if (m_lastError != formattedMessage) {
    m_lastError = formattedMessage;
    emit diagnosticsChanged();
  }
  refreshLogExcerpt();
  setStartupPhase(StartupPhase::Failed);
  setState(State::Failed, formattedMessage);
}

bool EngineProcess::ensureRuntimeDirectories(QString *errorMessage) const {
  const QStringList directories = {
    appDataPath(),
    QDir(appDataPath()).filePath("backups"),
    logsPath(),
  };

  for (const QString &directory : directories) {
    if (directory.isEmpty()) {
      if (errorMessage) {
        *errorMessage = "Runtime directory resolution failed.";
      }
      return false;
    }

    QDir dir;
    if (!dir.mkpath(directory)) {
      if (errorMessage) {
        *errorMessage = QString("Failed to create runtime directory: %1").arg(directory);
      }
      return false;
    }
  }

  return true;
}

QString EngineProcess::resolveEngineProgram() const {
  const QString envOverride = qEnvironmentVariable("SSE_ENGINE_PATH");
  if (!envOverride.isEmpty()) {
    return envOverride;
  }

  const QString appDir = QCoreApplication::applicationDirPath();
  const QString bundledCandidate = QDir(appDir).filePath(defaultEngineName());
  if (QFileInfo::exists(bundledCandidate)) {
    return QFileInfo(bundledCandidate).absoluteFilePath();
  }

  const QString resourcesCandidate = QDir(appDir).filePath("../Resources/bin/" + defaultEngineName());
  if (QFileInfo::exists(resourcesCandidate)) {
    return QFileInfo(resourcesCandidate).absoluteFilePath();
  }

#ifdef SSE_QT_SHELL_SOURCE_DIR
  const QStringList developmentCandidates = {
    QDir(shellSourceDir()).filePath("../rust-engine/target/debug/" + defaultEngineName()),
    QDir(shellSourceDir()).filePath("../rust-engine/target/release/" + defaultEngineName()),
  };
  for (const QString &candidate : developmentCandidates) {
    if (QFileInfo::exists(candidate)) {
      return QFileInfo(candidate).absoluteFilePath();
    }
  }
#endif

  return QStandardPaths::findExecutable(defaultEngineName());
}

QByteArray EngineProcess::buildRequest(const QString &id, const QString &method, const QJsonObject &params) const {
  const QJsonObject request{
    {"type", "request"},
    {"id", id},
    {"method", method},
    {"params", params},
  };

  return QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n';
}

QString EngineProcess::formatError(const QJsonObject &error) const {
  const QString code = error.value("code").toString();
  const QString message = error.value("message").toString("Unknown engine error.");
  return code.isEmpty() ? message : QString("%1: %2").arg(code).arg(message);
}

bool EngineProcess::openPathTarget(const QString &path, const QString &targetLabel, bool requireFile) {
  const QFileInfo info(path);
  const bool validTarget = !path.isEmpty() && info.exists() && (!requireFile || info.isFile());
  if (!validTarget) {
    const QString error = QString("%1 does not exist yet: %2").arg(targetLabel, path);
    m_lastError = error;
    emit diagnosticsChanged();
    setState(m_state, error);
    return false;
  }

  if (!QDesktopServices::openUrl(QUrl::fromLocalFile(info.absoluteFilePath()))) {
    const QString error = QString("Failed to open %1: %2").arg(targetLabel, path);
    m_lastError = error;
    emit diagnosticsChanged();
    setState(m_state, error);
    return false;
  }

  if (!m_lastError.isEmpty()) {
    m_lastError.clear();
    emit diagnosticsChanged();
  }
  setState(m_state, QString("Opened %1: %2").arg(targetLabel, path));
  return true;
}

void EngineProcess::refreshLogExcerpt() {
  QString nextExcerpt = "No engine log excerpt available yet.";

  if (!m_engineLogPath.isEmpty()) {
    QFile file(m_engineLogPath);
    if (file.exists()) {
      if (file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QTextStream stream(&file);
        QStringList lines;
        while (!stream.atEnd()) {
          lines.append(stream.readLine());
        }

        const qsizetype startIndex = lines.size() > 12 ? lines.size() - 12 : 0;
        nextExcerpt = lines.mid(startIndex).join('\n').trimmed();
        if (nextExcerpt.isEmpty()) {
          nextExcerpt = "Engine log exists but is currently empty.";
        }
      } else {
        nextExcerpt = QString("Failed to read engine log: %1").arg(file.errorString());
      }
    } else {
      nextExcerpt = QString("Engine log not found yet at %1").arg(m_engineLogPath);
    }
  }

  if (m_recentLogExcerpt != nextExcerpt) {
    m_recentLogExcerpt = nextExcerpt;
    emit diagnosticsChanged();
  }
}

void EngineProcess::updateRuntimePaths(const QJsonObject &paths) {
  bool changed = false;

  const QString nextEngineLogPath = paths.value("logFilePath").toString();
  const QString nextDatabasePath = paths.value("dbPath").toString();

  if (!nextEngineLogPath.isEmpty() && m_engineLogPath != nextEngineLogPath) {
    m_engineLogPath = nextEngineLogPath;
    changed = true;
  }

  if (!nextDatabasePath.isEmpty() && m_databasePath != nextDatabasePath) {
    m_databasePath = nextDatabasePath;
    changed = true;
  }

  if (changed) {
    emit diagnosticsChanged();
    refreshLogExcerpt();
  }
}

void EngineProcess::startStartupWatchdog() {
  m_startupWatchdog.start(kStartupWatchdogMs);
}

void EngineProcess::stopStartupWatchdog() {
  m_startupWatchdog.stop();
}

void EngineProcess::resetCommissioningSnapshot(const QString &details) {
  m_commissioningSnapshotLoaded = false;
  m_commissioningDetails = details;
  m_commissioningConfigDetails = details;
  m_commissioningReadinessDetails = details;
  m_commissioningSteps.clear();
  m_commissioningChecks.clear();
  m_commissioningPlanningProjectCount = 0;
  m_commissioningPlanningTaskCount = 0;
  m_commissioningLightingBridgeIp.clear();
  m_commissioningLightingUniverse = 1;
  m_commissioningAudioSendHost = "127.0.0.1";
  m_commissioningAudioSendPort = 7001;
  m_commissioningAudioReceivePort = 9001;
  emit commissioningSnapshotChanged();
}

void EngineProcess::resetLightingSnapshot(const QString &details) {
  m_lightingSnapshotLoaded = false;
  m_lightingDetails = details;
  m_lightingStatus = "unconfigured";
  m_lightingAdapterMode = "simulated";
  m_lightingEnabled = false;
  m_lightingBridgeIp.clear();
  m_lightingUniverse = 1;
  m_lightingGrandMaster = 100;
  m_lightingFixtures.clear();
  m_lightingGroups.clear();
  m_lightingScenes.clear();
  m_lightingFixtureCount = 0;
  m_lightingGroupCount = 0;
  m_lightingSceneCount = 0;
  m_lightingConnected = false;
  m_lightingReachable = false;
  m_lightingSelectedSceneId.clear();
  m_lightingSelectedFixtureId.clear();
  m_lightingCameraMarker.clear();
  m_lightingSubjectMarker.clear();
  emit lightingSnapshotChanged();
}

void EngineProcess::resetLightingDmxMonitor() {
  m_lightingDmxMonitorLoaded = false;
  m_lightingDmxChannels.clear();
  emit lightingDmxMonitorChanged();
}

void EngineProcess::resetAudioSnapshot(const QString &details) {
  m_audioSnapshotLoaded = false;
  m_audioDetails = details;
  m_audioStatus = "not-verified";
  m_audioAdapterMode = "simulated";
  m_audioMeteringState = "disabled";
  m_audioConsoleStateConfidence = "unknown";
  m_audioLastConsoleSyncAt.clear();
  m_audioLastConsoleSyncReason.clear();
  m_audioLastRecalledSnapshotId.clear();
  m_audioLastSnapshotRecallAt.clear();
  m_audioLastActionStatus = "unknown";
  m_audioLastActionCode.clear();
  m_audioLastActionMessage.clear();
  m_audioOscEnabled = true;
  m_audioSelectedChannelId.clear();
  m_audioSelectedMixTargetId = "audio-mix-main";
  m_audioExpectedPeakData = true;
  m_audioExpectedSubmixLock = true;
  m_audioExpectedCompatibilityMode = false;
  m_audioFadersPerBank = 12;
  m_audioSendHost = "127.0.0.1";
  m_audioSendPort = 7001;
  m_audioReceivePort = 9001;
  m_audioChannels.clear();
  m_audioMixTargets.clear();
  m_audioSnapshots.clear();
  m_audioChannelCount = 0;
  m_audioMixTargetCount = 0;
  m_audioSnapshotCount = 0;
  m_audioConnected = false;
  m_audioVerified = false;
  emit audioSnapshotChanged();
}

void EngineProcess::resetSupportSnapshot(const QString &details) {
  m_supportSnapshotLoaded = false;
  m_supportDetails = details;
  m_supportRestoreDetails = details;
  m_supportBackupDir.clear();
  m_supportBackupFiles.clear();
  m_supportBackupCount = 0;
  m_supportLatestBackupPath.clear();
  emit supportSnapshotChanged();
}

void EngineProcess::resetPlanningSnapshot(const QString &details) {
  m_planningSnapshotLoaded = false;
  m_planningDetails = details;
  m_planningProjects.clear();
  m_planningTasks.clear();
  m_planningActivityLog.clear();
  m_planningProjectCount = 0;
  m_planningTaskCount = 0;
  m_planningRunningTaskCount = 0;
  m_planningCompletedTaskCount = 0;
  m_planningViewFilter = "all";
  m_planningSortBy = "manual";
  m_planningSelectedProjectId.clear();
  m_planningSelectedTaskId.clear();
  emit planningSnapshotChanged();
}

void EngineProcess::resetPlanningTimeReport() {
  m_planningTimeReportLoaded = false;
  m_planningTotalTrackedSeconds = 0;
  m_planningTimeByProject.clear();
  m_planningTimeByTask.clear();
  m_planningTimerEvents.clear();
  emit planningTimeReportChanged();
}

void EngineProcess::resetControlSurfaceSnapshot() {
  m_controlSurfaceSnapshotLoaded = false;
  m_controlSurfacePages.clear();
  emit controlSurfaceSnapshotChanged();
}

void EngineProcess::applyAppSnapshot(const QJsonObject &result) {
  const QJsonObject runtime = result.value("runtime").toObject();
  const QJsonObject controlSurface = runtime.value("controlSurface").toObject();
  const QJsonObject shell = result.value("shell").toObject();
  const QJsonObject window = shell.value("window").toObject();
  const QJsonObject startup = result.value("startup").toObject();
  const QJsonObject commissioning = result.value("commissioning").toObject();

  const QString workspace = shell.value("workspace").toString("planning");
  const int width = static_cast<int>(window.value("width").toInteger(1280));
  const int height = static_cast<int>(window.value("height").toInteger(800));
  const QString windowMode = window.value("mode").toString(
    window.value("maximized").toBool(false) ? "maximized" : "fullscreen"
  );

  m_workspaceMode = workspace;
  m_windowWidth = width;
  m_windowHeight = height;
  m_windowMode = windowMode;
  m_windowMaximized = windowMode == "maximized";
  m_windowSettingsLoaded = true;
  m_settingsDetails = shell.value("summary").toString(
    QString("Workspace '%1', window %2x%3 (%4).")
      .arg(workspace)
      .arg(width)
      .arg(height)
      .arg(windowMode)
  );

  m_startupTargetSurface = startup.value("targetSurface").toString("unknown");
  m_commissioningStage = commissioning.value("stage").toString("unknown");
  m_hardwareProfile = commissioning.value("hardwareProfile").toString("unknown");
  m_controlSurfaceBaseUrl = controlSurface.value("baseUrl").toString();
  m_controlSurfaceAvailable = controlSurface.value("available").toBool(false);
  m_controlSurfaceStatus = controlSurface.value("status").toString("unavailable");
  m_controlSurfaceDetails = controlSurface.value("summary").toString(
    m_controlSurfaceBaseUrl.isEmpty()
      ? QString("Control-surface bridge status '%1'.").arg(m_controlSurfaceStatus)
      : QString("Control-surface bridge '%1' at %2.").arg(m_controlSurfaceStatus).arg(m_controlSurfaceBaseUrl)
  );
  m_appSnapshotLoaded = true;
  m_appSnapshotDetails = result.value("summary").toString(
    QString("Target surface '%1', commissioning stage '%2', hardware profile '%3', control surface '%4'.")
      .arg(m_startupTargetSurface)
      .arg(m_commissioningStage)
      .arg(m_hardwareProfile)
      .arg(m_controlSurfaceBaseUrl.isEmpty() ? m_controlSurfaceStatus : m_controlSurfaceBaseUrl)
  );

  emit settingsChanged();
  emit appSnapshotChanged();
}

void EngineProcess::requestAppSnapshot(const QString &requestId, bool startupRequest) {
  if (m_process.state() != QProcess::Running) {
    setFailure("Cannot request app snapshot because the engine is not running.", "ENGINE_NOT_RUNNING");
    return;
  }

  if (startupRequest) {
    setStartupPhase(StartupPhase::WaitingForAppSnapshot);
    startStartupWatchdog();
  }

  m_process.write(buildRequest(requestId, "app.snapshot", QJsonObject{}));
}

void EngineProcess::handleStdout() {
  m_stdoutBuffer.append(m_process.readAllStandardOutput());

  while (true) {
    const int newlineIndex = m_stdoutBuffer.indexOf('\n');
    if (newlineIndex < 0) {
      return;
    }

    const QByteArray line = m_stdoutBuffer.left(newlineIndex).trimmed();
    m_stdoutBuffer.remove(0, newlineIndex + 1);

    if (line.isEmpty()) {
      continue;
    }

    const QJsonDocument document = QJsonDocument::fromJson(line);
    if (!document.isObject()) {
      setFailure("Engine emitted malformed JSON.", "INVALID_ENGINE_MESSAGE");
      continue;
    }

    processMessage(document.object());
  }
}

void EngineProcess::handleStderr() {
  m_stderrBuffer.append(m_process.readAllStandardError());
  const QList<QByteArray> lines = m_stderrBuffer.split('\n');
  if (lines.isEmpty()) {
    return;
  }

  m_stderrBuffer = lines.last();
  for (qsizetype index = 0; index < lines.size() - 1; index += 1) {
    const QByteArray line = lines.at(index).trimmed();
    if (!line.isEmpty()) {
      const QString text = QString::fromUtf8(line);
      if (m_lastError != text) {
        m_lastError = text;
        emit diagnosticsChanged();
      }
      setState(m_state == State::Stopped ? State::Failed : m_state, text);
    }
  }
}

void EngineProcess::processMessage(const QJsonObject &object) {
  const QString type = object.value("type").toString();

  if (type == "event" && object.value("event").toString() == "engine.ready") {
    const QJsonObject payload = object.value("payload").toObject();
    const QString expectedProtocol = qEnvironmentVariable("SSE_PROTOCOL_VERSION").isEmpty()
                                       ? "1"
                                       : qEnvironmentVariable("SSE_PROTOCOL_VERSION");
    const QString reportedProtocol = payload.value("protocol").toString("unknown");
    if (reportedProtocol != expectedProtocol) {
      m_engineVersion = payload.value("engineVersion").toString("unknown");
      m_protocolVersion = reportedProtocol;
      updateRuntimePaths(payload);
      emit diagnosticsChanged();
      setFailure(
        QString("Shell expected protocol %1 but engine reported %2.")
          .arg(expectedProtocol)
          .arg(reportedProtocol),
        "PROTOCOL_MISMATCH"
      );
      return;
    }

    m_engineVersion = payload.value("engineVersion").toString("unknown");
    m_protocolVersion = reportedProtocol;
    updateRuntimePaths(payload);
    emit diagnosticsChanged();
    setState(
      State::Starting,
      QString("Engine reported ready (version %1, protocol %2). Requesting health snapshot...")
        .arg(m_engineVersion)
        .arg(m_protocolVersion)
    );
    requestHealthSnapshot();
    return;
  }

  if (type == "event" && object.value("event").toString() == "engine.startupFailed") {
    const QJsonObject payload = object.value("payload").toObject();
    const QString stage = payload.value("stage").toString("startup");
    const QString code = payload.value("code").toString("ENGINE_STARTUP_FAILED");
    updateRuntimePaths(payload.value("paths").toObject());
    setFailure(
      QString("Engine reported a startup failure during %1: %2")
        .arg(stage)
        .arg(payload.value("message").toString("Unknown startup failure.")),
      code
    );
    return;
  }

  if (type == "event" && object.value("event").toString() == "planning.changed") {
    requestPlanningSnapshot();
    requestPlanningTimeReport();
    setState(State::Running, "Engine reported planning state changed. Refreshing planning snapshot...");
    return;
  }

  if (type == "event" && object.value("event").toString() == "app.changed") {
    requestAppSnapshot("app-snapshot", false);
    setState(State::Running, "Engine reported app state changed. Refreshing app snapshot...");
    return;
  }

  if (type == "event" && object.value("event").toString() == "settings.changed") {
    requestAppSnapshot("app-snapshot", false);
    setState(State::Running, "Engine reported shell settings changed. Refreshing app snapshot...");
    return;
  }

  if (type == "event" && object.value("event").toString() == "commissioning.changed") {
    requestCommissioningSnapshot();
    requestLightingSnapshot();
    requestAudioSnapshot();
    setState(State::Running, "Engine reported commissioning state changed. Refreshing commissioning snapshot...");
    return;
  }

  if (type == "event" && object.value("event").toString() == "lighting.changed") {
    requestLightingSnapshot();
    requestLightingDmxMonitorSnapshot();
    setState(State::Running, "Engine reported lighting state changed. Refreshing lighting snapshot...");
    return;
  }

  if (type == "event" && object.value("event").toString() == "audio.changed") {
    requestAudioSnapshot();
    setState(State::Running, "Engine reported audio state changed. Refreshing audio snapshot...");
    return;
  }

  if (type == "event" && object.value("event").toString() == "support.changed") {
    requestSupportSnapshot();
    setState(State::Running, "Engine reported support state changed. Refreshing support snapshot...");
    return;
  }

  if (type != "response") {
    return;
  }

  const QString id = object.value("id").toString();
  const bool ok = object.value("ok").toBool();

  if (id == "bootstrap-ping") {
    if (!ok) {
      setFailure(formatError(object.value("error").toObject()), "PING_FAILED");
      return;
    }

    const State nextState = m_startupPhase == StartupPhase::Ready && m_appSnapshotLoaded
                              ? State::Running
                              : State::Starting;
    setState(nextState, "Engine ping succeeded.");
    return;
  }

  if (id == "startup-health" || id == "poll-health") {
    if (!ok) {
      if (id == "startup-health") {
        setFailure(formatError(object.value("error").toObject()), "HEALTH_SNAPSHOT_FAILED");
      } else {
        const QString errorMessage = formatError(object.value("error").toObject());
        if (m_lastError != errorMessage) {
          m_lastError = errorMessage;
          emit diagnosticsChanged();
        }
        setState(State::Running, "Engine health refresh failed.");
      }
      return;
    }

    if (id == "startup-health") {
      stopStartupWatchdog();
    }
    const QJsonObject result = object.value("result").toObject();
    const QString status = normalizedHealthStatus(result.value("status").toString("unknown"));
    const QString startupPhase = result.value("startupPhase").toString("unknown");
    updateRuntimePaths(result.value("paths").toObject());
    const QJsonObject details = result.value("details").toObject();
    const QJsonObject checks = result.value("checks").toObject();
    const QJsonObject storage = checks.value("storage").toObject();
    const bool storageOk = storage.value("ok").toBool(false);
    m_storageSqliteVersion = storage.value("sqliteVersion").toString("unknown");
    setHealthStatus(status);
    m_healthDetails = result.value("summary").toString(
      QString("Health '%1'. Startup phase '%2'. Storage check %3.")
        .arg(status)
        .arg(startupPhase)
        .arg(storageOk ? "ok" : "not ready")
    );
    m_storageDetails = details.value("storage").toString("Storage diagnostics unavailable.");
    emit healthStatusChanged();
    const QString recentLogExcerpt = result.value("recentLogExcerpt").toString();
    if (!recentLogExcerpt.isEmpty() && m_recentLogExcerpt != recentLogExcerpt) {
      m_recentLogExcerpt = recentLogExcerpt;
      emit diagnosticsChanged();
    }
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    if (id == "startup-health") {
      setState(
        State::Starting,
        QString("Engine health synchronized. Health status: %1. Startup phase: %2. Storage check: %3. Requesting app snapshot...")
          .arg(status)
          .arg(startupPhase)
          .arg(storageOk ? "ok" : "not ready")
      );
      requestAppSnapshot("startup-app-snapshot", true);
    } else {
      setState(
        State::Running,
        QString("Engine health refreshed. Health status: %1. Startup phase: %2. Storage check: %3.")
          .arg(status)
          .arg(startupPhase)
          .arg(storageOk ? "ok" : "not ready")
      );
    }
    return;
  }

  if (id == "startup-app-snapshot" || id == "app-snapshot") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (id == "startup-app-snapshot") {
        setFailure(errorMessage, "APP_SNAPSHOT_FAILED");
        return;
      }

      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, QString("Engine app snapshot request failed: %1").arg(id));
      return;
    }

    if (id == "startup-app-snapshot") {
      stopStartupWatchdog();
    }
    const QJsonObject result = object.value("result").toObject();
    applyAppSnapshot(result);
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    if (id == "startup-app-snapshot") {
      requestCommissioningSnapshot();
      requestLightingSnapshot();
      requestLightingDmxMonitorSnapshot();
      requestAudioSnapshot();
      requestSupportSnapshot();
      requestPlanningSnapshot();
      requestPlanningTimeReport();
      requestControlSurfaceSnapshot();
      m_runtimeRefreshTimer.start();
      setStartupPhase(StartupPhase::Ready);
    }
    setState(
      State::Running,
      QString("Engine application snapshot synchronized. Startup target: %1. Commissioning stage: %2.")
        .arg(m_startupTargetSurface)
        .arg(m_commissioningStage)
    );
    return;
  }

  if (id == "parity-fixture-load") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, "Parity fixture load failed.");
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    requestAppSnapshot("app-snapshot", false);
    requestCommissioningSnapshot();
    requestLightingSnapshot();
    requestLightingDmxMonitorSnapshot();
    requestAudioSnapshot();
    requestSupportSnapshot();
    requestPlanningSnapshot();
    requestPlanningTimeReport();
    requestControlSurfaceSnapshot();
    setState(
      State::Running,
      QString("Parity fixture '%1' loaded. %2")
        .arg(result.value("fixtureId").toString("unknown"))
        .arg(result.value("summary").toString("Snapshot refresh pending."))
    );
    return;
  }

  if (id == "companion-export") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, "Engine Companion export request failed.");
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_companionExportPath = result.value("path").toString();
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    } else {
      emit diagnosticsChanged();
    }
    setState(
      State::Running,
      QString("Companion profile exported to %1").arg(
        m_companionExportPath.isEmpty() ? QString("the runtime exports directory") : m_companionExportPath
      )
    );
    return;
  }

  if (id == "commissioning-snapshot") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      resetCommissioningSnapshot(QString("Commissioning snapshot request failed: %1").arg(errorMessage));
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, "Engine commissioning snapshot request failed.");
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    const QJsonObject lighting = result.value("lighting").toObject();
    const QJsonObject audio = result.value("audio").toObject();
    m_commissioningStage = result.value("stage").toString(m_commissioningStage);
    m_hardwareProfile = result.value("hardwareProfile").toString(m_hardwareProfile);
    m_commissioningSteps = result.value("steps").toArray().toVariantList();
    m_commissioningChecks = result.value("checks").toArray().toVariantList();
    m_commissioningPlanningProjectCount = static_cast<int>(result.value("planningProjectCount").toInteger(0));
    m_commissioningPlanningTaskCount = static_cast<int>(result.value("planningTaskCount").toInteger(0));
    m_commissioningLightingBridgeIp = lighting.value("bridgeIp").toString();
    m_commissioningLightingUniverse = static_cast<int>(lighting.value("universe").toInteger(1));
    m_commissioningAudioSendHost = audio.value("sendHost").toString("127.0.0.1");
    m_commissioningAudioSendPort = static_cast<int>(audio.value("sendPort").toInteger(7001));
    m_commissioningAudioReceivePort = static_cast<int>(audio.value("receivePort").toInteger(9001));
    m_commissioningSnapshotLoaded = true;
    int passedProbeCount = 0;
    for (const QVariant &checkValue : m_commissioningChecks) {
      if (checkValue.toMap().value("status").toString() == "passed") {
        passedProbeCount += 1;
      }
    }
    m_commissioningDetails = result.value("summary").toString(
      QString("Stage '%1', %2 projects, %3 tasks, %4 probe records.")
        .arg(m_commissioningStage)
        .arg(m_commissioningPlanningProjectCount)
        .arg(m_commissioningPlanningTaskCount)
        .arg(m_commissioningChecks.size())
    );
    m_commissioningConfigDetails = result.value("configSummary").toString(
      QString("Profile '%1'. Lighting bridge '%2' on universe %3. Audio send %4:%5 and receive %6.")
        .arg(m_hardwareProfile)
        .arg(m_commissioningLightingBridgeIp.isEmpty() ? QString("unconfigured") : m_commissioningLightingBridgeIp)
        .arg(m_commissioningLightingUniverse)
        .arg(m_commissioningAudioSendHost)
        .arg(m_commissioningAudioSendPort)
        .arg(m_commissioningAudioReceivePort)
    );
    m_commissioningReadinessDetails = result.value("readinessSummary").toString(
      QString("%1 of %2 commissioning probes passed. Planning store has %3 projects and %4 tasks.")
        .arg(passedProbeCount)
        .arg(m_commissioningChecks.size())
        .arg(m_commissioningPlanningProjectCount)
        .arg(m_commissioningPlanningTaskCount)
    );
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit appSnapshotChanged();
    emit commissioningSnapshotChanged();
    setState(
      State::Running,
      QString("Commissioning snapshot synchronized: %1 steps, %2 probes.")
        .arg(m_commissioningSteps.size())
        .arg(m_commissioningChecks.size())
    );
    return;
  }

  if (id == "support-snapshot") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      resetSupportSnapshot(QString("Support snapshot request failed: %1").arg(errorMessage));
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, "Engine support snapshot request failed.");
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_supportBackupDir = result.value("backupDir").toString();
    m_supportBackupFiles = result.value("backups").toArray().toVariantList();
    m_supportBackupCount = static_cast<int>(result.value("backupCount").toInteger(0));
    m_supportLatestBackupPath = result.value("latestBackupPath").toString();
    m_supportSnapshotLoaded = true;
    m_supportDetails = result.value("summary").toString(
      QString("%1 backup archives in %2. Latest: %3.")
        .arg(m_supportBackupCount)
        .arg(m_supportBackupDir.isEmpty() ? QString("unavailable") : m_supportBackupDir)
        .arg(m_supportLatestBackupPath.isEmpty() ? QString("none") : m_supportLatestBackupPath)
    );
    m_supportRestoreDetails = result.value("restoreSummary").toString(
      QString(
        "Restore from a native support backup archive or a legacy db.json export. The engine creates a rollback backup before applying changes."
      )
    );
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit supportSnapshotChanged();
    setState(
      State::Running,
      QString("Support snapshot synchronized: %1 backup archives.").arg(m_supportBackupCount)
    );
    return;
  }

  if (id == "control-surface-snapshot") {
    if (!ok) {
      resetControlSurfaceSnapshot();
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, "Engine control-surface snapshot request failed.");
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_controlSurfacePages = result.value("pages").toArray().toVariantList();
    m_controlSurfaceSnapshotLoaded = true;
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit controlSurfaceSnapshotChanged();
    setState(
      State::Running,
      QString("Control-surface snapshot synchronized: %1 pages.").arg(m_controlSurfacePages.size())
    );
    return;
  }

  if (id == "lighting-snapshot" || id == "poll-lighting-snapshot") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      resetLightingSnapshot(QString("Lighting snapshot request failed: %1").arg(errorMessage));
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      if (id != "poll-lighting-snapshot") {
        setState(State::Running, "Engine lighting snapshot request failed.");
      }
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_lightingStatus = result.value("status").toString("unconfigured");
    m_lightingAdapterMode = result.value("adapterMode").toString("simulated");
    m_lightingEnabled = result.value("enabled").toBool(false);
    m_lightingBridgeIp = result.value("bridgeIp").toString();
    m_lightingUniverse = static_cast<int>(result.value("universe").toInteger(1));
    m_lightingGrandMaster = static_cast<int>(result.value("grandMaster").toInteger(100));
    m_lightingFixtures = result.value("fixtures").toArray().toVariantList();
    m_lightingGroups = result.value("groups").toArray().toVariantList();
    m_lightingScenes = result.value("scenes").toArray().toVariantList();
    m_lightingFixtureCount = m_lightingFixtures.size();
    m_lightingGroupCount = m_lightingGroups.size();
    m_lightingSceneCount = m_lightingScenes.size();
    m_lightingConnected = result.value("connected").toBool(false);
    m_lightingReachable = result.value("reachable").toBool(false);
    m_lightingSelectedSceneId = result.value("selectedSceneId").toString();
    m_lightingSelectedFixtureId = result.value("selectedFixtureId").toString();
    m_lightingCameraMarker = result.value("cameraMarker").toObject().toVariantMap();
    m_lightingSubjectMarker = result.value("subjectMarker").toObject().toVariantMap();
    m_lightingSnapshotLoaded = true;
    m_lightingDetails = result.value("summary").toString(
      QString("Lighting status '%1', bridge '%2', universe %3.")
        .arg(m_lightingStatus)
        .arg(m_lightingBridgeIp.isEmpty() ? QString("unconfigured") : m_lightingBridgeIp)
        .arg(m_lightingUniverse)
    );
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit lightingSnapshotChanged();
    if (id != "poll-lighting-snapshot") {
      setState(
        State::Running,
        QString("Lighting snapshot synchronized: status=%1, bridge=%2, universe=%3, fixtures=%4.")
          .arg(m_lightingStatus)
          .arg(m_lightingBridgeIp.isEmpty() ? QString("unconfigured") : m_lightingBridgeIp)
          .arg(m_lightingUniverse)
          .arg(m_lightingFixtureCount)
      );
    }
    return;
  }

  if (id == "lighting-dmx-monitor" || id == "poll-lighting-dmx-monitor") {
    if (!ok) {
      resetLightingDmxMonitor();
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      if (id != "poll-lighting-dmx-monitor") {
        setState(State::Running, "Engine lighting DMX monitor request failed.");
      }
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_lightingDmxChannels = result.value("channels").toArray().toVariantList();
    m_lightingDmxMonitorLoaded = true;
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit lightingDmxMonitorChanged();
    if (id != "poll-lighting-dmx-monitor") {
      setState(
        State::Running,
        QString("Lighting DMX monitor synchronized: %1 channels.").arg(m_lightingDmxChannels.size())
      );
    }
    return;
  }

  if (id == "audio-snapshot" || id == "poll-audio-snapshot") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      resetAudioSnapshot(QString("Audio snapshot request failed: %1").arg(errorMessage));
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      if (id != "poll-audio-snapshot") {
        setState(State::Running, "Engine audio snapshot request failed.");
      }
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_audioStatus = result.value("status").toString("not-verified");
    m_audioAdapterMode = result.value("adapterMode").toString("simulated");
    m_audioMeteringState = result.value("meteringState").toString("disabled");
    m_audioConsoleStateConfidence = result.value("consoleStateConfidence").toString("unknown");
    m_audioLastConsoleSyncAt = result.value("lastConsoleSyncAt").toString();
    m_audioLastConsoleSyncReason = result.value("lastConsoleSyncReason").toString();
    m_audioLastRecalledSnapshotId = result.value("lastRecalledSnapshotId").toString();
    m_audioLastSnapshotRecallAt = result.value("lastSnapshotRecallAt").toString();
    m_audioLastActionStatus = result.value("lastActionStatus").toString("unknown");
    m_audioLastActionCode = result.value("lastActionCode").toString();
    m_audioLastActionMessage = result.value("lastActionMessage").toString();
    m_audioOscEnabled = result.value("oscEnabled").toBool(true);
    m_audioSelectedChannelId = result.value("selectedChannelId").toString();
    m_audioSelectedMixTargetId = result.value("selectedMixTargetId").toString("audio-mix-main");
    m_audioExpectedPeakData = result.value("expectedPeakData").toBool(true);
    m_audioExpectedSubmixLock = result.value("expectedSubmixLock").toBool(true);
    m_audioExpectedCompatibilityMode = result.value("expectedCompatibilityMode").toBool(false);
    m_audioFadersPerBank = static_cast<int>(result.value("fadersPerBank").toInteger(12));
    m_audioSendHost = result.value("sendHost").toString("127.0.0.1");
    m_audioSendPort = static_cast<int>(result.value("sendPort").toInteger(7001));
    m_audioReceivePort = static_cast<int>(result.value("receivePort").toInteger(9001));
    m_audioChannels = result.value("channels").toArray().toVariantList();
    m_audioMixTargets = result.value("mixTargets").toArray().toVariantList();
    m_audioSnapshots = result.value("snapshots").toArray().toVariantList();
    m_audioChannelCount = m_audioChannels.size();
    m_audioMixTargetCount = m_audioMixTargets.size();
    m_audioSnapshotCount = m_audioSnapshots.size();
    m_audioConnected = result.value("connected").toBool(false);
    m_audioVerified = result.value("verified").toBool(false);
    m_audioSnapshotLoaded = true;
    m_audioDetails = result.value("summary").toString(
      QString("Audio status '%1', send=%2:%3, receive=%4.")
        .arg(m_audioStatus)
        .arg(m_audioSendHost)
        .arg(m_audioSendPort)
        .arg(m_audioReceivePort)
    );
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit audioSnapshotChanged();
    if (id != "poll-audio-snapshot") {
      setState(
        State::Running,
        QString("Audio snapshot synchronized: status=%1, send=%2:%3, receive=%4, channels=%5.")
          .arg(m_audioStatus)
          .arg(m_audioSendHost)
          .arg(m_audioSendPort)
          .arg(m_audioReceivePort)
          .arg(m_audioChannelCount)
      );
    }
    return;
  }

  if (id.startsWith("lighting-")) {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      requestLightingSnapshot();
      setState(State::Running, QString("Lighting request failed: %1").arg(id));
      return;
    }

    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    setState(State::Running, QString("Lighting request succeeded: %1").arg(id));
    return;
  }

  if (id.startsWith("audio-")) {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      requestAudioSnapshot();
      setState(State::Running, QString("Audio request failed: %1").arg(id));
      return;
    }

    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    setState(State::Running, QString("Audio request succeeded: %1").arg(id));
    return;
  }

  if (id == "support-backup-export" || id == "support-backup-restore") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, QString("Support request failed: %1").arg(id));
      return;
    }

    requestSupportSnapshot();
    if (id == "support-backup-restore") {
      requestAppSnapshot("app-snapshot", false);
      requestCommissioningSnapshot();
      requestLightingSnapshot();
      requestLightingDmxMonitorSnapshot();
      requestAudioSnapshot();
      requestPlanningSnapshot();
      requestPlanningTimeReport();
      requestControlSurfaceSnapshot();
    }

    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    setState(State::Running, QString("Support request succeeded: %1").arg(id));
    return;
  }

  if (id == "startup-planning-snapshot" || id == "planning-snapshot" || id == "poll-planning-snapshot") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      resetPlanningSnapshot(QString("Planning snapshot request failed: %1").arg(errorMessage));
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      if (id != "poll-planning-snapshot") {
        setState(State::Running, QString("Engine planning snapshot request failed: %1").arg(id));
      }
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    const QJsonObject counts = result.value("counts").toObject();
    const QJsonObject settings = result.value("settings").toObject();
    m_planningProjects = result.value("projects").toArray().toVariantList();
    m_planningTasks = result.value("tasks").toArray().toVariantList();
    m_planningActivityLog = result.value("activityLog").toArray().toVariantList();
    m_planningProjectCount = static_cast<int>(counts.value("projectCount").toInteger(0));
    m_planningTaskCount = static_cast<int>(counts.value("taskCount").toInteger(0));
    m_planningRunningTaskCount = static_cast<int>(counts.value("runningTaskCount").toInteger(0));
    m_planningCompletedTaskCount =
      static_cast<int>(counts.value("completedTaskCount").toInteger(0));
    m_planningViewFilter = settings.value("viewFilter").toString("all");
    m_planningSortBy = settings.value("sortBy").toString("manual");
    m_planningSelectedProjectId = settings.value("selectedProjectId").toString();
    m_planningSelectedTaskId = settings.value("selectedTaskId").toString();
    m_planningSnapshotLoaded = true;
    m_planningDetails =
      QString("%1 projects, %2 tasks, %3 running, %4 completed. View filter '%5', sort '%6', selected project '%7', selected task '%8'.")
        .arg(m_planningProjectCount)
        .arg(m_planningTaskCount)
        .arg(m_planningRunningTaskCount)
        .arg(m_planningCompletedTaskCount)
        .arg(m_planningViewFilter)
        .arg(m_planningSortBy)
        .arg(m_planningSelectedProjectId.isEmpty() ? QString("none") : m_planningSelectedProjectId)
        .arg(m_planningSelectedTaskId.isEmpty() ? QString("none") : m_planningSelectedTaskId);
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit planningSnapshotChanged();
    if (id != "poll-planning-snapshot") {
      setState(
        State::Running,
        QString("Planning snapshot synchronized: %1 projects, %2 tasks.")
          .arg(m_planningProjectCount)
          .arg(m_planningTaskCount)
      );
    }
    return;
  }

  if (id == "planning-time-report" || id == "poll-planning-time-report") {
    if (!ok) {
      resetPlanningTimeReport();
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      if (id != "poll-planning-time-report") {
        setState(State::Running, "Engine planning time report request failed.");
      }
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    m_planningTotalTrackedSeconds = static_cast<int>(result.value("totalSeconds").toInteger(0));
    m_planningTimeByProject = result.value("byProject").toArray().toVariantList();
    m_planningTimeByTask = result.value("byTask").toArray().toVariantList();
    m_planningTimerEvents = result.value("timerEvents").toArray().toVariantList();
    m_planningTimeReportLoaded = true;
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit planningTimeReportChanged();
    if (id != "poll-planning-time-report") {
      setState(
        State::Running,
        QString("Planning time report synchronized: %1 tracked seconds.")
          .arg(m_planningTotalTrackedSeconds)
      );
    }
    return;
  }

  if (id.startsWith("planning-")) {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, QString("Planning request failed: %1").arg(id));
      return;
    }

    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    setState(State::Running, QString("Planning request succeeded: %1").arg(id));
    return;
  }

  if (id.startsWith("commissioning-")) {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      if (m_lastError != errorMessage) {
        m_lastError = errorMessage;
        emit diagnosticsChanged();
      }
      setState(State::Running, QString("Commissioning request failed: %1").arg(id));
      return;
    }

    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    setState(State::Running, QString("Commissioning request succeeded: %1").arg(id));
    return;
  }

  if (id == "settings-get") {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      m_settingsDetails = QString("Settings request failed: %1").arg(errorMessage);
      m_lastError = errorMessage;
      emit diagnosticsChanged();
      emit settingsChanged();
      setState(State::Running, QString("Engine settings request failed: %1").arg(id));
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    const QJsonObject shell = result.value("shell").toObject();
    const QString workspace = shell.value("workspace").toString("planning");
    const QJsonObject window = shell.value("window").toObject();
    const int width = static_cast<int>(window.value("width").toInteger(1280));
    const int height = static_cast<int>(window.value("height").toInteger(800));
    const QString windowMode = window.value("mode").toString(
      window.value("maximized").toBool(false) ? "maximized" : "fullscreen"
    );
    m_workspaceMode = workspace;
    m_windowWidth = width;
    m_windowHeight = height;
    m_windowMode = windowMode;
    m_windowMaximized = windowMode == "maximized";
    m_windowSettingsLoaded = true;
    m_settingsDetails = QString("Workspace '%1', window %2x%3 (%4).")
                          .arg(workspace)
                          .arg(width)
                          .arg(height)
                          .arg(windowMode);
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    emit settingsChanged();
    setState(
      State::Running,
      QString("Engine settings synchronized: workspace=%1, window=%2x%3, mode=%4")
        .arg(workspace)
        .arg(width)
        .arg(height)
        .arg(windowMode)
    );
    return;
  }

  if (id.startsWith("settings-update")) {
    if (!ok) {
      const QString errorMessage = formatError(object.value("error").toObject());
      m_settingsDetails = QString("Settings request failed: %1").arg(errorMessage);
      m_lastError = errorMessage;
      emit diagnosticsChanged();
      emit settingsChanged();
      setState(State::Running, QString("Engine settings request failed: %1").arg(id));
      return;
    }

    const QJsonObject result = object.value("result").toObject();
    applyAppSnapshot(result);
    if (!m_lastError.isEmpty()) {
      m_lastError.clear();
      emit diagnosticsChanged();
    }
    setState(
      State::Running,
      QString("Engine shell state synchronized from app snapshot: workspace=%1, window=%2x%3, mode=%4")
        .arg(m_workspaceMode)
        .arg(m_windowWidth)
        .arg(m_windowHeight)
        .arg(m_windowMode)
    );
    return;
  }

  setState(State::Running, QString("Engine response: %1").arg(id));
}
