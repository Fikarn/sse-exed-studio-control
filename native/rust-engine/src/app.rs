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
            "engine.ready",
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
            "health.snapshot" => match self.read_health_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "app.snapshot" => match self.read_app_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "commissioning.snapshot" => match self.read_commissioning_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "lighting.snapshot" => match self.read_lighting_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "lighting.dmxMonitor.snapshot" => match self.read_lighting_dmx_monitor_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "lighting.scene.recall" => match parse_lighting_scene_recall_request(&request.params) {
                Ok(recall_request) => {
                    match recall_lighting_scene(&self.runtime.db_path, &recall_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "scene-recalled",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.scene.create" => match parse_lighting_scene_create_request(&request.params) {
                Ok(create_request) => {
                    match create_lighting_scene(&self.runtime.db_path, &create_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "scene-created",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.scene.update" => match parse_lighting_scene_update_request(&request.params) {
                Ok(update_request) => {
                    match update_lighting_scene(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "scene-updated",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.scene.delete" => match parse_lighting_scene_delete_request(&request.params) {
                Ok(delete_request) => {
                    match delete_lighting_scene(&self.runtime.db_path, &delete_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "scene-deleted",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.group.create" => match parse_lighting_group_create_request(&request.params) {
                Ok(create_request) => {
                    match create_lighting_group(&self.runtime.db_path, &create_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "group-created",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.group.update" => match parse_lighting_group_update_request(&request.params) {
                Ok(update_request) => {
                    match update_lighting_group(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "group-updated",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.group.delete" => match parse_lighting_group_delete_request(&request.params) {
                Ok(delete_request) => {
                    match delete_lighting_group(&self.runtime.db_path, &delete_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "group-deleted",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.settings.update" => {
                match parse_lighting_settings_update_request(&request.params) {
                    Ok(update_request) => {
                        match update_lighting_settings(&self.runtime.db_path, &update_request) {
                            Ok(result) => Self::reply_with_lighting_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "settings-updated",
                            ),
                            Err(error) => match error {
                                LightingCommandError::Rejected(code, message) => {
                                    Self::reply(error_response(request.id, code, message))
                                }
                                LightingCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "lighting.fixture.create" => {
                match parse_lighting_fixture_create_request(&request.params) {
                    Ok(create_request) => {
                        match create_lighting_fixture(&self.runtime.db_path, &create_request) {
                            Ok(result) => Self::reply_with_lighting_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "fixture-created",
                            ),
                            Err(error) => match error {
                                LightingCommandError::Rejected(code, message) => {
                                    Self::reply(error_response(request.id, code, message))
                                }
                                LightingCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "lighting.fixture.update" => {
                match parse_lighting_fixture_update_request(&request.params) {
                    Ok(update_request) => {
                        match update_lighting_fixture(&self.runtime.db_path, &update_request) {
                            Ok(result) => Self::reply_with_lighting_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "fixture-updated",
                            ),
                            Err(error) => match error {
                                LightingCommandError::Rejected(code, message) => {
                                    Self::reply(error_response(request.id, code, message))
                                }
                                LightingCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "lighting.fixture.delete" => {
                match parse_lighting_fixture_delete_request(&request.params) {
                    Ok(delete_request) => {
                        match delete_lighting_fixture(&self.runtime.db_path, &delete_request) {
                            Ok(result) => Self::reply_with_lighting_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "fixture-deleted",
                            ),
                            Err(error) => match error {
                                LightingCommandError::Rejected(code, message) => {
                                    Self::reply(error_response(request.id, code, message))
                                }
                                LightingCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "lighting.group.power" => match parse_lighting_group_power_request(&request.params) {
                Ok(power_request) => {
                    match set_lighting_group_power(&self.runtime.db_path, &power_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "group-powered",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.power.all" => match parse_lighting_all_power_request(&request.params) {
                Ok(power_request) => {
                    match set_lighting_all_power(&self.runtime.db_path, &power_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "all-powered",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.cue.create" => match parse_lighting_cue_create_request(&request.params) {
                Ok(create_request) => {
                    match create_lighting_cue(&self.runtime.db_path, &create_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "cue-created",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.cue.update" => match parse_lighting_cue_update_request(&request.params) {
                Ok(update_request) => {
                    match update_lighting_cue(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "cue-updated",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.cue.delete" => match parse_lighting_cue_delete_request(&request.params) {
                Ok(delete_request) => {
                    match delete_lighting_cue(&self.runtime.db_path, &delete_request) {
                        Ok(result) => Self::reply_with_lighting_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "cue-deleted",
                        ),
                        Err(error) => match error {
                            LightingCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            LightingCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "lighting.cue.fire" => match parse_lighting_cue_fire_request(&request.params) {
                Ok(fire_request) => match fire_lighting_cue(&self.runtime.db_path, &fire_request) {
                    Ok(result) => Self::reply_with_lighting_change(
                        ok_response(
                            request.id,
                            serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                        ),
                        "cue-fired",
                    ),
                    Err(error) => match error {
                        LightingCommandError::Rejected(code, message) => {
                            Self::reply(error_response(request.id, code, message))
                        }
                        LightingCommandError::Storage(message) => {
                            Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                        }
                    },
                },
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "audio.snapshot" => match self.read_audio_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "audio.sync" => match sync_audio_console(&self.runtime.db_path) {
                Ok(result) => Self::reply_with_audio_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    "console-synced",
                ),
                Err(error) => match error {
                    AudioCommandError::Rejected(code, message) => {
                        Self::reply(error_response(request.id, code, message))
                    }
                    AudioCommandError::Storage(message) => {
                        Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                    }
                },
            },
            "audio.snapshot.recall" => match parse_audio_snapshot_recall_request(&request.params) {
                Ok(recall_request) => {
                    match recall_audio_snapshot(&self.runtime.db_path, &recall_request) {
                        Ok(result) => Self::reply_with_audio_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "snapshot-recalled",
                        ),
                        Err(error) => match error {
                            AudioCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            AudioCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "audio.snapshot.create" => match parse_audio_snapshot_create_request(&request.params) {
                Ok(create_request) => {
                    match create_audio_snapshot(&self.runtime.db_path, &create_request) {
                        Ok(result) => Self::reply_with_audio_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "snapshot-created",
                        ),
                        Err(error) => match error {
                            AudioCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            AudioCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "audio.snapshot.update" => match parse_audio_snapshot_update_request(&request.params) {
                Ok(update_request) => {
                    match update_audio_snapshot(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_audio_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "snapshot-updated",
                        ),
                        Err(error) => match error {
                            AudioCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            AudioCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "audio.snapshot.delete" => match parse_audio_snapshot_delete_request(&request.params) {
                Ok(delete_request) => {
                    match delete_audio_snapshot(&self.runtime.db_path, &delete_request) {
                        Ok(result) => Self::reply_with_audio_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "snapshot-deleted",
                        ),
                        Err(error) => match error {
                            AudioCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            AudioCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "audio.channel.update" => match parse_audio_channel_update_request(&request.params) {
                Ok(update_request) => {
                    match update_audio_channel(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_audio_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "channel-updated",
                        ),
                        Err(error) => match error {
                            AudioCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            AudioCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "audio.mixTarget.update" => {
                match parse_audio_mix_target_update_request(&request.params) {
                    Ok(update_request) => {
                        match update_audio_mix_target(&self.runtime.db_path, &update_request) {
                            Ok(result) => Self::reply_with_audio_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "mix-target-updated",
                            ),
                            Err(error) => {
                                match error {
                                    AudioCommandError::Rejected(code, message) => {
                                        Self::reply(error_response(request.id, code, message))
                                    }
                                    AudioCommandError::Storage(message) => Self::reply(
                                        error_response(request.id, "STORAGE_ERROR", message),
                                    ),
                                }
                            }
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "audio.settings.update" => match parse_audio_settings_update_request(&request.params) {
                Ok(update_request) => {
                    match update_audio_settings(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_audio_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "settings-updated",
                        ),
                        Err(error) => match error {
                            AudioCommandError::Rejected(code, message) => {
                                Self::reply(error_response(request.id, code, message))
                            }
                            AudioCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "support.snapshot" => match self.read_support_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "controlSurface.snapshot" => match self.read_control_surface_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
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
            "commissioning.check.run" => match parse_commissioning_check_request(&request.params) {
                Ok(check_request) => {
                    match run_commissioning_check(&self.runtime.db_path, &check_request) {
                        Ok(result) => Self::reply_with_commissioning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "check-updated",
                        ),
                        Err(error) => match error {
                            CommissioningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            CommissioningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "commissioning.seedPlanningDemo" => {
                match parse_commissioning_seed_request(&request.params) {
                    Ok(seed_request) => {
                        match seed_sample_planning_data(&self.runtime, &seed_request) {
                            Ok(result) => Self::reply_with_commissioning_and_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "sample-planning-seeded",
                            ),
                            Err(error) => match error {
                                CommissioningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                CommissioningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "dev.parityFixture.load" => match parse_parity_fixture_request(&request.params) {
                Ok(fixture_request) => match load_parity_fixture(&self.runtime, &fixture_request) {
                    Ok(result) => Self::reply_with_app_commissioning_and_planning_change(
                        ok_response(
                            request.id,
                            serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                        ),
                        "parity-fixture-loaded",
                    ),
                    Err(error) => match error {
                        ParityFixtureError::InvalidParams(message) => {
                            Self::reply(invalid_params(request.id, message))
                        }
                        ParityFixtureError::Storage(message) => {
                            Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                        }
                    },
                },
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "settings.get" => match self.read_shell_settings() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "planning.snapshot" => match self.read_planning_snapshot() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "planning.context" => match self.read_planning_context() {
                Ok(result) => Self::reply(ok_response(request.id, result)),
                Err(error) => Self::reply(error_response(
                    request.id,
                    "STORAGE_ERROR",
                    error.to_string(),
                )),
            },
            "planning.report.time" => match parse_planning_time_report_request(&request.params) {
                Ok(project_id) => match self.read_planning_time_report(project_id.as_deref()) {
                    Ok(result) => Self::reply(ok_response(request.id, result)),
                    Err(error) => Self::reply(error_response(
                        request.id,
                        "STORAGE_ERROR",
                        error.to_string(),
                    )),
                },
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.settings.update" => match parse_planning_settings_update(&request.params) {
                Ok(update_request) => {
                    match update_planning_settings(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "settings-updated",
                            result.settings.selected_project_id.as_deref(),
                            result.settings.selected_task_id.as_deref(),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.select" => match parse_planning_selection_request(&request.params) {
                Ok(selection_request) => {
                    match apply_planning_selection(&self.runtime.db_path, &selection_request) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "selection-updated",
                            result.settings.selected_project_id.as_deref(),
                            result.settings.selected_task_id.as_deref(),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.project.create" => {
                match parse_planning_project_create_request(&request.params) {
                    Ok(create_request) => {
                        match apply_planning_project_create(&self.runtime.db_path, &create_request)
                        {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "project-created",
                                Some(result.project.id.as_str()),
                                result.context.settings.selected_task_id.as_deref(),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.project.update" => {
                match parse_planning_project_update_request(&request.params) {
                    Ok(update_request) => {
                        match apply_planning_project_update(&self.runtime.db_path, &update_request)
                        {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "project-updated",
                                Some(result.project.id.as_str()),
                                result.context.settings.selected_task_id.as_deref(),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.project.delete" => {
                match parse_planning_project_delete_request(&request.params) {
                    Ok(delete_request) => {
                        match apply_planning_project_delete(&self.runtime.db_path, &delete_request)
                        {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "project-deleted",
                                result.context.settings.selected_project_id.as_deref(),
                                result.context.settings.selected_task_id.as_deref(),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.project.reorder" => {
                match parse_planning_project_reorder_request(&request.params) {
                    Ok(reorder_request) => {
                        match apply_planning_project_reorder(
                            &self.runtime.db_path,
                            &reorder_request,
                        ) {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "project-reordered",
                                Some(result.project.id.as_str()),
                                result.context.settings.selected_task_id.as_deref(),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.task.create" => match parse_planning_task_create_request(&request.params) {
                Ok(create_request) => {
                    match apply_planning_task_create(&self.runtime.db_path, &create_request) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "task-created",
                            Some(result.task.project_id.as_str()),
                            Some(result.task.id.as_str()),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.task.update" => match parse_planning_task_update_request(&request.params) {
                Ok(update_request) => {
                    match apply_planning_task_update(&self.runtime.db_path, &update_request) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "task-updated",
                            Some(result.task.project_id.as_str()),
                            Some(result.task.id.as_str()),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.task.reschedule" => {
                match parse_planning_task_reschedule_request(&request.params) {
                    Ok(reschedule_request) => {
                        match apply_planning_task_reschedule(
                            &self.runtime.db_path,
                            &reschedule_request,
                        ) {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "task-rescheduled",
                                Some(result.task.project_id.as_str()),
                                Some(result.task.id.as_str()),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.task.delete" => match parse_planning_task_delete_request(&request.params) {
                Ok(delete_request) => {
                    match apply_planning_task_delete(&self.runtime.db_path, &delete_request) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "task-deleted",
                            result.context.settings.selected_project_id.as_deref(),
                            result.context.settings.selected_task_id.as_deref(),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.task.checklist.add" => {
                match parse_planning_task_checklist_add_request(&request.params) {
                    Ok(add_request) => {
                        match apply_planning_task_checklist_add(&self.runtime.db_path, &add_request)
                        {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "task-checklist-added",
                                Some(result.task.project_id.as_str()),
                                Some(result.task.id.as_str()),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.task.checklist.update" => {
                match parse_planning_task_checklist_update_request(&request.params) {
                    Ok(update_request) => match apply_planning_task_checklist_update(
                        &self.runtime.db_path,
                        &update_request,
                    ) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "task-checklist-updated",
                            Some(result.task.project_id.as_str()),
                            Some(result.task.id.as_str()),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    },
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.task.checklist.delete" => {
                match parse_planning_task_checklist_delete_request(&request.params) {
                    Ok(delete_request) => match apply_planning_task_checklist_delete(
                        &self.runtime.db_path,
                        &delete_request,
                    ) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            "task-checklist-deleted",
                            Some(result.task.project_id.as_str()),
                            Some(result.task.id.as_str()),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    },
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "planning.task.timer" => match parse_planning_task_timer_request(&request.params) {
                Ok(timer_request) => {
                    match apply_planning_task_timer(&self.runtime.db_path, &timer_request) {
                        Ok(result) => Self::reply_with_planning_change(
                            ok_response(
                                request.id,
                                serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                            ),
                            &format!("task-timer-{}", result.resolved_action),
                            Some(result.task.project_id.as_str()),
                            Some(result.task.id.as_str()),
                        ),
                        Err(error) => match error {
                            PlanningCommandError::InvalidParams(message) => {
                                Self::reply(invalid_params(request.id, message))
                            }
                            PlanningCommandError::Storage(message) => {
                                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                            }
                        },
                    }
                }
                Err(message) => Self::reply(invalid_params(request.id, message)),
            },
            "planning.task.toggleComplete" => {
                match parse_planning_task_toggle_complete_request(&request.params) {
                    Ok(toggle_request) => {
                        match apply_planning_task_toggle_complete(
                            &self.runtime.db_path,
                            &toggle_request,
                        ) {
                            Ok(result) => Self::reply_with_planning_change(
                                ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                ),
                                "task-completion-toggled",
                                Some(result.task.project_id.as_str()),
                                Some(result.task.id.as_str()),
                            ),
                            Err(error) => match error {
                                PlanningCommandError::InvalidParams(message) => {
                                    Self::reply(invalid_params(request.id, message))
                                }
                                PlanningCommandError::Storage(message) => Self::reply(
                                    error_response(request.id, "STORAGE_ERROR", message),
                                ),
                            },
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
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
                "planning.changed",
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
                "commissioning.changed",
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
                    "app.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "commissioning.changed",
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
                    "commissioning.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "planning.changed",
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
                    "app.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "commissioning.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "planning.changed",
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
                "support.changed",
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
                    "support.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "settings.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "app.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "commissioning.changed",
                    json!({
                        "reason": reason,
                    }),
                ),
                event_message(
                    "planning.changed",
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
                "audio.changed",
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
                "lighting.changed",
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
