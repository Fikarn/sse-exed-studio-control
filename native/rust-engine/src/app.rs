use crate::app_state::{build_app_snapshot, parse_commissioning_update, APP_SETTINGS_PREFIX};
use crate::audio::{
    build_audio_health_check, create_audio_snapshot, delete_audio_snapshot,
    parse_audio_channel_update_request, parse_audio_mix_target_update_request,
    parse_audio_settings_update_request, parse_audio_snapshot_create_request,
    parse_audio_snapshot_delete_request, parse_audio_snapshot_recall_request,
    parse_audio_snapshot_update_request, read_audio_snapshot, recall_audio_snapshot,
    sync_audio_console, update_audio_channel, update_audio_mix_target, update_audio_settings,
    update_audio_snapshot, AudioCommandError,
};
use crate::bootstrap::{bootstrap_runtime, RuntimeContext};
use crate::commissioning::{
    parse_commissioning_check_request, parse_commissioning_seed_request,
    read_commissioning_snapshot, run_commissioning_check, seed_sample_planning_data,
    CommissioningCommandError,
};
use crate::control_surface::build_control_surface_health_check;
use crate::diagnostics::{append_log, read_log_excerpt};
use crate::exports::{build_control_surface_snapshot, export_companion_config, ExportCommandError};
use crate::legacy_import::{parse_import_request, ImportLegacyError};
use crate::lighting::{
    build_lighting_health_check, create_lighting_cue, create_lighting_fixture,
    create_lighting_group, create_lighting_scene, delete_lighting_cue, delete_lighting_fixture,
    delete_lighting_group, delete_lighting_scene, fire_lighting_cue,
    parse_lighting_all_power_request, parse_lighting_cue_create_request,
    parse_lighting_cue_delete_request, parse_lighting_cue_fire_request,
    parse_lighting_cue_update_request, parse_lighting_fixture_create_request,
    parse_lighting_fixture_delete_request, parse_lighting_fixture_update_request,
    parse_lighting_group_create_request, parse_lighting_group_delete_request,
    parse_lighting_group_power_request, parse_lighting_group_update_request,
    parse_lighting_scene_create_request, parse_lighting_scene_delete_request,
    parse_lighting_scene_recall_request, parse_lighting_scene_update_request,
    parse_lighting_settings_update_request, read_lighting_dmx_monitor_snapshot,
    read_lighting_snapshot, recall_lighting_scene, set_lighting_all_power,
    set_lighting_group_power, update_lighting_cue, update_lighting_fixture, update_lighting_group,
    update_lighting_scene, update_lighting_settings, LightingCommandError,
};
use crate::parity_fixtures::{
    load_parity_fixture, parse_parity_fixture_request, ParityFixtureError,
};
use crate::planning::{
    apply_planning_project_create, apply_planning_project_delete, apply_planning_project_reorder,
    apply_planning_project_update, apply_planning_selection, apply_planning_task_checklist_add,
    apply_planning_task_checklist_delete, apply_planning_task_checklist_update,
    apply_planning_task_create, apply_planning_task_delete, apply_planning_task_reschedule,
    apply_planning_task_timer, apply_planning_task_toggle_complete, apply_planning_task_update,
    parse_planning_project_create_request, parse_planning_project_delete_request,
    parse_planning_project_reorder_request, parse_planning_project_update_request,
    parse_planning_selection_request, parse_planning_settings_update,
    parse_planning_task_checklist_add_request, parse_planning_task_checklist_delete_request,
    parse_planning_task_checklist_update_request, parse_planning_task_create_request,
    parse_planning_task_delete_request, parse_planning_task_reschedule_request,
    parse_planning_task_timer_request, parse_planning_task_toggle_complete_request,
    parse_planning_task_update_request, parse_planning_time_report_request, read_planning_context,
    read_planning_snapshot, read_planning_time_report, update_planning_settings,
    PlanningCommandError,
};
use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::protocol::{
    error_response, event_message, invalid_params, ok_response, RequestEnvelope, ResponseEnvelope,
    EVENT_APP_CHANGED, EVENT_AUDIO_CHANGED, EVENT_COMMISSIONING_CHANGED, EVENT_ENGINE_READY,
    EVENT_LIGHTING_CHANGED, EVENT_PLANNING_CHANGED, EVENT_SETTINGS_CHANGED, EVENT_SUPPORT_CHANGED,
};
use crate::shell_settings::{parse_settings_update, ShellSettingsSnapshot, SHELL_SETTINGS_PREFIX};
use crate::storage::{
    import_legacy_db, list_settings_by_prefix, read_sqlite_version, set_settings, EngineResult,
};
use crate::support::{
    export_support_backup, parse_support_restore_request, read_support_snapshot,
    restore_support_backup, SupportCommandError,
};
use serde_json::json;

pub struct EngineApp {
    runtime: RuntimeContext,
}

pub struct EngineReply {
    pub response: ResponseEnvelope,
    pub events: Vec<serde_json::Value>,
}

fn format_health_summary(
    status: &str,
    storage_summary: &str,
    lighting_summary: &str,
    audio_summary: &str,
    control_surface_summary: &str,
) -> String {
    format!(
        "Health '{}'. Storage {}. Lighting {}. Audio {}. Control surface {}.",
        status, storage_summary, lighting_summary, audio_summary, control_surface_summary
    )
}

impl EngineApp {
    pub fn bootstrap() -> EngineResult<Self> {
        let runtime = bootstrap_runtime()?;
        append_log(&runtime.log_file_path, "INFO", "Engine bootstrap completed")?;
        Ok(Self { runtime })
    }

    pub fn ready_event(&self) -> serde_json::Value {
        event_message(
            EVENT_ENGINE_READY,
            json!({
                "protocol": self.runtime.protocol_version,
                "engineVersion": env!("CARGO_PKG_VERSION"),
                "appDataDir": self.runtime.app_data_dir.display().to_string(),
                "logsDir": self.runtime.logs_dir.display().to_string(),
                "logFilePath": self.runtime.log_file_path.display().to_string(),
                "updateRepositoryPath": self.runtime
                    .update_repository_path
                    .as_ref()
                    .map(|path| path.display().to_string())
            }),
        )
    }

    pub fn handle_request(&self, request: RequestEnvelope) -> EngineReply {
        let _ = append_log(
            &self.runtime.log_file_path,
            "INFO",
            &format!("Handling request: {}", request.method),
        );

        match request.method.as_str() {
            "engine.ping" => Self::reply(ok_response(
                request.id,
                json!({
                    "protocol": self.runtime.protocol_version,
                    "engineVersion": env!("CARGO_PKG_VERSION"),
                    "echoParams": request.params,
                }),
            )),

            // -------------------------------------------------------------
            // Read snapshots (R-noargs)
            // -------------------------------------------------------------
            "health.snapshot" => self.dispatch_read(request.id, Self::read_health_snapshot),
            "app.snapshot" => self.dispatch_read(request.id, Self::read_app_snapshot),
            "commissioning.snapshot" => {
                self.dispatch_read(request.id, Self::read_commissioning_snapshot)
            }
            "lighting.snapshot" => self.dispatch_read(request.id, Self::read_lighting_snapshot),
            "lighting.dmxMonitor.snapshot" => {
                self.dispatch_read(request.id, Self::read_lighting_dmx_monitor_snapshot)
            }
            "audio.snapshot" => self.dispatch_read(request.id, Self::read_audio_snapshot),
            "support.snapshot" => self.dispatch_read(request.id, Self::read_support_snapshot),
            "controlSurface.snapshot" => {
                self.dispatch_read(request.id, Self::read_control_surface_snapshot)
            }
            "settings.get" => self.dispatch_read(request.id, Self::read_shell_settings),
            "planning.snapshot" => self.dispatch_read(request.id, Self::read_planning_snapshot),
            "planning.context" => self.dispatch_read(request.id, Self::read_planning_context),

            // -------------------------------------------------------------
            // Read with parsed params (R-args)
            // -------------------------------------------------------------
            "planning.report.time" => self.dispatch_read_with_params(
                request,
                parse_planning_time_report_request,
                |s, project_id| s.read_planning_time_report(project_id.as_deref()),
            ),

            // -------------------------------------------------------------
            // Lighting mutations (M-1event)
            // -------------------------------------------------------------
            "lighting.scene.recall" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_recall_request,
                recall_lighting_scene,
                "scene-recalled",
            ),
            "lighting.scene.create" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_create_request,
                create_lighting_scene,
                "scene-created",
            ),
            "lighting.scene.update" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_update_request,
                update_lighting_scene,
                "scene-updated",
            ),
            "lighting.scene.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_delete_request,
                delete_lighting_scene,
                "scene-deleted",
            ),
            "lighting.group.create" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_group_create_request,
                create_lighting_group,
                "group-created",
            ),
            "lighting.group.update" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_group_update_request,
                update_lighting_group,
                "group-updated",
            ),
            "lighting.group.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_group_delete_request,
                delete_lighting_group,
                "group-deleted",
            ),
            "lighting.settings.update" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_settings_update_request,
                update_lighting_settings,
                "settings-updated",
            ),
            "lighting.fixture.create" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_create_request,
                create_lighting_fixture,
                "fixture-created",
            ),
            "lighting.fixture.update" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_update_request,
                update_lighting_fixture,
                "fixture-updated",
            ),
            "lighting.fixture.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_delete_request,
                delete_lighting_fixture,
                "fixture-deleted",
            ),
            "lighting.group.power" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_group_power_request,
                set_lighting_group_power,
                "group-powered",
            ),
            "lighting.power.all" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_all_power_request,
                set_lighting_all_power,
                "all-powered",
            ),
            "lighting.cue.create" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_cue_create_request,
                create_lighting_cue,
                "cue-created",
            ),
            "lighting.cue.update" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_cue_update_request,
                update_lighting_cue,
                "cue-updated",
            ),
            "lighting.cue.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_cue_delete_request,
                delete_lighting_cue,
                "cue-deleted",
            ),
            "lighting.cue.fire" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_cue_fire_request,
                fire_lighting_cue,
                "cue-fired",
            ),

            // -------------------------------------------------------------
            // Audio mutations (M-1event)
            // -------------------------------------------------------------
            "audio.sync" => self.run_audio_mutate(request.id, sync_audio_console, "console-synced"),
            "audio.snapshot.recall" => self.dispatch_audio_mutate(
                request,
                parse_audio_snapshot_recall_request,
                recall_audio_snapshot,
                "snapshot-recalled",
            ),
            "audio.snapshot.create" => self.dispatch_audio_mutate(
                request,
                parse_audio_snapshot_create_request,
                create_audio_snapshot,
                "snapshot-created",
            ),
            "audio.snapshot.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_snapshot_update_request,
                update_audio_snapshot,
                "snapshot-updated",
            ),
            "audio.snapshot.delete" => self.dispatch_audio_mutate(
                request,
                parse_audio_snapshot_delete_request,
                delete_audio_snapshot,
                "snapshot-deleted",
            ),
            "audio.channel.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_channel_update_request,
                update_audio_channel,
                "channel-updated",
            ),
            "audio.mixTarget.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_mix_target_update_request,
                update_audio_mix_target,
                "mix-target-updated",
            ),
            "audio.settings.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_settings_update_request,
                update_audio_settings,
                "settings-updated",
            ),

            // -------------------------------------------------------------
            // Planning mutations (M-1event with derived event payload)
            // -------------------------------------------------------------
            "planning.settings.update" => self.dispatch_planning_mutate(
                request,
                parse_planning_settings_update,
                update_planning_settings,
                "settings-updated",
                |result| {
                    (
                        result.settings.selected_project_id.as_deref(),
                        result.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.select" => self.dispatch_planning_mutate(
                request,
                parse_planning_selection_request,
                apply_planning_selection,
                "selection-updated",
                |result| {
                    (
                        result.settings.selected_project_id.as_deref(),
                        result.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.project.create" => self.dispatch_planning_mutate(
                request,
                parse_planning_project_create_request,
                apply_planning_project_create,
                "project-created",
                |result| {
                    (
                        Some(result.project.id.as_str()),
                        result.context.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.project.update" => self.dispatch_planning_mutate(
                request,
                parse_planning_project_update_request,
                apply_planning_project_update,
                "project-updated",
                |result| {
                    (
                        Some(result.project.id.as_str()),
                        result.context.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.project.delete" => self.dispatch_planning_mutate(
                request,
                parse_planning_project_delete_request,
                apply_planning_project_delete,
                "project-deleted",
                |result| {
                    (
                        result.context.settings.selected_project_id.as_deref(),
                        result.context.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.project.reorder" => self.dispatch_planning_mutate(
                request,
                parse_planning_project_reorder_request,
                apply_planning_project_reorder,
                "project-reordered",
                |result| {
                    (
                        Some(result.project.id.as_str()),
                        result.context.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.task.create" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_create_request,
                apply_planning_task_create,
                "task-created",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),
            "planning.task.update" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_update_request,
                apply_planning_task_update,
                "task-updated",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),
            "planning.task.reschedule" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_reschedule_request,
                apply_planning_task_reschedule,
                "task-rescheduled",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),
            "planning.task.delete" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_delete_request,
                apply_planning_task_delete,
                "task-deleted",
                |result| {
                    (
                        result.context.settings.selected_project_id.as_deref(),
                        result.context.settings.selected_task_id.as_deref(),
                    )
                },
            ),
            "planning.task.checklist.add" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_checklist_add_request,
                apply_planning_task_checklist_add,
                "task-checklist-added",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),
            "planning.task.checklist.update" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_checklist_update_request,
                apply_planning_task_checklist_update,
                "task-checklist-updated",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),
            "planning.task.checklist.delete" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_checklist_delete_request,
                apply_planning_task_checklist_delete,
                "task-checklist-deleted",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),
            "planning.task.timer" => self.dispatch_planning_mutate_dynamic_reason(
                request,
                parse_planning_task_timer_request,
                apply_planning_task_timer,
                |result| format!("task-timer-{}", result.resolved_action),
                |result| Some(result.task.project_id.as_str()),
                |result| Some(result.task.id.as_str()),
            ),
            "planning.task.toggleComplete" => self.dispatch_planning_mutate(
                request,
                parse_planning_task_toggle_complete_request,
                apply_planning_task_toggle_complete,
                "task-completion-toggled",
                |result| {
                    (
                        Some(result.task.project_id.as_str()),
                        Some(result.task.id.as_str()),
                    )
                },
            ),

            // -------------------------------------------------------------
            // Commissioning mutations (M-1event + multi-event variants)
            // -------------------------------------------------------------
            "commissioning.check.run" => self.dispatch_commissioning_mutate(
                request,
                parse_commissioning_check_request,
                run_commissioning_check,
                "check-updated",
            ),
            "commissioning.seedPlanningDemo" => self.dispatch_commissioning_seed(
                request,
                parse_commissioning_seed_request,
                seed_sample_planning_data,
                "sample-planning-seeded",
            ),

            // -------------------------------------------------------------
            // Dev parity fixture (M-multievent)
            // -------------------------------------------------------------
            "dev.parityFixture.load" => self.dispatch_parity_fixture(
                request,
                parse_parity_fixture_request,
                load_parity_fixture,
                "parity-fixture-loaded",
            ),

            // -------------------------------------------------------------
            // Custom arms — kept hand-written because they have non-uniform
            // error enums (storage.importLegacyDb), chained snapshot reads
            // (commissioning.update, settings.update), or unique reply
            // shapes (exports.companion.export).
            // -------------------------------------------------------------
            "support.backup.export" => match export_support_backup(&self.runtime) {
                Ok(result) => Self::reply_with_support_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    "backup-exported",
                ),
                Err(error) => match error {
                    SupportCommandError::InvalidParams(message) => {
                        Self::reply(invalid_params(request.id, message))
                    }
                    SupportCommandError::Storage(message) => {
                        Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                    }
                },
            },
            "support.backup.restore" => match parse_support_restore_request(&request.params) {
                Ok(restore_request) => {
                    match restore_support_backup(&self.runtime, &restore_request) {
                        Ok(result) => Self::reply_with_support_restore_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "backup-restored",
                        ),
                        Err(error) => match error {
                            SupportCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            SupportCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "exports.companion.export" => {
                let base_url_override = request
                    .params
                    .get("baseUrl")
                    .and_then(|value| value.as_str());
                match export_companion_config(&self.runtime, base_url_override) {
                    Ok(result) => Self::reply(ok_response(
                        request.id,
                        serde_json::to_value(result).unwrap_or_else(|_| json!({})),
                    )),
                    Err(error) => match error {
                        ExportCommandError::InvalidParams(message) => {
                            Self::reply(invalid_params(request.id, message))
                        }
                        ExportCommandError::Storage(message) => {
                            Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                        }
                    },
                }
            }
            "commissioning.update" => match parse_commissioning_update(&request.params) {
                Ok(updates) => match set_settings(&self.runtime.db_path, &updates) {
                    Ok(()) => match self.read_app_snapshot() {
                        Ok(result) => Self::reply_with_app_and_commissioning_change(
                            ok_response(request.id, result),
                            "commissioning-updated",
                        ),
                        Err(error) => Self::reply(error_response(
                            request.id,
                            "STORAGE_ERROR",
                            error.to_string(),
                        )),
                    },
                    Err(error) => Self::reply(error_response(
                        request.id,
                        "STORAGE_ERROR",
                        error.to_string(),
                    )),
                },
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "settings.update" => match parse_settings_update(&request.params) {
                Ok(updates) => match set_settings(&self.runtime.db_path, &updates) {
                    Ok(()) => {
                        let _ = append_log(
                            &self.runtime.log_file_path,
                            "INFO",
                            &format!(
                                "Updated shell settings: {}",
                                Self::format_settings_updates(&updates)
                            ),
                        );

                        match self.read_app_snapshot() {
                            Ok(result) => Self::reply(ok_response(request.id, result)),
                            Err(error) => Self::reply(error_response(
                                request.id,
                                "STORAGE_ERROR",
                                error.to_string(),
                            )),
                        }
                    }
                    Err(error) => Self::reply(error_response(
                        request.id,
                        "STORAGE_ERROR",
                        error.to_string(),
                    )),
                },
                Err(message) => {
                    let _ = append_log(
                        &self.runtime.log_file_path,
                        "WARN",
                        &format!("Rejected invalid settings update: {}", message),
                    );
                    Self::reply(invalid_params(request.id, message))
                }
            },
            "storage.importLegacyDb" => match parse_import_request(&request.params) {
                Ok(import_request) => {
                    match import_legacy_db(&self.runtime.db_path, &import_request) {
                        Ok(summary) => {
                            let _ = append_log(
                                &self.runtime.log_file_path,
                                "INFO",
                                &format!(
                                    "Imported legacy planning data from {}: {} projects, {} tasks",
                                    summary.source_path,
                                    summary.imported_projects,
                                    summary.imported_tasks
                                ),
                            );
                            Self::reply(ok_response(
                                request.id,
                                serde_json::to_value(summary).unwrap_or_else(|_| json!({})),
                            ))
                        }
                        Err(error) => {
                            let code = match error {
                                ImportLegacyError::ExistingDataRequiresForce => {
                                    "IMPORT_REQUIRES_FORCE"
                                }
                                ImportLegacyError::SourceNotFound(_) => "IMPORT_SOURCE_NOT_FOUND",
                                ImportLegacyError::SourceReadFailed(_)
                                | ImportLegacyError::SourceParseFailed(_)
                                | ImportLegacyError::InvalidData(_) => "IMPORT_FAILED",
                                ImportLegacyError::Storage(_) => "STORAGE_ERROR",
                            };
                            let _ = append_log(
                                &self.runtime.log_file_path,
                                "WARN",
                                &format!("Legacy import failed: {}", error),
                            );
                            Self::reply(error_response(request.id, code, error.to_string()))
                        }
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            _ => Self::reply(error_response(
                request.id,
                "UNKNOWN_METHOD",
                format!("Unsupported method: {}", request.method),
            )),
        }
    }

    fn read_shell_settings(&self) -> EngineResult<serde_json::Value> {
        let settings = list_settings_by_prefix(&self.runtime.db_path, SHELL_SETTINGS_PREFIX)?;
        let snapshot = ShellSettingsSnapshot::from_settings(&settings);
        Ok(snapshot.to_response_payload(&settings))
    }

    fn read_app_snapshot(&self) -> EngineResult<serde_json::Value> {
        let shell_settings = list_settings_by_prefix(&self.runtime.db_path, SHELL_SETTINGS_PREFIX)?;
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        let planning_settings =
            list_settings_by_prefix(&self.runtime.db_path, PLANNING_SETTINGS_PREFIX)?;
        Ok(build_app_snapshot(
            &self.runtime,
            &shell_settings,
            &app_settings,
            &planning_settings,
        ))
    }

    fn read_planning_snapshot(&self) -> EngineResult<serde_json::Value> {
        let planning_settings =
            list_settings_by_prefix(&self.runtime.db_path, PLANNING_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_planning_snapshot(
            &self.runtime.db_path,
            &planning_settings,
        )?)?)
    }

    fn read_planning_context(&self) -> EngineResult<serde_json::Value> {
        let planning_settings =
            list_settings_by_prefix(&self.runtime.db_path, PLANNING_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_planning_context(
            &self.runtime.db_path,
            &planning_settings,
        )?)?)
    }

    fn read_planning_time_report(
        &self,
        project_id: Option<&str>,
    ) -> EngineResult<serde_json::Value> {
        Ok(serde_json::to_value(read_planning_time_report(
            &self.runtime.db_path,
            project_id,
        )?)?)
    }

    fn read_commissioning_snapshot(&self) -> EngineResult<serde_json::Value> {
        Ok(serde_json::to_value(read_commissioning_snapshot(
            &self.runtime.db_path,
        )?)?)
    }

    fn read_lighting_snapshot(&self) -> EngineResult<serde_json::Value> {
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_lighting_snapshot(&app_settings))?)
    }

    fn read_lighting_dmx_monitor_snapshot(&self) -> EngineResult<serde_json::Value> {
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_lighting_dmx_monitor_snapshot(
            &app_settings,
        ))?)
    }

    fn read_audio_snapshot(&self) -> EngineResult<serde_json::Value> {
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_audio_snapshot(&app_settings))?)
    }

    fn read_support_snapshot(&self) -> EngineResult<serde_json::Value> {
        let snapshot = read_support_snapshot(&self.runtime)?;
        Ok(serde_json::to_value(snapshot)?)
    }

    fn read_control_surface_snapshot(&self) -> EngineResult<serde_json::Value> {
        Ok(serde_json::to_value(build_control_surface_snapshot())?)
    }

    fn read_health_snapshot(&self) -> EngineResult<serde_json::Value> {
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        let lighting = build_lighting_health_check(&app_settings);
        let audio = build_audio_health_check(&app_settings);
        let control_surface = build_control_surface_health_check(&self.runtime);
        let sqlite_version = read_sqlite_version(&self.runtime.db_path)?;
        let status = if self.runtime.storage_ready {
            "ok"
        } else {
            "starting"
        };
        let lighting_summary = lighting.summary.clone();
        let audio_summary = audio.summary.clone();
        let control_surface_summary = control_surface
            .get("summary")
            .and_then(|value| value.as_str())
            .unwrap_or("Control-surface diagnostics unavailable.")
            .to_string();
        let storage_summary = format!(
            "Schema v{}, journal mode {}, integrity {}, SQLite {}",
            self.runtime.storage_bootstrap.schema_version,
            self.runtime.storage_bootstrap.journal_mode,
            self.runtime.storage_bootstrap.integrity_check,
            sqlite_version,
        );
        let health_summary = format_health_summary(
            status,
            &storage_summary,
            &lighting_summary,
            &audio_summary,
            &control_surface_summary,
        );
        Ok(json!({
            "status": status,
            "startupPhase": "storage-bootstrap",
            "summary": health_summary,
            "paths": {
                "appDataDir": self.runtime.app_data_dir.display().to_string(),
                "logsDir": self.runtime.logs_dir.display().to_string(),
                "logFilePath": self.runtime.log_file_path.display().to_string(),
                "dbPath": self.runtime.db_path.display().to_string(),
                "backupDir": self.runtime.backups_dir.display().to_string(),
                "updateRepositoryPath": self.runtime
                    .update_repository_path
                    .as_ref()
                    .map(|path| path.display().to_string())
            },
            "details": {
                "storage": storage_summary,
                "lighting": lighting_summary,
                "audio": audio_summary,
                "controlSurface": control_surface_summary,
            },
            "recentLogExcerpt": read_log_excerpt(&self.runtime.log_file_path, 12),
            "checks": {
                "storage": {
                    "ok": self.runtime.storage_ready,
                    "dbPathExists": self.runtime.db_path.exists(),
                    "schemaVersion": self.runtime.storage_bootstrap.schema_version,
                    "journalMode": self.runtime.storage_bootstrap.journal_mode,
                    "integrityCheck": self.runtime.storage_bootstrap.integrity_check,
                    "sqliteVersion": sqlite_version
                },
                "lighting": lighting,
                "audio": audio,
                "controlSurface": control_surface,
            }
        }))
    }

    fn format_settings_updates(updates: &[(&str, String)]) -> String {
        updates
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(", ")
    }

    // -----------------------------------------------------------------------
    // Dispatch helpers
    //
    // The match arms in `handle_request` previously expanded the same parse →
    // call → reply scaffolding for every method. The helpers below capture
    // the four uniform shapes (read-no-params, read-with-params, mutate with
    // single event, mutate with derived planning event payload) so the match
    // body collapses to one-liners. Custom arms with non-uniform error enums
    // or chained read-snapshot calls (`commissioning.update`, `settings.update`,
    // `support.backup.*`, `exports.companion.export`, `storage.importLegacyDb`)
    // stay as hand-written branches.
    // -----------------------------------------------------------------------

    fn dispatch_read<T, F>(&self, request_id: serde_json::Value, read: F) -> EngineReply
    where
        T: serde::Serialize,
        F: FnOnce(&Self) -> EngineResult<T>,
    {
        match read(self) {
            Ok(result) => Self::reply(ok_response(
                request_id,
                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
            )),
            Err(error) => Self::reply(error_response(
                request_id,
                "STORAGE_ERROR",
                error.to_string(),
            )),
        }
    }

    fn dispatch_read_with_params<P, T, F, R>(
        &self,
        request: RequestEnvelope,
        parse: F,
        read: R,
    ) -> EngineReply
    where
        T: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        R: FnOnce(&Self, &P) -> EngineResult<T>,
    {
        match parse(&request.params) {
            Ok(parsed) => match read(self, &parsed) {
                Ok(result) => Self::reply(ok_response(
                    request.id,
                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                )),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn dispatch_lighting_mutate<P, R, F, H>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: &str,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&std::path::Path, &P) -> Result<R, LightingCommandError>,
    {
        match parse(&request.params) {
            Ok(parsed) => match handler(&self.runtime.db_path, &parsed) {
                Ok(result) => Self::reply_with_lighting_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    reason,
                ),
                Err(LightingCommandError::Rejected(code, message)) => {
                    Self::reply(error_response(request.id, code, message))
                }
                Err(LightingCommandError::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn dispatch_audio_mutate<P, R, F, H>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: &str,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&std::path::Path, &P) -> Result<R, AudioCommandError>,
    {
        match parse(&request.params) {
            Ok(parsed) => self.run_audio_mutate(request.id, |db| handler(db, &parsed), reason),
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn run_audio_mutate<R, H>(
        &self,
        request_id: serde_json::Value,
        handler: H,
        reason: &str,
    ) -> EngineReply
    where
        R: serde::Serialize,
        H: FnOnce(&std::path::Path) -> Result<R, AudioCommandError>,
    {
        match handler(&self.runtime.db_path) {
            Ok(result) => Self::reply_with_audio_change(
                ok_response(
                    request_id,
                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                ),
                reason,
            ),
            Err(AudioCommandError::Rejected(code, message)) => {
                Self::reply(error_response(request_id, code, message))
            }
            Err(AudioCommandError::Storage(message)) => {
                Self::reply(error_response(request_id, "STORAGE_ERROR", message))
            }
        }
    }

    fn dispatch_planning_mutate<P, R, F, H, K>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: &str,
        keys: K,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&std::path::Path, &P) -> Result<R, PlanningCommandError>,
        K: for<'a> FnOnce(&'a R) -> (Option<&'a str>, Option<&'a str>),
    {
        match parse(&request.params) {
            Ok(parsed) => match handler(&self.runtime.db_path, &parsed) {
                Ok(result) => {
                    let (project_id, task_id) = keys(&result);
                    Self::reply_with_planning_change(
                        ok_response(
                            request.id,
                            serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                        ),
                        reason,
                        project_id,
                        task_id,
                    )
                }
                Err(PlanningCommandError::InvalidParams(message)) => {
                    Self::reply(invalid_params(request.id, message))
                }
                Err(PlanningCommandError::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn dispatch_planning_mutate_dynamic_reason<P, R, F, H, RFn>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: RFn,
        project_id: impl for<'a> FnOnce(&'a R) -> Option<&'a str>,
        task_id: impl for<'a> FnOnce(&'a R) -> Option<&'a str>,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&std::path::Path, &P) -> Result<R, PlanningCommandError>,
        RFn: FnOnce(&R) -> String,
    {
        match parse(&request.params) {
            Ok(parsed) => match handler(&self.runtime.db_path, &parsed) {
                Ok(result) => {
                    let event_reason = reason(&result);
                    let pid = project_id(&result);
                    let tid = task_id(&result);
                    Self::reply_with_planning_change(
                        ok_response(
                            request.id,
                            serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                        ),
                        &event_reason,
                        pid,
                        tid,
                    )
                }
                Err(PlanningCommandError::InvalidParams(message)) => {
                    Self::reply(invalid_params(request.id, message))
                }
                Err(PlanningCommandError::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn dispatch_commissioning_mutate<P, R, F, H>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: &str,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&std::path::Path, &P) -> Result<R, CommissioningCommandError>,
    {
        match parse(&request.params) {
            Ok(parsed) => match handler(&self.runtime.db_path, &parsed) {
                Ok(result) => Self::reply_with_commissioning_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    reason,
                ),
                Err(CommissioningCommandError::InvalidParams(message)) => {
                    Self::reply(invalid_params(request.id, message))
                }
                Err(CommissioningCommandError::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn dispatch_commissioning_seed<P, R, F, H>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: &str,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&RuntimeContext, &P) -> Result<R, CommissioningCommandError>,
    {
        match parse(&request.params) {
            Ok(parsed) => match handler(&self.runtime, &parsed) {
                Ok(result) => Self::reply_with_commissioning_and_planning_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    reason,
                ),
                Err(CommissioningCommandError::InvalidParams(message)) => {
                    Self::reply(invalid_params(request.id, message))
                }
                Err(CommissioningCommandError::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn dispatch_parity_fixture<P, R, F, H>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: &str,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(&RuntimeContext, &P) -> Result<R, ParityFixtureError>,
    {
        match parse(&request.params) {
            Ok(parsed) => match handler(&self.runtime, &parsed) {
                Ok(result) => Self::reply_with_app_commissioning_and_planning_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    reason,
                ),
                Err(ParityFixtureError::InvalidParams(message)) => {
                    Self::reply(invalid_params(request.id, message))
                }
                Err(ParityFixtureError::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
            },
            Err(message) => Self::reply(invalid_params(request.id, message)),
        }
    }

    fn reply(response: ResponseEnvelope) -> EngineReply {
        EngineReply {
            response,
            events: Vec::new(),
        }
    }

    fn reply_with_planning_change(
        response: ResponseEnvelope,
        reason: &str,
        project_id: Option<&str>,
        task_id: Option<&str>,
    ) -> EngineReply {
        EngineReply {
            response,
            events: vec![event_message(
                EVENT_PLANNING_CHANGED,
                json!({
                    "reason": reason,
                    "projectId": project_id,
                    "taskId": task_id
                }),
            )],
        }
    }

    fn reply_with_commissioning_change(response: ResponseEnvelope, reason: &str) -> EngineReply {
        EngineReply {
            response,
            events: vec![event_message(
                EVENT_COMMISSIONING_CHANGED,
                json!({
                    "reason": reason,
                }),
            )],
        }
    }

    fn reply_with_app_and_commissioning_change(
        response: ResponseEnvelope,
        reason: &str,
    ) -> EngineReply {
        EngineReply {
            response,
            events: vec![
                event_message(
                    EVENT_APP_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_COMMISSIONING_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
            ],
        }
    }

    fn reply_with_commissioning_and_planning_change(
        response: ResponseEnvelope,
        reason: &str,
    ) -> EngineReply {
        EngineReply {
            response,
            events: vec![
                event_message(
                    EVENT_COMMISSIONING_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_PLANNING_CHANGED,
                    json!({
                        "reason": reason,
                        "projectId": serde_json::Value::Null,
                        "taskId": serde_json::Value::Null,
                    }),
                ),
            ],
        }
    }

    fn reply_with_app_commissioning_and_planning_change(
        response: ResponseEnvelope,
        reason: &str,
    ) -> EngineReply {
        EngineReply {
            response,
            events: vec![
                event_message(
                    EVENT_APP_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_COMMISSIONING_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_PLANNING_CHANGED,
                    json!({
                        "reason": reason,
                        "projectId": serde_json::Value::Null,
                        "taskId": serde_json::Value::Null,
                    }),
                ),
            ],
        }
    }

    fn reply_with_support_change(response: ResponseEnvelope, reason: &str) -> EngineReply {
        EngineReply {
            response,
            events: vec![event_message(
                EVENT_SUPPORT_CHANGED,
                json!({
                    "reason": reason,
                }),
            )],
        }
    }

    fn reply_with_support_restore_change(response: ResponseEnvelope, reason: &str) -> EngineReply {
        EngineReply {
            response,
            events: vec![
                event_message(
                    EVENT_SUPPORT_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_SETTINGS_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_APP_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_COMMISSIONING_CHANGED,
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    EVENT_PLANNING_CHANGED,
                    json!({
                        "reason": reason,
                        "projectId": serde_json::Value::Null,
                        "taskId": serde_json::Value::Null,
                    }),
                ),
            ],
        }
    }

    fn reply_with_audio_change(response: ResponseEnvelope, reason: &str) -> EngineReply {
        EngineReply {
            response,
            events: vec![event_message(
                EVENT_AUDIO_CHANGED,
                json!({
                    "reason": reason,
                }),
            )],
        }
    }

    fn reply_with_lighting_change(response: ResponseEnvelope, reason: &str) -> EngineReply {
        EngineReply {
            response,
            events: vec![event_message(
                EVENT_LIGHTING_CHANGED,
                json!({
                    "reason": reason,
                }),
            )],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::format_health_summary;

    #[test]
    fn health_summary_includes_all_native_domains() {
        let summary = format_health_summary(
            "ok",
            "Schema v1, journal mode wal, integrity ok",
            "Lighting ready.",
            "Audio ready.",
            "Bridge ready at http://127.0.0.1:38201",
        );

        assert!(summary.contains("Health 'ok'."));
        assert!(summary.contains("Storage Schema v1"));
        assert!(summary.contains("Lighting ready."));
        assert!(summary.contains("Audio ready."));
        assert!(summary.contains("Control surface Bridge ready"));
    }
}
