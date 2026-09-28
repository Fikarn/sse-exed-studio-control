use crate::action_log::{
    record_actions_or_log, ui_actions, ui_method_class, ui_method_stages_in_preview, UiMethodClass,
};
use crate::app_state::{
    build_app_snapshot, parse_commissioning_override, parse_commissioning_update,
    APP_SETTINGS_PREFIX, COMMISSIONING_COMPLETED_KEY,
};
use crate::audio::{
    clear_all_audio_solo, clear_audio_clips, create_audio_snapshot, delete_audio_snapshot,
    parse_audio_channel_update_request, parse_audio_clip_clear_request,
    parse_audio_dynamics_update_request, parse_audio_eq_update_request,
    parse_audio_mix_target_update_request, parse_audio_send_mode_update_request,
    parse_audio_settings_update_request, parse_audio_snapshot_create_request,
    parse_audio_snapshot_delete_request, parse_audio_snapshot_recall_request,
    parse_audio_snapshot_update_request, read_audio_snapshot, recall_audio_snapshot,
    sync_audio_console, update_audio_channel, update_audio_channel_dynamics,
    update_audio_channel_eq, update_audio_channel_send_mode, update_audio_mix_target,
    update_audio_settings, update_audio_snapshot, AudioCommandError,
};
use crate::bootstrap::{bootstrap_runtime, recovery_runtime_context, RuntimeContext, RuntimePaths};
use crate::cameras::{
    after_archive_restore as cameras_after_archive_restore, handle_cameras_request, CameraError,
};
use crate::commissioning::{
    evaluate_publish_gate, publish_override_timestamp, PublishGate, PUBLISH_OVERRIDE_AT_KEY,
};
use crate::commissioning::{
    parse_commissioning_check_request, read_commissioning_snapshot, run_commissioning_check,
    CommissioningCommandError,
};
use crate::diagnostics::{append_log, configured_log_level, request_log_line};
use crate::engine_events::{cameras_changed_payload, prompter_changed_payload};
use crate::exports::{build_control_surface_snapshot, export_companion_config, ExportCommandError};
use crate::lighting::{
    apply_lighting_palette_with_preview, bump_lighting_render_generation,
    clear_lighting_identify_bursts, create_lighting_fixture, create_lighting_group,
    create_lighting_palette, create_lighting_scene_with_preview, delete_lighting_fixture,
    delete_lighting_group, delete_lighting_palette, delete_lighting_scene,
    discard_lighting_preview, identify_lighting_fixture, list_lighting_palettes,
    lock_shared_lighting_preview, parse_lighting_all_power_request,
    parse_lighting_fixture_create_request, parse_lighting_fixture_delete_request,
    parse_lighting_fixture_highlight_request, parse_lighting_fixture_identify_clear_all_request,
    parse_lighting_fixture_identify_request, parse_lighting_fixture_identify_sequence_request,
    parse_lighting_fixture_update_request, parse_lighting_group_create_request,
    parse_lighting_group_delete_request, parse_lighting_group_power_request,
    parse_lighting_group_reorder_request, parse_lighting_group_update_request,
    parse_lighting_output_armed_request, parse_lighting_palette_apply_request,
    parse_lighting_palette_create_request, parse_lighting_palette_delete_request,
    parse_lighting_palette_update_request, parse_lighting_preview_discard_request,
    parse_lighting_preview_mode_request, parse_lighting_scene_create_request,
    parse_lighting_scene_delete_request, parse_lighting_scene_pin_request,
    parse_lighting_scene_recall_request, parse_lighting_scene_reorder_request,
    parse_lighting_scene_update_request, parse_lighting_settings_update_request,
    pin_lighting_scene, read_lighting_dmx_monitor_snapshot, read_lighting_fixture_catalog_snapshot,
    read_lighting_snapshot_with_preview, recall_lighting_scene_with_preview,
    reorder_lighting_group, reorder_lighting_scene, set_lighting_all_power_with_preview,
    set_lighting_fixture_highlight, set_lighting_group_power_with_preview,
    set_lighting_output_armed, set_lighting_preview_mode, start_lighting_identify_sequence,
    update_lighting_fixture_with_preview, update_lighting_group, update_lighting_palette,
    update_lighting_scene_with_preview, update_lighting_settings, with_lighting_state,
    with_lighting_state_and_preview, LightingCommandError, LightingPreviewRuntimeState,
};
use crate::prompter::{after_archive_restore, handle_prompter_request, PrompterError};
use crate::protocol::{
    error_response, event_message, invalid_params, ok_response, RequestEnvelope, ResponseEnvelope,
    EVENT_APP_CHANGED, EVENT_AUDIO_CHANGED, EVENT_CAMERAS_CHANGED, EVENT_COMMISSIONING_CHANGED,
    EVENT_ENGINE_READY, EVENT_LIGHTING_CHANGED, EVENT_PROMPTER_CHANGED, EVENT_SETTINGS_CHANGED,
    EVENT_SUPPORT_CHANGED,
};
use crate::shell_settings::{parse_settings_update, ShellSettingsSnapshot, SHELL_SETTINGS_PREFIX};
use crate::storage::{list_settings_by_prefix, set_settings, EngineResult};
use crate::support::{
    export_support_backup, parse_support_restore_request, read_support_snapshot,
    restore_support_backup, verify_support_backup, SupportCommandError,
};
use serde_json::json;
use std::time::Instant;

pub struct EngineApp {
    runtime: RuntimeContext,
}

pub struct EngineReply {
    pub response: ResponseEnvelope,
    pub events: Vec<serde_json::Value>,
}

/// The requests a recovery-mode engine answers (Slice 7 — F20): the ones
/// that list, verify and restore backups without opening the database that
/// failed its check. Everything else is `ENGINE_NOT_READY`.
const RECOVERY_METHODS: &[&str] = &[
    "engine.ping",
    "support.snapshot",
    "support.backup.verify",
    "support.backup.restore",
];

fn support_error_response(id: serde_json::Value, error: SupportCommandError) -> ResponseEnvelope {
    match error {
        SupportCommandError::InvalidParams(message) => invalid_params(id, message),
        SupportCommandError::Storage(message) => error_response(id, "STORAGE_ERROR", message),
        SupportCommandError::UnsupportedVersion(message) => {
            error_response(id, "SUPPORT_RESTORE_UNSUPPORTED_VERSION", message)
        }
    }
}

impl EngineApp {
    pub fn bootstrap() -> EngineResult<Self> {
        let runtime = bootstrap_runtime()?;
        append_log(&runtime.log_file_path, "INFO", "Engine bootstrap completed")?;
        Ok(Self { runtime })
    }

    /// The engine after a storage failure at start (Slice 7 — F20): no
    /// database, no bridge, no metering. Only the support requests that list,
    /// verify and restore backups are answered, so the recovery surface can
    /// put a database backup in place and restart into it.
    pub fn recovery(runtime_paths: &RuntimePaths) -> Self {
        // The registry says why (Slice 8 — F14); `health.snapshot` is not
        // among the recovery requests, so the recovery surface reads the
        // startup failure, but the state is on record for any later reader.
        crate::health::report(
            crate::health::SUBSYSTEM_STORAGE,
            crate::health::SubsystemState::Error,
            "The saved data failed its check; verify and restore a database backup from Setup / Support",
        );
        Self {
            runtime: recovery_runtime_context(runtime_paths),
        }
    }

    pub fn ready_event(&self) -> serde_json::Value {
        event_message(
            EVENT_ENGINE_READY,
            json!({
                "protocol": self.runtime.protocol_version,
                "engineVersion": env!("CARGO_PKG_VERSION"),
                "appDataDir": self.runtime.app_data_dir.display().to_string(),
                "logsDir": self.runtime.logs_dir.display().to_string(),
                "logFilePath": self.runtime.log_file_path.display().to_string()
            }),
        )
    }

    pub fn should_emit_simulated_audio_meter_ticks(&self) -> bool {
        self.read_audio_snapshot()
            .ok()
            .and_then(|snapshot| {
                snapshot
                    .get("meteringSource")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .is_some_and(|metering_source| metering_source == "simulated")
    }

    pub fn should_emit_rme_totalmix_audio_metering(&self) -> bool {
        self.read_audio_snapshot()
            .ok()
            .and_then(|snapshot| {
                let osc_enabled = snapshot
                    .get("oscEnabled")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                let metering_source = snapshot
                    .get("meteringSource")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)?;
                Some(osc_enabled && metering_source == "rme-totalmix-osc")
            })
            .unwrap_or(false)
    }

    /// Answers one request. One `DEBUG` line per request — method, id,
    /// milliseconds, outcome — replaces the `INFO` line every request used
    /// to write (Slice 8 — F27); it exists only while `SSE_ENGINE_LOG_LEVEL`
    /// is `DEBUG`.
    pub fn handle_request(&self, request: RequestEnvelope) -> EngineReply {
        let started_at = Instant::now();
        let method = request.method.clone();
        let id = request.id.clone();
        // The action log (Slice 11 — F30): what was asked is kept only for
        // the methods that can leave a row.
        let recorded_params = (ui_method_class(&method) == Some(UiMethodClass::Recorded))
            .then(|| request.params.clone());
        let reply = self.dispatch(request);
        if let Some(params) = recorded_params {
            self.record_ui_actions(&method, &params, &reply);
        }
        if let Some(line) = request_log_line(
            configured_log_level(),
            &method,
            &id,
            started_at.elapsed(),
            reply.response.ok,
        ) {
            let _ = append_log(&self.runtime.log_file_path, "DEBUG", &line);
        }
        reply
    }

    /// Every request over IPC is the screen's, so this is where a row gets
    /// the source `ui`; `action_log::ui_actions` holds the table. A refused
    /// request leaves nothing, and neither does a change staged in the
    /// lighting preview: only this thread switches the preview on or off, so
    /// what it reads here is what the mutation saw.
    fn record_ui_actions(&self, method: &str, params: &serde_json::Value, reply: &EngineReply) {
        if !reply.response.ok || !self.runtime.storage_ready {
            return;
        }
        let staged = ui_method_stages_in_preview(method) && lock_shared_lighting_preview().enabled;
        let result = reply
            .response
            .result
            .as_ref()
            .unwrap_or(&serde_json::Value::Null);
        record_actions_or_log(
            &self.runtime.db_path,
            &ui_actions(method, params, result, staged),
        );
    }

    fn dispatch(&self, request: RequestEnvelope) -> EngineReply {
        // Recovery mode (Slice 7 — F20): the database could not be opened,
        // so only the requests that verify and restore a backup are served;
        // anything else would touch the file that failed its check.
        if !self.runtime.storage_ready && !RECOVERY_METHODS.contains(&request.method.as_str()) {
            return Self::reply(error_response(
                request.id,
                "ENGINE_NOT_READY",
                format!(
                    "The saved data needs attention, so {} is not available; verify and restore a database backup from Setup / Support first.",
                    request.method
                ),
            ));
        }

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
            "lighting.fixtureCatalog.snapshot" => {
                self.dispatch_read(request.id, Self::read_lighting_fixture_catalog_snapshot)
            }
            "lighting.dmxMonitor.snapshot" => {
                self.dispatch_read(request.id, Self::read_lighting_dmx_monitor_snapshot)
            }
            "lighting.palette.list" => {
                self.dispatch_read(request.id, Self::read_lighting_palette_list)
            }
            "audio.snapshot" => self.dispatch_read(request.id, Self::read_audio_snapshot),
            "support.snapshot" => self.dispatch_read(request.id, Self::read_support_snapshot),
            "controlSurface.snapshot" => {
                self.dispatch_read(request.id, Self::read_control_surface_snapshot)
            }
            "settings.get" => self.dispatch_read(request.id, Self::read_shell_settings),

            // -------------------------------------------------------------
            // Lighting mutations (M-1event)
            // -------------------------------------------------------------
            "lighting.editor.previewMode" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_preview_mode_request,
                set_lighting_preview_mode,
                |_| "preview-mode-updated",
            ),
            "lighting.editor.previewDiscard" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_preview_discard_request,
                discard_lighting_preview,
                |_| "preview-discarded",
            ),
            "lighting.scene.recall" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_scene_recall_request,
                recall_lighting_scene_with_preview,
                |result| {
                    if result.preview_mode {
                        "scene-preview-recalled"
                    } else {
                        "scene-recalled"
                    }
                },
            ),
            "lighting.scene.create" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_scene_create_request,
                create_lighting_scene_with_preview,
                |_| "scene-created",
            ),
            "lighting.scene.update" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_scene_update_request,
                update_lighting_scene_with_preview,
                |_| "scene-updated",
            ),
            "lighting.scene.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_delete_request,
                delete_lighting_scene,
                "scene-deleted",
            ),
            "lighting.scene.reorder" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_reorder_request,
                reorder_lighting_scene,
                "scene-reordered",
            ),
            "lighting.scene.pin" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_scene_pin_request,
                pin_lighting_scene,
                "scene-pinned",
            ),
            "lighting.palette.create" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_palette_create_request,
                create_lighting_palette,
                "palette-created",
            ),
            "lighting.palette.update" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_palette_update_request,
                update_lighting_palette,
                "palette-updated",
            ),
            "lighting.palette.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_palette_delete_request,
                delete_lighting_palette,
                "palette-deleted",
            ),
            "lighting.palette.apply" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_palette_apply_request,
                apply_lighting_palette_with_preview,
                |_| "palette-applied",
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
            "lighting.group.reorder" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_group_reorder_request,
                reorder_lighting_group,
                "group-reordered",
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
            "lighting.fixture.update" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_fixture_update_request,
                update_lighting_fixture_with_preview,
                |_| "fixture-updated",
            ),
            "lighting.fixture.delete" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_delete_request,
                delete_lighting_fixture,
                "fixture-deleted",
            ),
            "lighting.fixture.identify" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_identify_request,
                identify_lighting_fixture,
                "fixture-identified",
            ),
            "lighting.fixture.highlight" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_highlight_request,
                set_lighting_fixture_highlight,
                "fixture-highlighted",
            ),
            "lighting.fixture.identifySequence" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_identify_sequence_request,
                start_lighting_identify_sequence,
                "identify-sequence-started",
            ),
            "lighting.fixture.identify.clearAll" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_fixture_identify_clear_all_request,
                clear_lighting_identify_bursts,
                "identify-cleared",
            ),
            "lighting.group.power" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_group_power_request,
                set_lighting_group_power_with_preview,
                |_| "group-powered",
            ),
            "lighting.power.all" => self.dispatch_lighting_preview_mutate(
                request,
                parse_lighting_all_power_request,
                set_lighting_all_power_with_preview,
                |_| "all-powered",
            ),
            // Armed / held (Slice 11 — F31): a lighting mutation like any
            // other, so the lock and the render generation come with it and
            // the sACN thread sees the flag on its next tick.
            "lighting.output.setArmed" => self.dispatch_lighting_mutate(
                request,
                parse_lighting_output_armed_request,
                set_lighting_output_armed,
                "output-armed-changed",
            ),
            // -------------------------------------------------------------
            // Audio mutations (M-1event)
            // -------------------------------------------------------------
            "audio.sync" => self.run_audio_mutate(request.id, sync_audio_console, "console-synced"),
            "audio.clip.clear" => self.dispatch_audio_mutate(
                request,
                parse_audio_clip_clear_request,
                clear_audio_clips,
                "clips-cleared",
            ),
            "audio.solo.clearAll" => {
                self.run_audio_mutate(request.id, clear_all_audio_solo, "solo-cleared")
            }
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
            "audio.channel.eq.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_eq_update_request,
                update_audio_channel_eq,
                "channel-eq-updated",
            ),
            "audio.channel.dynamics.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_dynamics_update_request,
                update_audio_channel_dynamics,
                "channel-dynamics-updated",
            ),
            "audio.channel.send.update" => self.dispatch_audio_mutate(
                request,
                parse_audio_send_mode_update_request,
                update_audio_channel_send_mode,
                "channel-send-updated",
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
            // Commissioning mutations (M-1event + multi-event variants)
            // -------------------------------------------------------------
            "commissioning.check.run" => {
                // The audio probe outcome drives `audio_capabilities` (console
                // writes are refused until it passes — 2026-09 audit
                // remediation, Slice 1), so audio consumers re-derive their
                // state when an audio probe completes. A rejected request
                // emits no commissioning event and therefore no audio event.
                let targets_audio = request
                    .params
                    .get("target")
                    .and_then(|value| value.as_str())
                    == Some("audio");
                let mut reply = self.dispatch_commissioning_mutate(
                    request,
                    parse_commissioning_check_request,
                    run_commissioning_check,
                    "check-updated",
                );
                if targets_audio && !reply.events.is_empty() {
                    reply.events.push(event_message(
                        EVENT_AUDIO_CHANGED,
                        json!({ "reason": "probe-updated" }),
                    ));
                }
                reply
            }

            // -------------------------------------------------------------
            // The Teleprompter (new pages program, Slice 4): every method
            // runs under the prompter's own lock (`prompter::runtime`).
            // -------------------------------------------------------------
            "prompter.snapshot" => self.dispatch_prompter(request),
            "prompter.glass.snapshot" => self.dispatch_prompter(request),
            "prompter.script.snapshot" => self.dispatch_prompter(request),
            "prompter.script.import" => self.dispatch_prompter(request),
            "prompter.script.paste" => self.dispatch_prompter(request),
            "prompter.paste.convert" => self.dispatch_prompter(request),
            "prompter.script.create" => self.dispatch_prompter(request),
            "prompter.script.rename" => self.dispatch_prompter(request),
            "prompter.script.edit" => self.dispatch_prompter(request),
            "prompter.script.remove" => self.dispatch_prompter(request),
            "prompter.script.restore" => self.dispatch_prompter(request),
            "prompter.script.delete" => self.dispatch_prompter(request),
            "prompter.script.version.bringBack" => self.dispatch_prompter(request),
            "prompter.putOn" => self.dispatch_prompter(request),
            "prompter.update" => self.dispatch_prompter(request),
            "prompter.clear" => self.dispatch_prompter(request),
            "prompter.play" => self.dispatch_prompter(request),
            "prompter.pause" => self.dispatch_prompter(request),
            "prompter.speed" => self.dispatch_prompter(request),
            "prompter.jump" => self.dispatch_prompter(request),
            "prompter.textSize" => self.dispatch_prompter(request),
            "prompter.look.update" => self.dispatch_prompter(request),
            "prompter.layout.report" => self.dispatch_prompter(request),
            "prompter.screen.report" => self.dispatch_prompter(request),

            // -------------------------------------------------------------
            // The cameras (new pages program, Slice 8): every method runs
            // under the cameras' own lock (`cameras::runtime`).
            // -------------------------------------------------------------
            "cameras.snapshot" => self.dispatch_cameras(request),
            "cameras.select" => self.dispatch_cameras(request),
            "cameras.set" => self.dispatch_cameras(request),
            "cameras.step" => self.dispatch_cameras(request),
            "cameras.auto" => self.dispatch_cameras(request),
            "cameras.format.set" => self.dispatch_cameras(request),
            "cameras.look.set" => self.dispatch_cameras(request),
            "cameras.record.start" => self.dispatch_cameras(request),
            "cameras.record.stop" => self.dispatch_cameras(request),
            "cameras.release" => self.dispatch_cameras(request),
            "cameras.connect" => self.dispatch_cameras(request),
            "cameras.setup.update" => self.dispatch_cameras(request),
            "cameras.setup.pair" => self.dispatch_cameras(request),
            "cameras.setup.forget" => self.dispatch_cameras(request),

            // -------------------------------------------------------------
            // Custom arms — kept hand-written because they have non-uniform
            // error enums (support.backup.*), chained snapshot reads
            // (commissioning.update, settings.update), or unique reply
            // shapes (exports.companion.export). storage.importLegacyDb left
            // with the db.json import (new pages program, Slice 2b) and
            // answers UNKNOWN_METHOD below.
            // -------------------------------------------------------------
            "support.backup.export" => match export_support_backup(&self.runtime) {
                Ok(result) => Self::reply_with_support_change(
                    ok_response(
                        request.id,
                        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                    ),
                    "backup-exported",
                ),
                Err(error) => Self::reply(support_error_response(request.id, error)),
            },
            "support.backup.verify" => {
                match parse_support_restore_request(&request.params, &self.runtime.backups_dir) {
                    Ok(verify_request) => Self::reply(ok_response(
                        request.id,
                        serde_json::to_value(verify_support_backup(&verify_request))
                            .unwrap_or_else(|_| json!({})),
                    )),
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
            "support.backup.restore" => {
                match parse_support_restore_request(&request.params, &self.runtime.backups_dir) {
                    Ok(restore_request) => {
                        // The archive restore rewrites every lighting setting in
                        // one transaction; under the lighting state lock a deck
                        // key cannot write its older copy back over it (Slice 10).
                        match with_lighting_state(|| {
                            restore_support_backup(&self.runtime, &restore_request)
                        }) {
                            Ok(result) => {
                                let response = ok_response(
                                    request.id,
                                    serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                                );
                                if result.requires_restart {
                                    // Nothing changed yet: the database backup is
                                    // applied at the next start (Slice 7 — F20).
                                    Self::reply_with_support_change(
                                        response,
                                        "backup-restore-staged",
                                    )
                                } else {
                                    let mut reply = Self::reply_with_support_restore_change(
                                        response,
                                        "backup-restored",
                                    );
                                    // Slice 4: a restore leaves the prompter paused
                                    // where it was (D12) and may bring the look back.
                                    match after_archive_restore(&self.runtime.db_path) {
                                        Ok(anchor) => reply.events.push(event_message(
                                            EVENT_PROMPTER_CHANGED,
                                            prompter_changed_payload("backup-restored", anchor),
                                        )),
                                        Err(error) => {
                                            let _ = append_log(
                                            &self.runtime.log_file_path,
                                            "WARN",
                                            &format!("The prompter could not settle after the restore: {error:?}"),
                                        );
                                        }
                                    }
                                    self.after_restore_cameras(&mut reply);
                                    reply
                                }
                            }
                            Err(error) => Self::reply(support_error_response(request.id, error)),
                        }
                    }
                    Err(message) => Self::reply(invalid_params(request.id, message)),
                }
            }
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
            "commissioning.update" => match parse_commissioning_update(&request.params)
                .map_err(CommissioningUpdateRefusal::InvalidParams)
                .and_then(|updates| self.gate_commissioning_publish(updates, &request.params))
            {
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
                Err(CommissioningUpdateRefusal::InvalidParams(message)) => {
                    Self::reply(invalid_params(request.id, message))
                }
                Err(CommissioningUpdateRefusal::ProbesIncomplete(message)) => Self::reply(
                    error_response(request.id, "COMMISSIONING_PROBES_INCOMPLETE", message),
                ),
                Err(CommissioningUpdateRefusal::Storage(message)) => {
                    Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                }
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
        Ok(build_app_snapshot(
            &self.runtime,
            &shell_settings,
            &app_settings,
        ))
    }

    fn read_commissioning_snapshot(&self) -> EngineResult<serde_json::Value> {
        Ok(serde_json::to_value(read_commissioning_snapshot(
            &self.runtime.db_path,
        )?)?)
    }

    fn read_lighting_snapshot(&self) -> EngineResult<serde_json::Value> {
        // A reader takes the shared preview alone, and before the settings:
        // a preview-aware mutation holds it from its first read to its last
        // write, so the pair read here is from one side of it (Slice 10).
        let preview = lock_shared_lighting_preview();
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_lighting_snapshot_with_preview(
            &app_settings,
            &preview,
        ))?)
    }

    fn read_lighting_fixture_catalog_snapshot(&self) -> EngineResult<serde_json::Value> {
        Ok(serde_json::to_value(
            read_lighting_fixture_catalog_snapshot(),
        )?)
    }

    fn read_lighting_dmx_monitor_snapshot(&self) -> EngineResult<serde_json::Value> {
        let app_settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)?;
        Ok(serde_json::to_value(read_lighting_dmx_monitor_snapshot(
            &app_settings,
        ))?)
    }

    fn read_lighting_palette_list(&self) -> EngineResult<serde_json::Value> {
        let result = list_lighting_palettes(&self.runtime.db_path)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        Ok(serde_json::to_value(result)?)
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
        let mut snapshot = serde_json::to_value(build_control_surface_snapshot())?;
        if let Some(object) = snapshot.as_object_mut() {
            object.insert(
                String::from("lastEvent"),
                crate::control_surface::control_surface_last_event(&self.runtime.db_path),
            );
        }
        Ok(snapshot)
    }

    fn read_health_snapshot(&self) -> EngineResult<serde_json::Value> {
        crate::health::read_health_snapshot(&self.runtime)
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
    // the uniform shapes (read-no-params, mutate with a single event) so the
    // match body collapses to one-liners. Custom arms with non-uniform error enums
    // or chained read-snapshot calls (`commissioning.update`, `settings.update`,
    // `support.backup.*`, `exports.companion.export`) stay as hand-written
    // branches.
    // -----------------------------------------------------------------------

    /// A `prompter.*` request: its reply, `prompter.changed` with the
    /// glass's anchor when it changed anything, and `app.changed { reason:
    /// "health" }` when `checks.prompter` says something else after it
    /// (Slice 5a), so the header's lamp follows.
    fn dispatch_prompter(&self, request: RequestEnvelope) -> EngineReply {
        match handle_prompter_request(&self.runtime.db_path, &request.method, &request.params) {
            Ok(reply) => {
                let mut events: Vec<serde_json::Value> = reply
                    .reason
                    .map(|reason| {
                        vec![event_message(
                            EVENT_PROMPTER_CHANGED,
                            prompter_changed_payload(reason, reply.anchor),
                        )]
                    })
                    .unwrap_or_default();
                if reply.health_changed {
                    events.push(event_message(
                        EVENT_APP_CHANGED,
                        json!({ "reason": crate::health::APP_CHANGED_REASON_HEALTH }),
                    ));
                }
                EngineReply {
                    response: ok_response(request.id, reply.result),
                    events,
                }
            }
            Err(PrompterError::Invalid(message)) => {
                Self::reply(invalid_params(request.id, message))
            }
            Err(PrompterError::Refused(code, message)) => {
                Self::reply(error_response(request.id, code, message))
            }
            Err(PrompterError::Storage(message)) => {
                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
            }
        }
    }

    /// A `cameras.*` request: its reply, `cameras.changed { reason, camera
    /// }` when it changed anything, and `app.changed { reason: "health" }`
    /// when `checks.cameras` says something else after it (Slice 8), so the
    /// header's lamp follows.
    fn dispatch_cameras(&self, request: RequestEnvelope) -> EngineReply {
        match handle_cameras_request(
            &self.runtime.db_path,
            self.runtime.cameras_simulated,
            &request.method,
            &request.params,
        ) {
            Ok(reply) => {
                let mut events: Vec<serde_json::Value> = reply
                    .event
                    .map(|(reason, camera)| {
                        vec![event_message(
                            EVENT_CAMERAS_CHANGED,
                            cameras_changed_payload(reason, camera),
                        )]
                    })
                    .unwrap_or_default();
                if reply.health_changed {
                    events.push(event_message(
                        EVENT_APP_CHANGED,
                        json!({ "reason": crate::health::APP_CHANGED_REASON_HEALTH }),
                    ));
                }
                EngineReply {
                    response: ok_response(request.id, reply.result),
                    events,
                }
            }
            Err(CameraError::Invalid(message)) => Self::reply(invalid_params(request.id, message)),
            Err(CameraError::Refused(code, message)) => {
                Self::reply(error_response(request.id, code, message))
            }
            Err(CameraError::Storage(message)) => {
                Self::reply(error_response(request.id, "STORAGE_ERROR", message))
            }
        }
    }

    /// Slice 8: an applied archive restore wrote the cameras' addresses and
    /// vMix inputs (format 7) and sent nothing to a camera; the hardware link
    /// takes the new setup and says so with `cameras.changed { reason:
    /// "restore", camera: null }`, and `app.changed { reason: "health" }`
    /// when `checks.cameras` changed.
    fn after_restore_cameras(&self, reply: &mut EngineReply) {
        // Every applied restore raises the event (`v1.md`), even when the
        // cameras could not take their setup: the page reads them again.
        reply.events.push(event_message(
            EVENT_CAMERAS_CHANGED,
            cameras_changed_payload("restore", None),
        ));
        match cameras_after_archive_restore(&self.runtime.db_path, self.runtime.cameras_simulated) {
            Ok(true) => {
                reply.events.push(event_message(
                    EVENT_APP_CHANGED,
                    json!({ "reason": crate::health::APP_CHANGED_REASON_HEALTH }),
                ));
            }
            Ok(false) => {}
            Err(error) => {
                let _ = append_log(
                    &self.runtime.log_file_path,
                    "WARN",
                    &format!("The cameras could not take their setup after the restore: {error:?}"),
                );
            }
        }
    }

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

    fn dispatch_lighting_preview_mutate<P, R, F, H, K>(
        &self,
        request: RequestEnvelope,
        parse: F,
        handler: H,
        reason: K,
    ) -> EngineReply
    where
        R: serde::Serialize,
        F: FnOnce(&serde_json::Value) -> Result<P, String>,
        H: FnOnce(
            &std::path::Path,
            &P,
            &mut LightingPreviewRuntimeState,
        ) -> Result<R, LightingCommandError>,
        K: FnOnce(&R) -> &'static str,
    {
        match parse(&request.params) {
            Ok(parsed) => {
                // The lighting state lock first, then the preview the Stream
                // Deck bridge shares (Slice 10 — F12).
                let outcome = with_lighting_state_and_preview(|preview| {
                    handler(&self.runtime.db_path, &parsed, preview)
                });
                match outcome {
                    Ok(result) => Self::reply_with_lighting_change(
                        ok_response(
                            request.id,
                            serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                        ),
                        reason(&result),
                    ),
                    Err(LightingCommandError::Rejected(code, message)) => {
                        Self::reply(error_response(request.id, code, message))
                    }
                    Err(LightingCommandError::Storage(message)) => {
                        Self::reply(error_response(request.id, "STORAGE_ERROR", message))
                    }
                }
            }
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
            Ok(parsed) => match with_lighting_state(|| handler(&self.runtime.db_path, &parsed)) {
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
                Ok(result) => {
                    // A lighting probe stores the bridge address and the
                    // universe it used (Slice 10 — F18).
                    bump_lighting_render_generation();
                    Self::reply_with_commissioning_change(
                        ok_response(
                            request.id,
                            serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
                        ),
                        reason,
                    )
                }
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

    fn reply(response: ResponseEnvelope) -> EngineReply {
        EngineReply {
            response,
            events: Vec::new(),
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

enum CommissioningUpdateRefusal {
    InvalidParams(String),
    ProbesIncomplete(String),
    Storage(String),
}

impl EngineApp {
    /// 2026-09 audit Slice 8 (operator decision 7): publishing (`stage:
    /// ready`) is refused while any commissioning probe is not `passed`,
    /// unless the request carries the explicit `overrideProbes: true`. An
    /// override is recorded (`app.commissioning.publish_override_at`) and
    /// logged; a clean publish clears any earlier marker. Requests that do
    /// not publish pass through untouched.
    fn gate_commissioning_publish(
        &self,
        mut updates: Vec<(&'static str, String)>,
        params: &serde_json::Value,
    ) -> Result<Vec<(&'static str, String)>, CommissioningUpdateRefusal> {
        let override_probes = parse_commissioning_override(params)
            .map_err(CommissioningUpdateRefusal::InvalidParams)?;
        let publishing = updates
            .iter()
            .any(|(key, value)| *key == COMMISSIONING_COMPLETED_KEY && value == "true");
        if !publishing {
            return Ok(updates);
        }
        let settings = list_settings_by_prefix(&self.runtime.db_path, APP_SETTINGS_PREFIX)
            .map_err(|error| CommissioningUpdateRefusal::Storage(error.to_string()))?;
        match evaluate_publish_gate(&settings, override_probes) {
            PublishGate::Clear => updates.push((PUBLISH_OVERRIDE_AT_KEY, String::new())),
            PublishGate::Refused { message } => {
                return Err(CommissioningUpdateRefusal::ProbesIncomplete(message));
            }
            PublishGate::Overridden { failing } => {
                let at = publish_override_timestamp(&self.runtime.db_path)
                    .map_err(|error| CommissioningUpdateRefusal::Storage(error.to_string()))?;
                let _ = append_log(
                    &self.runtime.log_file_path,
                    "WARN",
                    &format!(
                        "Commissioning published with a probe override at {at}: {}",
                        failing.join(", ")
                    ),
                );
                updates.push((PUBLISH_OVERRIDE_AT_KEY, at));
            }
        }
        Ok(updates)
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_cameras;
#[cfg(test)]
mod tests_prompter;
