use super::*;
use crate::legacy_import::LegacyImportRequest;
use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::storage::{import_legacy_db, initialize_database, list_settings_by_prefix};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "studio-control-engine-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn seed_planning_state(db_path: &Path, source_path: &Path) {
    initialize_database(db_path).expect("database should initialize");

    fs::write(
        source_path,
        serde_json::to_vec_pretty(&json!({
            "projects": [
                {
                    "id": "proj-1",
                    "title": "Website Redesign",
                    "description": "Marketing refresh",
                    "status": "in-progress",
                    "priority": "p1",
                    "createdAt": "2026-04-01T10:00:00.000Z",
                    "lastUpdated": "2026-04-10T10:00:00.000Z",
                    "order": 0
                },
                {
                    "id": "proj-2",
                    "title": "Studio Launch",
                    "description": "Commissioning prep",
                    "status": "todo",
                    "priority": "p2",
                    "createdAt": "2026-04-02T10:00:00.000Z",
                    "lastUpdated": "2026-04-09T10:00:00.000Z",
                    "order": 1
                }
            ],
            "tasks": [
                {
                    "id": "task-1",
                    "projectId": "proj-1",
                    "title": "Implement hero section",
                    "description": "",
                    "priority": "p1",
                    "dueDate": "2026-04-20",
                    "labels": ["frontend"],
                    "checklist": [
                        {"id": "check-1", "text": "Wire layout", "done": true}
                    ],
                    "isRunning": false,
                    "totalSeconds": 120,
                    "lastStarted": null,
                    "completed": false,
                    "order": 0,
                    "createdAt": "2026-04-11T10:00:00.000Z"
                },
                {
                    "id": "task-2",
                    "projectId": "proj-1",
                    "title": "Finalize copy",
                    "description": "",
                    "priority": "p2",
                    "dueDate": null,
                    "labels": ["content"],
                    "checklist": [],
                    "isRunning": false,
                    "totalSeconds": 30,
                    "lastStarted": null,
                    "completed": false,
                    "order": 1,
                    "createdAt": "2026-04-12T10:00:00.000Z"
                },
                {
                    "id": "task-3",
                    "projectId": "proj-2",
                    "title": "Cable patch list",
                    "description": "",
                    "priority": "p0",
                    "dueDate": null,
                    "labels": ["ops"],
                    "checklist": [],
                    "isRunning": true,
                    "totalSeconds": 60,
                    "lastStarted": "2026-04-15T00:00:00.000Z",
                    "completed": false,
                    "order": 0,
                    "createdAt": "2026-04-13T10:00:00.000Z"
                }
            ],
            "activityLog": [
                {
                    "id": "act-1",
                    "timestamp": "2026-04-12T10:00:00.000Z",
                    "entityType": "task",
                    "entityId": "task-1",
                    "action": "created",
                    "detail": "Task created"
                },
                {
                    "id": "act-2",
                    "timestamp": "2026-04-14T10:00:00.000Z",
                    "entityType": "project",
                    "entityId": "proj-2",
                    "action": "updated",
                    "detail": "Priority bumped"
                }
            ],
            "settings": {
                "viewFilter": "todo",
                "sortBy": "priority",
                "selectedProjectId": "proj-1",
                "selectedTaskId": "task-2",
                "dashboardView": "kanban",
                "deckMode": "project",
                "hasCompletedSetup": true
            }
        }))
        .expect("legacy payload should serialize"),
    )
    .expect("legacy db should be written");

    import_legacy_db(
        db_path,
        &LegacyImportRequest {
            source_path: source_path.to_path_buf(),
            force: false,
        },
    )
    .expect("legacy import should succeed");
}

#[test]
fn read_planning_snapshot_returns_imported_planning_state() {
    let test_dir = TestDir::new("planning-snapshot");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");

    assert_eq!(snapshot.counts.project_count, 2);
    assert_eq!(snapshot.counts.task_count, 3);
    assert_eq!(snapshot.projects[0].title, "Website Redesign");
    assert_eq!(snapshot.tasks[0].labels, vec![String::from("frontend")]);
    assert_eq!(snapshot.tasks[0].checklist.len(), 1);
    assert_eq!(snapshot.activity_log[0].action, "updated");
    assert_eq!(snapshot.settings.view_filter, "todo");
    assert_eq!(snapshot.settings.dashboard_view, "kanban");
}

#[test]
fn read_planning_context_returns_selected_project_task_and_running_summary() {
    let test_dir = TestDir::new("planning-context");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let context = read_planning_context(&db_path, &planning_settings).expect("context should load");

    assert_eq!(context.project_count, 2);
    assert_eq!(context.project_index, 0);
    assert_eq!(context.task_count, 2);
    assert_eq!(context.task_index, 1);
    assert_eq!(
        context
            .selected_project
            .as_ref()
            .map(|project| project.title.as_str()),
        Some("Website Redesign")
    );
    assert_eq!(
        context
            .selected_task
            .as_ref()
            .map(|task| task.title.as_str()),
        Some("Finalize copy")
    );
    assert!(context.running_task.is_none());
    assert_eq!(context.settings.sort_by, "priority");
    assert_eq!(context.settings.view_filter, "todo");
}

#[test]
fn update_planning_settings_persists_filter_sort_and_selection() {
    let test_dir = TestDir::new("planning-settings-update");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let params = json!({
        "viewFilter": "blocked",
        "sortBy": "name",
        "selectedProjectId": "proj-2"
    });
    let request = parse_planning_settings_update(&params).expect("settings update should parse");
    let context =
        update_planning_settings(&db_path, &request).expect("settings update should succeed");

    assert_eq!(context.settings.view_filter, "blocked");
    assert_eq!(context.settings.sort_by, "name");
    assert_eq!(
        context.settings.selected_project_id.as_deref(),
        Some("proj-2")
    );
    assert_eq!(context.settings.selected_task_id.as_deref(), Some("task-3"));
    assert_eq!(
        context
            .selected_project
            .as_ref()
            .map(|project| project.title.as_str()),
        Some("Studio Launch")
    );
    assert_eq!(
        context.selected_task.as_ref().map(|task| task.id.as_str()),
        Some("task-3")
    );
}

#[test]
fn read_planning_time_report_matches_legacy_report_shape() {
    let test_dir = TestDir::new("planning-time-report");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    let report = read_planning_time_report(&db_path, None).expect("time report should load");

    let expected_total = snapshot
        .tasks
        .iter()
        .map(|task| task.total_seconds)
        .sum::<i64>();
    assert_eq!(report.total_seconds, expected_total);
    assert_eq!(report.by_project.len(), 2);
    assert_eq!(report.by_project[0].project_id, "proj-2");
    assert_eq!(report.by_project[0].title, "Studio Launch");
    assert_eq!(report.by_project[0].task_count, 1);
    assert_eq!(
        report.by_task.len(),
        snapshot
            .tasks
            .iter()
            .filter(|task| task.total_seconds > 0)
            .count()
    );
    assert_eq!(report.by_task[0].task_id, "task-3");
    assert_eq!(report.by_task[0].project_title, "Studio Launch");
    assert!(report
        .by_task
        .iter()
        .any(|task| task.task_title == "Finalize copy"));
    assert!(report.by_task[0].total_seconds >= report.by_task[1].total_seconds);
    assert_eq!(
        report.timer_events.len(),
        snapshot
            .activity_log
            .iter()
            .filter(|entry| matches!(entry.action.as_str(), "timer_started" | "timer_stopped"))
            .count()
            .min(100)
    );
    assert!(report
        .timer_events
        .iter()
        .all(|entry| matches!(entry.action.as_str(), "timer_started" | "timer_stopped")));

    let filtered =
        read_planning_time_report(&db_path, Some("proj-1")).expect("filtered report should load");
    assert_eq!(
        filtered.total_seconds,
        snapshot
            .tasks
            .iter()
            .filter(|task| task.project_id == "proj-1")
            .map(|task| task.total_seconds)
            .sum::<i64>()
    );
    assert_eq!(filtered.by_project.len(), 1);
    assert_eq!(filtered.by_project[0].project_id, "proj-1");
    assert!(filtered
        .by_task
        .iter()
        .all(|task| task.project_id == "proj-1"));
}

#[test]
fn planning_select_supports_task_lookup_and_project_cycling() {
    let test_dir = TestDir::new("planning-select");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let select_task = parse_planning_selection_request(&json!({
        "taskId": "task-3"
    }))
    .expect("task selection should parse");
    let selected_context =
        apply_planning_selection(&db_path, &select_task).expect("task selection should work");

    assert_eq!(
        selected_context.settings.selected_project_id.as_deref(),
        Some("proj-2")
    );
    assert_eq!(
        selected_context.settings.selected_task_id.as_deref(),
        Some("task-3")
    );

    let cycle_project = parse_planning_selection_request(&json!({
        "projectDirection": "prev"
    }))
    .expect("project cycle should parse");
    let cycled_context =
        apply_planning_selection(&db_path, &cycle_project).expect("project cycling should work");

    assert_eq!(
        cycled_context.settings.selected_project_id.as_deref(),
        Some("proj-1")
    );
    assert_eq!(
        cycled_context.settings.selected_task_id.as_deref(),
        Some("task-1")
    );
    assert_eq!(cycled_context.task_count, 2);
}

#[test]
fn planning_task_timer_starts_and_stops_with_activity_entries() {
    let test_dir = TestDir::new("planning-task-timer");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let start_request = parse_planning_task_timer_request(&json!({
        "taskId": "task-1",
        "action": "start"
    }))
    .expect("timer request should parse");
    let started = apply_planning_task_timer(&db_path, &start_request).expect("timer should start");

    assert_eq!(started.resolved_action, "start");
    assert!(started.task.is_running);
    assert!(started.task.last_started.is_some());
    assert_eq!(
        started
            .context
            .running_task
            .as_ref()
            .map(|task| task.id.as_str()),
        Some("task-1")
    );

    let stop_request = parse_planning_task_timer_request(&json!({
        "taskId": "task-1",
        "action": "toggle"
    }))
    .expect("timer request should parse");
    let stopped = apply_planning_task_timer(&db_path, &stop_request).expect("timer should stop");

    assert_eq!(stopped.resolved_action, "stop");
    assert!(!stopped.task.is_running);
    assert!(stopped.task.last_started.is_none());
    assert!(stopped.task.total_seconds >= 120);

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    assert_eq!(snapshot.activity_log[0].action, "timer_stopped");
    assert_eq!(snapshot.activity_log[1].action, "timer_started");
}

#[test]
fn planning_task_toggle_complete_flips_completion_and_logs_activity() {
    let test_dir = TestDir::new("planning-task-complete");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let toggle_request = parse_planning_task_toggle_complete_request(&json!({
        "taskId": "task-2"
    }))
    .expect("toggle request should parse");
    let toggled = apply_planning_task_toggle_complete(&db_path, &toggle_request)
        .expect("task completion should toggle");

    assert!(toggled.task.completed);
    assert_eq!(toggled.task.id, "task-2");

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.id == "task-2")
        .expect("task should exist");
    assert!(task.completed);
    assert_eq!(snapshot.activity_log[0].action, "completed");
}

#[test]
fn planning_project_create_selects_new_project_and_logs_activity() {
    let test_dir = TestDir::new("planning-project-create");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let request = parse_planning_project_create_request(&json!({
        "title": "Native Planning Lane",
        "priority": "p0",
        "status": "blocked"
    }))
    .expect("project create should parse");
    let created =
        apply_planning_project_create(&db_path, &request).expect("project create should work");

    assert_eq!(created.project.title, "Native Planning Lane");
    assert_eq!(created.project.status, "blocked");
    assert_eq!(
        created.context.settings.selected_project_id.as_deref(),
        Some(created.project.id.as_str())
    );
    assert_eq!(created.context.settings.selected_task_id, None);

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    assert_eq!(snapshot.counts.project_count, 3);
    assert_eq!(snapshot.activity_log[0].action, "created");
    assert_eq!(snapshot.activity_log[0].entity_type, "project");
}

#[test]
fn planning_project_update_reorder_and_delete_keep_selection_consistent() {
    let test_dir = TestDir::new("planning-project-mutations");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let update_request = parse_planning_project_update_request(&json!({
        "projectId": "proj-2",
        "title": "Studio Launch Revised",
        "priority": "p1"
    }))
    .expect("project update should parse");
    let updated =
        apply_planning_project_update(&db_path, &update_request).expect("update should work");
    assert_eq!(updated.project.title, "Studio Launch Revised");
    assert_eq!(updated.project.priority, "p1");

    let reorder_request = parse_planning_project_reorder_request(&json!({
        "projectId": "proj-2",
        "newStatus": "done",
        "newIndex": 0
    }))
    .expect("project reorder should parse");
    let reordered =
        apply_planning_project_reorder(&db_path, &reorder_request).expect("reorder should work");
    assert_eq!(reordered.project.status, "done");

    let delete_request = parse_planning_project_delete_request(&json!({
        "projectId": "proj-1"
    }))
    .expect("project delete should parse");
    let deleted =
        apply_planning_project_delete(&db_path, &delete_request).expect("delete should work");
    assert!(deleted.deleted);
    assert_eq!(
        deleted.context.settings.selected_project_id.as_deref(),
        Some("proj-2")
    );
    assert_eq!(
        deleted.context.settings.selected_task_id.as_deref(),
        Some("task-3")
    );

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    assert_eq!(snapshot.counts.project_count, 1);
    assert_eq!(snapshot.projects[0].id, "proj-2");
    assert_eq!(snapshot.activity_log[0].action, "deleted");
}

#[test]
fn planning_task_create_update_and_delete_keep_selection_consistent() {
    let test_dir = TestDir::new("planning-task-mutations");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let create_request = parse_planning_task_create_request(&json!({
        "projectId": "proj-1",
        "title": "Ship native shell controls",
        "priority": "p0",
        "labels": ["native", "ui"]
    }))
    .expect("task create should parse");
    let created =
        apply_planning_task_create(&db_path, &create_request).expect("task create should work");
    assert_eq!(created.task.project_id, "proj-1");
    assert_eq!(
        created.context.settings.selected_task_id.as_deref(),
        Some(created.task.id.as_str())
    );

    let update_request = parse_planning_task_update_request(&json!({
        "taskId": created.task.id,
        "description": "Wire shell actions to engine commands",
        "dueDate": "2026-04-30",
        "completed": true,
        "order": 0
    }))
    .expect("task update should parse");
    let updated =
        apply_planning_task_update(&db_path, &update_request).expect("task update should work");
    assert_eq!(
        updated.task.description,
        "Wire shell actions to engine commands"
    );
    assert_eq!(updated.task.due_date.as_deref(), Some("2026-04-30"));
    assert!(updated.task.completed);
    assert_eq!(updated.task.order, 0);

    let delete_request = parse_planning_task_delete_request(&json!({
        "taskId": updated.task.id
    }))
    .expect("task delete should parse");
    let deleted =
        apply_planning_task_delete(&db_path, &delete_request).expect("task delete should work");
    assert!(deleted.deleted);
    assert_eq!(
        deleted.context.settings.selected_project_id.as_deref(),
        Some("proj-1")
    );
    assert_eq!(
        deleted.context.settings.selected_task_id.as_deref(),
        Some("task-1")
    );

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    assert_eq!(snapshot.counts.task_count, 3);
    assert_eq!(snapshot.activity_log[0].action, "deleted");
    assert_eq!(snapshot.activity_log[1].action, "updated");
    assert_eq!(snapshot.activity_log[2].action, "created");
}

#[test]
fn planning_task_checklist_add_update_and_delete_round_trip() {
    let test_dir = TestDir::new("planning-task-checklist");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let add_request = parse_planning_task_checklist_add_request(&json!({
        "taskId": "task-2",
        "text": "Review final copy"
    }))
    .expect("checklist add should parse");
    let added = apply_planning_task_checklist_add(&db_path, &add_request)
        .expect("checklist add should work");
    assert_eq!(added.task.id, "task-2");
    assert_eq!(added.task.checklist.len(), 1);
    let checklist_item_id = added.task.checklist[0].id.clone();

    let update_request = parse_planning_task_checklist_update_request(&json!({
        "taskId": "task-2",
        "itemId": checklist_item_id,
        "done": true
    }))
    .expect("checklist update should parse");
    let updated = apply_planning_task_checklist_update(&db_path, &update_request)
        .expect("checklist update should work");
    assert!(updated.task.checklist[0].done);

    let delete_request = parse_planning_task_checklist_delete_request(&json!({
        "taskId": "task-2",
        "itemId": checklist_item_id
    }))
    .expect("checklist delete should parse");
    let deleted = apply_planning_task_checklist_delete(&db_path, &delete_request)
        .expect("checklist delete should work");
    assert!(deleted.task.checklist.is_empty());

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.id == "task-2")
        .expect("task should exist");
    assert!(task.checklist.is_empty());
    assert_eq!(snapshot.activity_log[0].action, "checklist_removed");
    assert_eq!(snapshot.activity_log[1].action, "checklist_updated");
    assert_eq!(snapshot.activity_log[2].action, "checklist_added");
}

#[test]
fn planning_task_reschedule_persists_both_fields() {
    let test_dir = TestDir::new("planning-task-reschedule-set");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let request = parse_planning_task_reschedule_request(&json!({
        "taskId": "task-1",
        "scheduledStart": "2026-04-21T19:30:00Z",
        "scheduledDurationSeconds": 1800
    }))
    .expect("reschedule should parse");
    let result =
        apply_planning_task_reschedule(&db_path, &request).expect("reschedule should apply");

    assert_eq!(
        result.task.scheduled_start.as_deref(),
        Some("2026-04-21T19:30:00Z")
    );
    assert_eq!(result.task.scheduled_duration_seconds, Some(1800));

    let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
        .expect("planning settings should load");
    let snapshot =
        read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
    assert_eq!(snapshot.activity_log[0].action, "rescheduled");
}

#[test]
fn planning_task_reschedule_clears_both_fields() {
    let test_dir = TestDir::new("planning-task-reschedule-clear");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let set = parse_planning_task_reschedule_request(&json!({
        "taskId": "task-1",
        "scheduledStart": "2026-04-21T19:30:00Z",
        "scheduledDurationSeconds": 1800
    }))
    .expect("reschedule should parse");
    apply_planning_task_reschedule(&db_path, &set).expect("initial set should apply");

    let clear = parse_planning_task_reschedule_request(&json!({
        "taskId": "task-1",
        "scheduledStart": Value::Null,
        "scheduledDurationSeconds": Value::Null
    }))
    .expect("clear should parse");
    let cleared = apply_planning_task_reschedule(&db_path, &clear).expect("clear should apply");

    assert!(cleared.task.scheduled_start.is_none());
    assert!(cleared.task.scheduled_duration_seconds.is_none());
}

#[test]
fn planning_task_reschedule_leaves_unspecified_fields_untouched() {
    let test_dir = TestDir::new("planning-task-reschedule-partial");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    seed_planning_state(&db_path, &source_path);

    let set = parse_planning_task_reschedule_request(&json!({
        "taskId": "task-1",
        "scheduledStart": "2026-04-21T19:30:00Z",
        "scheduledDurationSeconds": 1800
    }))
    .expect("reschedule should parse");
    apply_planning_task_reschedule(&db_path, &set).expect("initial set should apply");

    let partial = parse_planning_task_reschedule_request(&json!({
        "taskId": "task-1",
        "scheduledStart": "2026-04-21T20:00:00Z"
    }))
    .expect("partial reschedule should parse");
    let updated = apply_planning_task_reschedule(&db_path, &partial)
        .expect("partial reschedule should apply");

    assert_eq!(
        updated.task.scheduled_start.as_deref(),
        Some("2026-04-21T20:00:00Z")
    );
    assert_eq!(updated.task.scheduled_duration_seconds, Some(1800));
}
