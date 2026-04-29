use crate::lighting::{LightingFixtureSnapshot, LightingGroupSnapshot, LightingSceneSnapshot};

pub struct LightingBackendConfig {
    pub enabled: bool,
    pub bridge_ip: String,
    pub universe: i64,
}

pub struct LightingBackendInventory {
    pub adapter_mode: String,
    pub fixtures: Vec<LightingFixtureSnapshot>,
    pub groups: Vec<LightingGroupSnapshot>,
    pub scenes: Vec<LightingSceneSnapshot>,
}

#[derive(Debug)]
pub struct LightingSceneRecallOutcome {
    #[allow(dead_code)]
    pub summary: String,
    pub fixture_updates: Vec<LightingFixtureStateUpdate>,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureStateUpdate {
    pub fixture_id: String,
    pub on: bool,
    pub intensity: i64,
}

pub trait LightingBackend {
    fn read_inventory(&self, config: &LightingBackendConfig) -> LightingBackendInventory;
    fn recall_scene(
        &self,
        config: &LightingBackendConfig,
        inventory: &LightingBackendInventory,
        scene_id: &str,
        fade_duration_seconds: f64,
    ) -> Result<LightingSceneRecallOutcome, String>;
}

pub struct SimulatedLightingBackend;

impl LightingBackend for SimulatedLightingBackend {
    fn read_inventory(&self, config: &LightingBackendConfig) -> LightingBackendInventory {
        if !config.enabled || config.bridge_ip.trim().is_empty() || config.universe <= 0 {
            return LightingBackendInventory {
                adapter_mode: String::from("simulated"),
                fixtures: Vec::new(),
                groups: Vec::new(),
                scenes: Vec::new(),
            };
        }

        LightingBackendInventory {
            adapter_mode: String::from("simulated"),
            fixtures: vec![
                LightingFixtureSnapshot {
                    id: String::from("fixture-key-left"),
                    name: String::from("Key Left"),
                    fixture_type: String::from("astra-bicolor"),
                    dmx_start_address: 1,
                    kind: String::from("profile"),
                    group_id: Some(String::from("group-stage")),
                    spatial_x: Some(0.3),
                    spatial_y: Some(0.25),
                    spatial_rotation: 180.0,
                    rig_z: None,
                    beam_angle_degrees: None,
                    on: false,
                    intensity: 100,
                    cct: 4500,
                    effect: None,
                },
                LightingFixtureSnapshot {
                    id: String::from("fixture-key-right"),
                    name: String::from("Key Right"),
                    fixture_type: String::from("astra-bicolor"),
                    dmx_start_address: 3,
                    kind: String::from("profile"),
                    group_id: Some(String::from("group-stage")),
                    spatial_x: Some(0.7),
                    spatial_y: Some(0.25),
                    spatial_rotation: 180.0,
                    rig_z: None,
                    beam_angle_degrees: None,
                    on: false,
                    intensity: 100,
                    cct: 4500,
                    effect: None,
                },
                LightingFixtureSnapshot {
                    id: String::from("fixture-backline-wash"),
                    name: String::from("Backline Wash"),
                    fixture_type: String::from("infinimat"),
                    dmx_start_address: 5,
                    kind: String::from("wash"),
                    group_id: Some(String::from("group-stage")),
                    spatial_x: Some(0.5),
                    spatial_y: Some(0.15),
                    spatial_rotation: 180.0,
                    rig_z: None,
                    beam_angle_degrees: None,
                    on: false,
                    intensity: 100,
                    cct: 4500,
                    effect: None,
                },
                LightingFixtureSnapshot {
                    id: String::from("fixture-house-practicals"),
                    name: String::from("House Practicals"),
                    fixture_type: String::from("infinibar-pb12"),
                    dmx_start_address: 9,
                    kind: String::from("practical"),
                    group_id: Some(String::from("group-room")),
                    spatial_x: Some(0.5),
                    spatial_y: Some(0.85),
                    spatial_rotation: 0.0,
                    rig_z: None,
                    beam_angle_degrees: None,
                    on: false,
                    intensity: 100,
                    cct: 3200,
                    effect: None,
                },
            ],
            groups: vec![
                LightingGroupSnapshot {
                    id: String::from("group-stage"),
                    name: String::from("Stage"),
                    fixture_count: 3,
                },
                LightingGroupSnapshot {
                    id: String::from("group-room"),
                    name: String::from("Room"),
                    fixture_count: 1,
                },
            ],
            scenes: vec![
                LightingSceneSnapshot {
                    id: String::from("scene-prep"),
                    name: String::from("Prep"),
                    fixture_count: 0,
                    fixture_states: Vec::new(),
                    last_recalled: false,
                    last_recalled_at: None,
                    pinned: false,
                },
                LightingSceneSnapshot {
                    id: String::from("scene-teaching"),
                    name: String::from("Teaching"),
                    fixture_count: 0,
                    fixture_states: Vec::new(),
                    last_recalled: false,
                    last_recalled_at: None,
                    pinned: false,
                },
                LightingSceneSnapshot {
                    id: String::from("scene-stream"),
                    name: String::from("Stream"),
                    fixture_count: 0,
                    fixture_states: Vec::new(),
                    last_recalled: false,
                    last_recalled_at: None,
                    pinned: false,
                },
            ],
        }
    }

    fn recall_scene(
        &self,
        config: &LightingBackendConfig,
        inventory: &LightingBackendInventory,
        scene_id: &str,
        fade_duration_seconds: f64,
    ) -> Result<LightingSceneRecallOutcome, String> {
        if !config.enabled || config.bridge_ip.trim().is_empty() || config.universe <= 0 {
            return Err(String::from("Lighting bridge transport is not configured."));
        }

        let scene = inventory
            .scenes
            .iter()
            .find(|entry| entry.id == scene_id)
            .ok_or_else(|| format!("Lighting scene '{scene_id}' is not exposed by the backend."))?;

        let mode = if fade_duration_seconds > 0.0 {
            format!("{}s simulated fade", fade_duration_seconds)
        } else {
            String::from("instant simulated recall")
        };
        let fixture_updates = match scene_id {
            "scene-prep" => vec![
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-key-left"),
                    on: false,
                    intensity: 35,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-key-right"),
                    on: false,
                    intensity: 35,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-backline-wash"),
                    on: true,
                    intensity: 25,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-house-practicals"),
                    on: true,
                    intensity: 40,
                },
            ],
            "scene-teaching" => vec![
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-key-left"),
                    on: true,
                    intensity: 80,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-key-right"),
                    on: true,
                    intensity: 80,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-backline-wash"),
                    on: true,
                    intensity: 55,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-house-practicals"),
                    on: false,
                    intensity: 15,
                },
            ],
            _ => vec![
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-key-left"),
                    on: true,
                    intensity: 90,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-key-right"),
                    on: true,
                    intensity: 90,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-backline-wash"),
                    on: true,
                    intensity: 35,
                },
                LightingFixtureStateUpdate {
                    fixture_id: String::from("fixture-house-practicals"),
                    on: true,
                    intensity: 15,
                },
            ],
        };

        Ok(LightingSceneRecallOutcome {
            summary: format!(
                "Simulated lighting scene '{}' was recalled via {} on {} universe {}.",
                scene.name, mode, config.bridge_ip, config.universe
            ),
            fixture_updates,
        })
    }
}

pub fn read_default_lighting_inventory(config: &LightingBackendConfig) -> LightingBackendInventory {
    SimulatedLightingBackend.read_inventory(config)
}

pub fn recall_default_lighting_scene(
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
    scene_id: &str,
    fade_duration_seconds: f64,
) -> Result<LightingSceneRecallOutcome, String> {
    SimulatedLightingBackend.recall_scene(config, inventory, scene_id, fade_duration_seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulated_lighting_backend_returns_empty_inventory_when_disabled() {
        let inventory = read_default_lighting_inventory(&LightingBackendConfig {
            enabled: false,
            bridge_ip: String::new(),
            universe: 1,
        });

        assert_eq!(inventory.adapter_mode, "simulated");
        assert!(inventory.fixtures.is_empty());
        assert!(inventory.groups.is_empty());
        assert!(inventory.scenes.is_empty());
    }

    #[test]
    fn simulated_lighting_backend_returns_inventory_when_configured() {
        let inventory = read_default_lighting_inventory(&LightingBackendConfig {
            enabled: true,
            bridge_ip: String::from("2.0.0.10"),
            universe: 1,
        });

        assert_eq!(inventory.adapter_mode, "simulated");
        assert_eq!(inventory.fixtures.len(), 4);
        assert_eq!(inventory.groups.len(), 2);
        assert_eq!(inventory.scenes.len(), 3);
    }

    #[test]
    fn simulated_lighting_backend_recalls_known_scene() {
        let config = LightingBackendConfig {
            enabled: true,
            bridge_ip: String::from("2.0.0.10"),
            universe: 1,
        };
        let inventory = read_default_lighting_inventory(&config);

        let outcome = recall_default_lighting_scene(&config, &inventory, "scene-prep", 0.0)
            .expect("known scene should recall");

        assert!(outcome.summary.contains("scene 'Prep'"));
    }

    #[test]
    fn simulated_lighting_backend_rejects_unknown_scene() {
        let config = LightingBackendConfig {
            enabled: true,
            bridge_ip: String::from("2.0.0.10"),
            universe: 1,
        };
        let inventory = read_default_lighting_inventory(&config);

        let error = recall_default_lighting_scene(&config, &inventory, "scene-missing", 0.0)
            .expect_err("unknown scene should fail");

        assert!(error.contains("scene-missing"));
    }
}
