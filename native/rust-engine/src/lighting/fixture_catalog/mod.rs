use std::collections::HashMap;

use serde::Serialize;

use super::DEFAULT_LIGHTING_FIXTURE_TYPE;

pub const DEFAULT_FIXTURE_DEFINITION_ID: &str = "litepanels-astra-bicolor";
const DEFAULT_MODE_ID: &str = "default";

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureCatalogSnapshot {
    pub definitions: Vec<LightingFixtureDefinitionSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureDefinitionSnapshot {
    pub id: String,
    pub manufacturer: String,
    pub family: String,
    pub model: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub status: String,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    #[serde(rename = "sourceVersion")]
    pub source_version: String,
    #[serde(rename = "sourceDate")]
    pub source_date: String,
    pub kind: String,
    #[serde(rename = "defaultModeId")]
    pub default_mode_id: String,
    pub modes: Vec<LightingFixtureModeSnapshot>,
    pub visual: LightingFixtureVisualSnapshot,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureModeSnapshot {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "channelCount")]
    pub channel_count: i64,
    pub resolution: String,
    pub capabilities: Vec<String>,
    pub channels: Vec<LightingFixtureChannelSnapshot>,
    pub controls: Vec<LightingFixtureControlSnapshot>,
    pub defaults: HashMap<String, i64>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureChannelSnapshot {
    pub offset: i64,
    pub label: String,
    #[serde(rename = "controlId")]
    pub control_id: String,
    #[serde(rename = "valueType")]
    pub value_type: String,
    #[serde(rename = "defaultDmx")]
    pub default_dmx: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ranges: Option<Vec<LightingFixtureChannelRangeSnapshot>>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureChannelRangeSnapshot {
    #[serde(rename = "dmxMin")]
    pub dmx_min: i64,
    #[serde(rename = "dmxMax")]
    pub dmx_max: i64,
    pub label: String,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureControlSnapshot {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(rename = "valueType")]
    pub value_type: String,
    pub min: i64,
    pub max: i64,
    pub step: i64,
    #[serde(rename = "defaultValue")]
    pub default_value: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<LightingFixtureControlOptionSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureControlOptionSnapshot {
    pub value: i64,
    pub label: String,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureVisualSnapshot {
    pub shape: String,
    #[serde(rename = "symbolKind")]
    pub symbol_kind: String,
    #[serde(rename = "symbolVariant")]
    pub symbol_variant: String,
    #[serde(rename = "widthMm")]
    pub width_mm: i64,
    #[serde(rename = "heightMm")]
    pub height_mm: i64,
    #[serde(rename = "depthMm")]
    pub depth_mm: i64,
    #[serde(rename = "beamAngleMin")]
    pub beam_angle_min: Option<f64>,
    #[serde(rename = "beamAngleMax")]
    pub beam_angle_max: Option<f64>,
    #[serde(rename = "fieldAngle")]
    pub field_angle: Option<f64>,
    #[serde(rename = "pixelLayout")]
    pub pixel_layout: Option<LightingFixturePixelLayoutSnapshot>,
    #[serde(rename = "emitterLayout")]
    pub emitter_layout: Option<LightingFixtureEmitterLayoutSnapshot>,
    pub output: LightingFixtureOutputSnapshot,
    #[serde(rename = "visualConfidence")]
    pub visual_confidence: String,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureEmitterLayoutSnapshot {
    #[serde(rename = "emitterKind")]
    pub emitter_kind: String,
    pub rows: i64,
    pub columns: i64,
    pub segments: i64,
    #[serde(rename = "physicalPixels")]
    pub physical_pixels: Option<i64>,
    pub direction: String,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixtureOutputSnapshot {
    #[serde(rename = "beamType")]
    pub beam_type: String,
    #[serde(rename = "beamAngle")]
    pub beam_angle: Option<f64>,
    #[serde(rename = "fieldAngle")]
    pub field_angle: Option<f64>,
    #[serde(rename = "photometricSamples")]
    pub photometric_samples: Vec<LightingFixturePhotometricSampleSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixturePhotometricSampleSnapshot {
    pub cct: i64,
    #[serde(rename = "distanceMeters")]
    pub distance_meters: f64,
    pub lux: f64,
    pub modifier: String,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingFixturePixelLayoutSnapshot {
    #[serde(rename = "pixelCount")]
    pub pixel_count: i64,
    pub rows: i64,
    pub columns: i64,
    pub segments: i64,
    pub order: String,
}

#[derive(Debug, Clone)]
pub(super) struct ResolvedFixtureProfile {
    pub definition_id: String,
    pub mode_id: String,
    pub kind: String,
    pub channel_count: i64,
    pub labels: Vec<String>,
    pub defaults: HashMap<String, i64>,
    pub capabilities: Vec<String>,
}

pub fn read_lighting_fixture_catalog_snapshot() -> LightingFixtureCatalogSnapshot {
    LightingFixtureCatalogSnapshot {
        definitions: catalog_definitions(),
    }
}

pub(super) fn catalog_definitions() -> Vec<LightingFixtureDefinitionSnapshot> {
    let mut definitions = Vec::new();
    definitions.extend(compatibility_definitions());
    definitions.extend(aputure_verified_definitions());
    definitions.extend(litepanels_verified_definitions());
    definitions.extend(research_needed_definitions());
    definitions
}

pub(super) fn resolve_fixture_profile(
    definition_id: Option<&str>,
    mode_id: Option<&str>,
    fixture_type: Option<&str>,
    legacy_kind: Option<&str>,
    fixture_id: &str,
) -> ResolvedFixtureProfile {
    let definition =
        resolve_fixture_definition(definition_id, fixture_type, legacy_kind, fixture_id);
    let mode = resolve_fixture_mode(&definition, mode_id);
    ResolvedFixtureProfile {
        definition_id: definition.id.clone(),
        mode_id: mode.id.clone(),
        kind: definition.kind.clone(),
        channel_count: mode.channel_count,
        labels: mode
            .channels
            .iter()
            .map(|channel| channel.label.clone())
            .collect(),
        defaults: mode.defaults.clone(),
        capabilities: mode.capabilities.clone(),
    }
}

pub(super) fn resolve_fixture_definition(
    definition_id: Option<&str>,
    fixture_type: Option<&str>,
    legacy_kind: Option<&str>,
    fixture_id: &str,
) -> LightingFixtureDefinitionSnapshot {
    let definitions = catalog_definitions();
    let requested_id = definition_id
        .and_then(normalized_catalog_id)
        .or_else(|| fixture_type.and_then(resolve_fixture_alias))
        .or_else(|| legacy_kind.and_then(resolve_fixture_alias))
        .or_else(|| infer_fixture_definition_from_legacy_kind(legacy_kind))
        .or_else(|| infer_fixture_definition_from_fixture_id(fixture_id))
        .unwrap_or_else(|| String::from(DEFAULT_FIXTURE_DEFINITION_ID));

    definitions
        .into_iter()
        .find(|definition| definition.id == requested_id)
        .unwrap_or_else(default_fixture_definition)
}

pub(super) fn resolve_fixture_mode(
    definition: &LightingFixtureDefinitionSnapshot,
    mode_id: Option<&str>,
) -> LightingFixtureModeSnapshot {
    let requested = mode_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(definition.default_mode_id.as_str());
    definition
        .modes
        .iter()
        .find(|mode| mode.id == requested)
        .or_else(|| {
            definition
                .modes
                .iter()
                .find(|mode| mode.id == definition.default_mode_id)
        })
        .or_else(|| definition.modes.first())
        .cloned()
        .unwrap_or_else(|| no_dmx_mode(DEFAULT_MODE_ID, "No DMX profile"))
}

pub(super) fn normalized_catalog_id(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    catalog_definitions()
        .iter()
        .find(|definition| definition.id == normalized)
        .map(|definition| definition.id.clone())
}

pub(super) fn resolve_fixture_alias(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    let cleaned = normalized.replace(['_', ' '], "-");
    match cleaned.as_str() {
        "astra" | "astra-bi-color" | "astra-bicolor" | "litepanels-astra" => {
            Some(String::from(DEFAULT_FIXTURE_DEFINITION_ID))
        }
        "apollo-bridge" | "litepanels-apollo" | "litepanels-apollo-bridge" => {
            Some(String::from("litepanels-apollo-bridge"))
        }
        "infinimat" | "aputure-infinimat" => Some(String::from("aputure-infinimat-generic")),
        "infinibar" | "infinibar-pb12" | "aputure-infinibar-pb12" => {
            Some(String::from("aputure-infinibar-pb12"))
        }
        _ => normalized_catalog_id(cleaned.as_str()),
    }
}

pub(super) fn fixture_type_for_definition(definition_id: &str) -> String {
    match definition_id {
        DEFAULT_FIXTURE_DEFINITION_ID => String::from(DEFAULT_LIGHTING_FIXTURE_TYPE),
        "aputure-infinimat-generic" => String::from("infinimat"),
        "aputure-infinibar-pb12" => String::from("infinibar-pb12"),
        "litepanels-apollo-bridge" => String::from("Apollo Bridge"),
        other => String::from(other),
    }
}

pub(super) fn fixture_default_cct(profile: &ResolvedFixtureProfile) -> i64 {
    profile.defaults.get("cct").copied().unwrap_or(
        if profile.capabilities.iter().any(|value| value == "cct") {
            5600
        } else {
            0
        },
    )
}

pub(super) fn fixture_cct_range_from_profile(profile: &ResolvedFixtureProfile) -> (i64, i64) {
    let min = profile.defaults.get("cctMin").copied().unwrap_or(3200);
    let max = profile.defaults.get("cctMax").copied().unwrap_or(5600);
    (min, max)
}

fn infer_fixture_definition_from_legacy_kind(value: Option<&str>) -> Option<String> {
    match value.unwrap_or_default() {
        "profile" => Some(String::from(DEFAULT_FIXTURE_DEFINITION_ID)),
        "wash" => Some(String::from("aputure-infinimat-generic")),
        "practical" => Some(String::from("aputure-infinibar-pb12")),
        "control-node" => Some(String::from("litepanels-apollo-bridge")),
        _ => None,
    }
}

fn infer_fixture_definition_from_fixture_id(fixture_id: &str) -> Option<String> {
    if fixture_id.contains("wash") {
        Some(String::from("aputure-infinimat-generic"))
    } else if fixture_id.contains("practical") || fixture_id.contains("house") {
        Some(String::from("aputure-infinibar-pb12"))
    } else if fixture_id.contains("apollo") || fixture_id.contains("bridge") {
        Some(String::from("litepanels-apollo-bridge"))
    } else if fixture_id.contains("key") {
        Some(String::from(DEFAULT_FIXTURE_DEFINITION_ID))
    } else {
        None
    }
}

fn default_fixture_definition() -> LightingFixtureDefinitionSnapshot {
    compatibility_definitions()
        .into_iter()
        .find(|definition| definition.id == DEFAULT_FIXTURE_DEFINITION_ID)
        .expect("default fixture definition should exist")
}

struct DefinitionSpec<'a> {
    id: &'a str,
    manufacturer: &'a str,
    family: &'a str,
    model: &'a str,
    display_name: &'a str,
    status: &'a str,
    source_url: &'a str,
    source_version: &'a str,
    source_date: &'a str,
    kind: &'a str,
    default_mode_id: &'a str,
}

struct VisualSpec<'a> {
    shape: &'a str,
    width_mm: i64,
    height_mm: i64,
    depth_mm: i64,
    beam_angle_min: Option<f64>,
    beam_angle_max: Option<f64>,
    field_angle: Option<f64>,
    pixel_layout: Option<LightingFixturePixelLayoutSnapshot>,
}

macro_rules! definition {
    (
        $id:expr,
        $manufacturer:expr,
        $family:expr,
        $model:expr,
        $display_name:expr,
        $status:expr,
        $source_url:expr,
        $source_version:expr,
        $source_date:expr,
        $kind:expr,
        $default_mode_id:expr,
        $modes:expr,
        $visual:expr $(,)?
    ) => {
        build_definition(
            DefinitionSpec {
                id: $id,
                manufacturer: $manufacturer,
                family: $family,
                model: $model,
                display_name: $display_name,
                status: $status,
                source_url: $source_url,
                source_version: $source_version,
                source_date: $source_date,
                kind: $kind,
                default_mode_id: $default_mode_id,
            },
            $modes,
            $visual,
        )
    };
}

macro_rules! visual {
    (
        $shape:expr,
        $width_mm:expr,
        $height_mm:expr,
        $depth_mm:expr,
        $beam_angle_min:expr,
        $beam_angle_max:expr,
        $field_angle:expr,
        $pixel_layout:expr $(,)?
    ) => {
        build_visual(VisualSpec {
            shape: $shape,
            width_mm: $width_mm,
            height_mm: $height_mm,
            depth_mm: $depth_mm,
            beam_angle_min: $beam_angle_min,
            beam_angle_max: $beam_angle_max,
            field_angle: $field_angle,
            pixel_layout: $pixel_layout,
        })
    };
}

fn compatibility_definitions() -> Vec<LightingFixtureDefinitionSnapshot> {
    vec![
        definition!(
            DEFAULT_FIXTURE_DEFINITION_ID,
            "Litepanels",
            "Astra",
            "Astra Bi-Color",
            "Astra Bi-Color",
            "verified",
            "https://www.litepanels.com/en/products/astra/",
            "Astra product page",
            "2026-05-03",
            "profile",
            DEFAULT_MODE_ID,
            vec![mode(
                DEFAULT_MODE_ID,
                "2 ch Dimmer + CCT",
                "8-bit",
                vec!["intensity", "cct"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 68),
                ],
                vec![
                    slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                    slider("cct", "CCT", 3200, 5600, 100, 4400, Some("K")),
                ],
                defaults(&[
                    ("intensity", 100),
                    ("cct", 4400),
                    ("cctMin", 3200),
                    ("cctMax", 5600),
                ]),
            )],
            visual!("panel", 450, 300, 90, Some(50.0), Some(50.0), None, None),
        ),
        definition!(
            "aputure-infinimat-generic",
            "Aputure",
            "INFINIMAT",
            "Generic mat profile",
            "INFINIMAT generic",
            "verified",
            "https://help.aputure.com/en/infinimat/operating-instructions",
            "INFINIMAT DMX settings",
            "2026-05-03",
            "wash",
            DEFAULT_MODE_ID,
            vec![
                mode(
                    DEFAULT_MODE_ID,
                    "4 ch Dimmer + CCT + Green/Magenta + Strobe",
                    "8-bit",
                    vec!["intensity", "cct", "green-magenta", "strobe"],
                    vec![
                        ch(1, "Dimmer", "intensity", "percent", 0),
                        ch(2, "CCT", "cct", "kelvin", 102),
                        ch(3, "+/- G/M", "green-magenta", "offset", 127),
                        ch(4, "Strobe", "strobe", "range", 0),
                    ],
                    vec![
                        slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                        slider("cct", "CCT", 2000, 10000, 100, 5600, Some("K")),
                        slider("green-magenta", "Green/Magenta", -100, 100, 1, 0, None),
                        slider("strobe", "Strobe", 0, 255, 1, 0, None),
                    ],
                    defaults(&[
                        ("intensity", 100),
                        ("cct", 5600),
                        ("cctMin", 2000),
                        ("cctMax", 10000),
                        ("green-magenta", 0),
                        ("strobe", 0),
                    ]),
                ),
                mode(
                    "le-1x4-rgbww-8bit",
                    "1x4 light-engine RGBWW 20 ch",
                    "8-bit",
                    vec!["intensity", "cct", "rgb", "pixel"],
                    repeated_pixel_channels(4, &["Dimmer", "CCT", "Red", "Green", "Blue"]),
                    vec![
                        slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                        slider("cct", "CCT", 2000, 10000, 100, 5600, Some("K")),
                        slider("red", "Red", 0, 255, 1, 0, None),
                        slider("green", "Green", 0, 255, 1, 0, None),
                        slider("blue", "Blue", 0, 255, 1, 0, None),
                    ],
                    defaults(&[
                        ("intensity", 100),
                        ("cct", 5600),
                        ("cctMin", 2000),
                        ("cctMax", 10000),
                    ]),
                ),
            ],
            visual!(
                "mat",
                1220,
                305,
                80,
                Some(100.0),
                Some(100.0),
                None,
                Some(pixel_layout(4, 1, 4, 4, "row-major")),
            ),
        ),
        definition!(
            "aputure-infinibar-pb12",
            "Aputure",
            "INFINIBAR",
            "PB12",
            "INFINIBAR PB12",
            "verified",
            "https://help.aputure.com/en/infinibar/dmx-profiles-settings",
            "INFINIBAR DMX Profiles v1.0",
            "2026-05-03",
            "practical",
            DEFAULT_MODE_ID,
            vec![
                mode(
                    DEFAULT_MODE_ID,
                    "8 ch basic RGBWW",
                    "8-bit",
                    vec!["intensity", "cct", "rgb", "fx"],
                    vec![
                        ch(1, "Dimmer", "intensity", "percent", 0),
                        ch(2, "CCT", "cct", "kelvin", 102),
                        ch(3, "Mix", "mix", "percent", 0),
                        ch(4, "Red", "red", "percent", 0),
                        ch(5, "Green", "green", "percent", 0),
                        ch(6, "Blue", "blue", "percent", 0),
                        ch(7, "FX", "fx", "range", 0),
                        ch(8, "Speed", "speed", "range", 0),
                    ],
                    vec![
                        slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                        slider("cct", "CCT", 2000, 10000, 100, 5600, Some("K")),
                        slider("red", "Red", 0, 255, 1, 0, None),
                        slider("green", "Green", 0, 255, 1, 0, None),
                        slider("blue", "Blue", 0, 255, 1, 0, None),
                        slider("fx", "FX", 0, 255, 1, 0, None),
                        slider("speed", "Speed", 0, 255, 1, 0, None),
                    ],
                    defaults(&[
                        ("intensity", 100),
                        ("cct", 5600),
                        ("cctMin", 2000),
                        ("cctMax", 10000),
                    ]),
                ),
                mode(
                    "pixel-rgb-48",
                    "48 px RGB pixel map 144 ch",
                    "8-bit",
                    vec!["rgb", "pixel"],
                    repeated_pixel_channels(48, &["Red", "Green", "Blue"]),
                    vec![
                        slider("red", "Red", 0, 255, 1, 0, None),
                        slider("green", "Green", 0, 255, 1, 0, None),
                        slider("blue", "Blue", 0, 255, 1, 0, None),
                    ],
                    defaults(&[("red", 0), ("green", 0), ("blue", 0)]),
                ),
            ],
            visual!(
                "bar",
                1200,
                45,
                45,
                Some(120.0),
                Some(120.0),
                None,
                Some(pixel_layout(48, 1, 48, 48, "left-to-right")),
            ),
        ),
        definition!(
            "litepanels-apollo-bridge",
            "Litepanels",
            "Apollo",
            "Apollo Bridge",
            "Apollo Bridge",
            "verified",
            "https://www.litepanels.com/en/products/apollo/",
            "Apollo product page",
            "2026-05-03",
            "control-node",
            DEFAULT_MODE_ID,
            vec![no_dmx_mode(DEFAULT_MODE_ID, "Control node")],
            visual!("control-node", 180, 120, 40, None, None, None, None),
        ),
    ]
}

fn aputure_verified_definitions() -> Vec<LightingFixtureDefinitionSnapshot> {
    vec![
        definition!(
            "aputure-ls-600d-pro",
            "Aputure",
            "Light Storm",
            "LS 600d Pro",
            "LS 600d Pro",
            "verified",
            "https://help.aputure.com/en/ls600d-pro/controlling-device-via-dmx",
            "5 DMX Channels",
            "2026-05-03",
            "beam",
            "5ch-fx",
            vec![mode(
                "5ch-fx",
                "5 ch Dimmer + FX",
                "8-bit",
                vec!["intensity", "fx"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ranged_ch(
                        2,
                        "Mode Selection",
                        "mode",
                        "range",
                        0,
                        &[("Manual", 0, 127), ("FX", 128, 255)],
                    ),
                    ranged_ch(
                        3,
                        "FX Control",
                        "fx",
                        "range",
                        0,
                        &[
                            ("Paparazzi", 0, 19),
                            ("Fireworks", 20, 39),
                            ("Lightning", 60, 79),
                            ("Strobe", 120, 139),
                        ],
                    ),
                    ch(4, "FX Frequency", "speed", "range", 0),
                    ch(5, "FX Trigger", "trigger", "range", 0),
                ],
                vec![
                    slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                    slider("fx", "FX", 0, 255, 1, 0, None),
                    slider("speed", "Speed", 0, 255, 1, 0, None),
                ],
                defaults(&[
                    ("intensity", 100),
                    ("cct", 5600),
                    ("cctMin", 5600),
                    ("cctMax", 5600),
                ]),
            )],
            visual!("fresnel", 335, 338, 557, Some(15.0), Some(60.0), None, None),
        ),
        storm_80c_definition(),
        storm_1200x_definition(),
    ]
}

fn storm_80c_definition() -> LightingFixtureDefinitionSnapshot {
    definition!(
        "aputure-storm-80c",
        "Aputure",
        "STORM",
        "80c",
        "STORM 80c",
        "verified",
        "https://docs.aputure.com/hubfs/Knowledge%20Base/Aputure/STORM%2080c/manuals/STORM%201000c%20%26%2080c%20DMX%20Profile%20Specification%20V1.0.pdf",
        "STORM 1000c & 80c DMX Profile Specification V1.2",
        "2025-05-30",
        "beam",
        "cct-rgb-8bit-7ch",
        vec![
            mode(
                "cct-rgb-8bit-7ch",
                "CCT & RGB 8-bit 7 ch",
                "8-bit",
                vec!["intensity", "cct", "rgb", "green-magenta"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 49),
                    ch(3, "+/- Green", "green-magenta", "offset", 127),
                    ch(4, "Red", "red", "percent", 0),
                    ch(5, "Green", "green", "percent", 0),
                    ch(6, "Blue", "blue", "percent", 0),
                    ch(7, "Color Crossfade", "mix", "percent", 0),
                ],
                vec![
                    slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                    slider("cct", "CCT", 1800, 20000, 100, 5600, Some("K")),
                    slider("green-magenta", "Green/Magenta", -100, 100, 1, 0, None),
                    slider("red", "Red", 0, 255, 1, 0, None),
                    slider("green", "Green", 0, 255, 1, 0, None),
                    slider("blue", "Blue", 0, 255, 1, 0, None),
                ],
                defaults(&[("intensity", 100), ("cct", 5600), ("cctMin", 1800), ("cctMax", 20000)]),
            ),
            mode(
                "hsic-control-16bit-13ch",
                "Limited HSIC+ Control 16-bit 13 ch",
                "16-bit",
                vec!["intensity", "hsi", "cct", "green-magenta", "control"],
                vec![
                    ch(1, "Dimmer coarse", "intensity", "percent", 0),
                    ch(2, "Dimmer fine", "intensity", "fine", 0),
                    ch(3, "Hue coarse", "hue", "degrees", 0),
                    ch(4, "Hue fine", "hue", "fine", 0),
                    ch(5, "Saturation coarse", "saturation", "percent", 0),
                    ch(6, "Saturation fine", "saturation", "fine", 0),
                    ch(7, "CCT coarse", "cct", "kelvin", 49),
                    ch(8, "CCT fine", "cct", "fine", 0),
                    ch(9, "+/- Green coarse", "green-magenta", "offset", 127),
                    ch(10, "+/- Green fine", "green-magenta", "fine", 0),
                    ch(11, "Control", "control", "range", 0),
                    ch(12, "Fan", "fan", "range", 0),
                    ch(13, "Dimming Curve", "dimming-curve", "range", 0),
                ],
                vec![
                    slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                    slider("hue", "Hue", 0, 359, 1, 0, Some("deg")),
                    slider("saturation", "Saturation", 0, 100, 1, 0, Some("%")),
                    slider("cct", "CCT", 1800, 20000, 100, 5600, Some("K")),
                    slider("green-magenta", "Green/Magenta", -100, 100, 1, 0, None),
                ],
                defaults(&[("intensity", 100), ("cct", 5600), ("cctMin", 1800), ("cctMax", 20000), ("hue", 0), ("saturation", 0)]),
            ),
        ],
        visual!("fresnel", 167, 225, 147, Some(35.0), Some(60.0), None, None),
    )
}

fn storm_1200x_definition() -> LightingFixtureDefinitionSnapshot {
    definition!(
        "aputure-storm-1200x",
        "Aputure",
        "STORM",
        "1200x",
        "STORM 1200x",
        "verified",
        "https://help.aputure.com/hubfs/Knowledge%20Base/Aputure/STORM%201200x/documents/STORM%201200x%20DMX%20Profile%20Specification%20V1.5.pdf",
        "DMX Profile Specification V1.5",
        "2025-07-23",
        "beam",
        "cct-plus-8bit-3ch",
        vec![mode(
            "cct-plus-8bit-3ch",
            "CCT+ 8-bit 3 ch",
            "8-bit",
            vec!["intensity", "cct", "green-magenta"],
            vec![
                ch(1, "Dimmer", "intensity", "percent", 0),
                ch(2, "CCT", "cct", "kelvin", 91),
                ch(3, "+/- Green", "green-magenta", "offset", 127),
            ],
            vec![
                slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                slider("cct", "CCT", 2500, 10000, 100, 5600, Some("K")),
                slider("green-magenta", "Green/Magenta", -100, 100, 1, 0, None),
            ],
            defaults(&[("intensity", 100), ("cct", 5600), ("cctMin", 2500), ("cctMax", 10000)]),
        )],
        visual!("fresnel", 335, 338, 557, Some(12.0), Some(60.0), None, None),
    )
}

fn litepanels_verified_definitions() -> Vec<LightingFixtureDefinitionSnapshot> {
    vec![
        litepanels_astra_ip_definition(),
        litepanels_gemini_definition("litepanels-gemini-1x1", "Gemini", "1x1"),
        litepanels_gemini_definition("litepanels-gemini-2x1", "Gemini", "2x1"),
        litepanels_studio_x_definition(),
    ]
}

fn litepanels_astra_ip_definition() -> LightingFixtureDefinitionSnapshot {
    definition!(
        "litepanels-astra-ip",
        "Litepanels",
        "Astra IP",
        "Astra IP",
        "Astra IP",
        "verified",
        "https://www.litepanels.com/en/products/astra-ip/",
        "Astra IP product page",
        "2026-05-03",
        "profile",
        "p02-cct-8bit",
        vec![
            mode(
                "p01-cct-rgbw-8bit",
                "P01 CCT & RGBW 8-bit 12 ch",
                "8-bit",
                vec!["intensity", "cct", "rgb", "fan"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 18),
                    ch(3, "Green Offset", "green-magenta", "offset", 127),
                    ch(4, "White/RGB Crossfade", "mix", "percent", 0),
                    ch(5, "Red", "red", "percent", 255),
                    ch(6, "Green", "green", "percent", 255),
                    ch(7, "Blue", "blue", "percent", 255),
                    ch(8, "White", "white", "percent", 255),
                    ch(9, "Fan", "fan", "range", 0),
                    ch(10, "Reserved", "reserved", "range", 0),
                    ch(11, "Reserved", "reserved", "range", 0),
                    ch(12, "Reserved", "reserved", "range", 0),
                ],
                rgbw_controls(2700, 6500),
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 6500),
                ]),
            ),
            mode(
                "p02-cct-8bit",
                "P02 CCT 8-bit 6 ch",
                "8-bit",
                vec!["intensity", "cct", "green-magenta", "fan"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 18),
                    ch(3, "Green Offset", "green-magenta", "offset", 127),
                    ch(4, "Reserved", "reserved", "range", 0),
                    ch(5, "DMX Mode Control", "mode", "range", 0),
                    ch(6, "Fan", "fan", "range", 0),
                ],
                cct_controls(2700, 6500, 3200),
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 6500),
                ]),
            ),
        ],
        visual!("panel", 450, 300, 110, Some(30.0), Some(30.0), None, None),
    )
}

fn litepanels_gemini_definition(
    id: &str,
    family: &str,
    model: &str,
) -> LightingFixtureDefinitionSnapshot {
    definition!(
        id,
        "Litepanels",
        family,
        model,
        &format!("{family} {model}"),
        "verified",
        "https://www.litepanels.com/wp-content/uploads/2023/06/lp_gemini_dmx_function_chart.pdf",
        "Gemini DMX Function Chart V4.2 / FW Rev E5",
        "2024-01-01",
        "wash",
        "p02-cct-8bit",
        vec![
            mode(
                "p02-cct-8bit",
                "P02 CCT 8-bit 6 ch",
                "8-bit",
                vec!["intensity", "cct", "green-magenta", "fan"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 18),
                    ch(3, "Green Offset", "green-magenta", "offset", 127),
                    ch(4, "Reserved", "reserved", "range", 0),
                    ch(5, "DMX Mode Control", "mode", "range", 0),
                    ch(6, "Fan", "fan", "range", 0),
                ],
                cct_controls(2700, 10000, 3200),
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 10000),
                ]),
            ),
            mode(
                "p03-cct-hsi-8bit",
                "P03 CCT & HSI 8-bit 10 ch",
                "8-bit",
                vec!["intensity", "cct", "hsi", "green-magenta", "fan"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 18),
                    ch(3, "Green Offset", "green-magenta", "offset", 127),
                    ch(4, "White/HSI Crossfade", "mix", "percent", 0),
                    ch(5, "Hue", "hue", "degrees", 0),
                    ch(6, "Saturation", "saturation", "percent", 0),
                    ch(7, "Fan", "fan", "range", 0),
                    ch(8, "Reserved", "reserved", "range", 0),
                    ch(9, "Reserved", "reserved", "range", 0),
                    ch(10, "Reserved", "reserved", "range", 0),
                ],
                hsi_controls(2700, 10000, 3200),
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 10000),
                    ("hue", 0),
                    ("saturation", 0),
                ]),
            ),
            mode(
                "p07-cct-16bit",
                "P07 CCT 16-bit 8 ch",
                "16-bit",
                vec!["intensity", "cct", "green-magenta", "fan"],
                vec![
                    ch(1, "Dimmer coarse", "intensity", "percent", 0),
                    ch(2, "Dimmer fine", "intensity", "fine", 0),
                    ch(3, "CCT coarse", "cct", "kelvin", 18),
                    ch(4, "CCT fine", "cct", "fine", 0),
                    ch(5, "Green Offset coarse", "green-magenta", "offset", 127),
                    ch(6, "Green Offset fine", "green-magenta", "fine", 0),
                    ch(7, "DMX Mode Control", "mode", "range", 0),
                    ch(8, "Fan", "fan", "range", 0),
                ],
                cct_controls(2700, 10000, 3200),
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 10000),
                ]),
            ),
            mode(
                "p08-cct-hsi-16bit",
                "P08 CCT & HSI 16-bit 16 ch",
                "16-bit",
                vec!["intensity", "cct", "hsi", "green-magenta", "fan"],
                vec![
                    ch(1, "Dimmer coarse", "intensity", "percent", 0),
                    ch(2, "Dimmer fine", "intensity", "fine", 0),
                    ch(3, "CCT coarse", "cct", "kelvin", 18),
                    ch(4, "CCT fine", "cct", "fine", 0),
                    ch(5, "Green Offset coarse", "green-magenta", "offset", 127),
                    ch(6, "Green Offset fine", "green-magenta", "fine", 0),
                    ch(7, "White/HSI Crossfade coarse", "mix", "percent", 0),
                    ch(8, "White/HSI Crossfade fine", "mix", "fine", 0),
                    ch(9, "Hue coarse", "hue", "degrees", 0),
                    ch(10, "Hue fine", "hue", "fine", 0),
                    ch(11, "Saturation coarse", "saturation", "percent", 0),
                    ch(12, "Saturation fine", "saturation", "fine", 0),
                    ch(13, "Fan", "fan", "range", 0),
                    ch(14, "Reserved", "reserved", "range", 0),
                    ch(15, "Reserved", "reserved", "range", 0),
                    ch(16, "Reserved", "reserved", "range", 0),
                ],
                hsi_controls(2700, 10000, 3200),
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 10000),
                    ("hue", 0),
                    ("saturation", 0),
                ]),
            ),
        ],
        visual!("panel", 635, 305, 150, Some(90.0), Some(90.0), None, None),
    )
}

fn litepanels_studio_x_definition() -> LightingFixtureDefinitionSnapshot {
    definition!(
        "litepanels-studio-x-bicolor",
        "Litepanels",
        "Studio X",
        "Bi-Color",
        "Studio X Bi-Color",
        "verified",
        "https://www.litepanels.com/en/product/studio-x3-bi-color-100w/",
        "Studio X product DMX chart download",
        "2026-05-03",
        "profile",
        "bicolor-8bit",
        vec![
            mode(
                "bicolor-8bit",
                "Bi-Color 8-bit 3 ch",
                "8-bit",
                vec!["intensity", "cct", "zoom"],
                vec![
                    ch(1, "Dimmer", "intensity", "percent", 0),
                    ch(2, "CCT", "cct", "kelvin", 60),
                    ch(3, "Spot/Flood", "zoom", "percent", 0),
                ],
                vec![
                    slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                    slider("cct", "CCT", 2700, 6500, 100, 3200, Some("K")),
                    slider("zoom", "Spot/Flood", 0, 100, 1, 0, Some("%")),
                ],
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 6500),
                    ("zoom", 0),
                ]),
            ),
            mode(
                "bicolor-16bit",
                "Bi-Color 16-bit 6 ch",
                "16-bit",
                vec!["intensity", "cct", "zoom"],
                vec![
                    ch(1, "Dimmer coarse", "intensity", "percent", 0),
                    ch(2, "Dimmer fine", "intensity", "fine", 0),
                    ch(3, "CCT coarse", "cct", "kelvin", 60),
                    ch(4, "CCT fine", "cct", "fine", 0),
                    ch(5, "Spot/Flood coarse", "zoom", "percent", 0),
                    ch(6, "Spot/Flood fine", "zoom", "fine", 0),
                ],
                vec![
                    slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
                    slider("cct", "CCT", 2700, 6500, 100, 3200, Some("K")),
                    slider("zoom", "Spot/Flood", 0, 100, 1, 0, Some("%")),
                ],
                defaults(&[
                    ("intensity", 100),
                    ("cct", 3200),
                    ("cctMin", 2700),
                    ("cctMax", 6500),
                    ("zoom", 0),
                ]),
            ),
        ],
        visual!("fresnel", 300, 300, 420, Some(8.0), Some(70.0), None, None),
    )
}

fn research_needed_definitions() -> Vec<LightingFixtureDefinitionSnapshot> {
    [
        (
            "aputure-ls-600d",
            "Aputure",
            "Light Storm",
            "LS 600d",
            "beam",
        ),
        (
            "aputure-ls-600x-pro",
            "Aputure",
            "Light Storm",
            "LS 600x Pro",
            "beam",
        ),
        (
            "aputure-ls-600c-pro",
            "Aputure",
            "Light Storm",
            "LS 600c Pro",
            "beam",
        ),
        (
            "aputure-ls-1200d-pro",
            "Aputure",
            "Light Storm",
            "LS 1200d Pro",
            "beam",
        ),
        ("aputure-storm-1000c", "Aputure", "STORM", "1000c", "beam"),
        (
            "aputure-electro-storm-cs15",
            "Aputure",
            "Electro Storm",
            "CS15",
            "beam",
        ),
        (
            "aputure-electro-storm-xt26",
            "Aputure",
            "Electro Storm",
            "XT26",
            "beam",
        ),
        ("aputure-nova-p300c", "Aputure", "NOVA", "P300c", "panel"),
        ("aputure-nova-p600c", "Aputure", "NOVA", "P600c", "panel"),
        ("aputure-nova-ii", "Aputure", "NOVA II", "Series", "panel"),
        ("aputure-nova-9", "Aputure", "NOVA", "9", "panel"),
        (
            "litepanels-astra-ip-half",
            "Litepanels",
            "Astra IP",
            "Half",
            "profile",
        ),
        (
            "litepanels-astra-ip-2x1",
            "Litepanels",
            "Astra IP",
            "2x1",
            "profile",
        ),
        (
            "litepanels-studio-x-daylight",
            "Litepanels",
            "Studio X",
            "Daylight",
            "profile",
        ),
    ]
    .into_iter()
    .map(|(id, manufacturer, family, model, kind)| {
        definition!(
            id,
            manufacturer,
            family,
            model,
            &format!("{family} {model}"),
            "research-needed",
            if manufacturer == "Aputure" {
                "https://aputure.com/en-US/pages/sidus-features"
            } else {
                "https://www.litepanels.com/en/products/"
            },
            "Profile verification required",
            "2026-05-03",
            kind,
            DEFAULT_MODE_ID,
            vec![no_dmx_mode(DEFAULT_MODE_ID, "Profile pending verification")],
            visual!(
                if kind == "panel" { "panel" } else { "fresnel" },
                300,
                300,
                150,
                None,
                None,
                None,
                None,
            ),
        )
    })
    .collect()
}

fn build_definition(
    spec: DefinitionSpec<'_>,
    modes: Vec<LightingFixtureModeSnapshot>,
    visual: LightingFixtureVisualSnapshot,
) -> LightingFixtureDefinitionSnapshot {
    let visual = visual_for_definition(spec.id, spec.family, spec.kind, spec.status, visual);
    LightingFixtureDefinitionSnapshot {
        id: String::from(spec.id),
        manufacturer: String::from(spec.manufacturer),
        family: String::from(spec.family),
        model: String::from(spec.model),
        display_name: String::from(spec.display_name),
        status: String::from(spec.status),
        source_url: String::from(spec.source_url),
        source_version: String::from(spec.source_version),
        source_date: String::from(spec.source_date),
        kind: String::from(spec.kind),
        default_mode_id: String::from(spec.default_mode_id),
        modes,
        visual,
    }
}

fn visual_for_definition(
    id: &str,
    family: &str,
    kind: &str,
    status: &str,
    mut visual: LightingFixtureVisualSnapshot,
) -> LightingFixtureVisualSnapshot {
    visual.symbol_kind = symbol_kind_for_visual(visual.shape.as_str()).to_owned();
    visual.symbol_variant = symbol_variant_for_definition(id, family, visual.symbol_kind.as_str());
    visual.output = output_for_visual(
        id,
        visual.shape.as_str(),
        visual.beam_angle_min,
        visual.beam_angle_max,
        visual.field_angle,
    );
    visual.emitter_layout = emitter_layout_for_visual(
        id,
        visual.symbol_kind.as_str(),
        visual.pixel_layout.as_ref(),
    );
    visual.visual_confidence = visual_confidence_for_definition(id, status, kind).to_owned();
    visual
}

fn symbol_kind_for_visual(shape: &str) -> &'static str {
    match shape {
        "bar" => "linear-bar",
        "control-node" => "control-node",
        "fresnel" => "fresnel",
        "mat" => "soft-mat",
        "panel" => "panel",
        _ => "fresnel",
    }
}

fn symbol_variant_for_definition(id: &str, family: &str, symbol_kind: &str) -> String {
    match id {
        "aputure-infinibar-pb12" => String::from("infinibar-pb12"),
        "aputure-infinimat-generic" => String::from("infinimat"),
        "litepanels-apollo-bridge" => String::from("apollo-bridge"),
        "litepanels-astra-bicolor" => String::from("astra"),
        "litepanels-astra-ip" => String::from("astra-ip"),
        "litepanels-gemini-1x1" | "litepanels-gemini-2x1" => String::from("gemini"),
        "aputure-ls-600d-pro" => String::from("light-storm"),
        "aputure-storm-80c" | "aputure-storm-1200x" => String::from("storm"),
        "litepanels-studio-x-bicolor" | "litepanels-studio-x-daylight" => String::from("studio-x"),
        _ => match symbol_kind {
            "panel" => match family {
                "Astra" => String::from("astra"),
                "Astra IP" => String::from("astra-ip"),
                "Gemini" => String::from("gemini"),
                _ => String::from("panel"),
            },
            "fresnel" => match family {
                "Light Storm" => String::from("light-storm"),
                "STORM" => String::from("storm"),
                "Studio X" => String::from("studio-x"),
                _ => String::from("fresnel"),
            },
            other => String::from(other),
        },
    }
}

fn visual_confidence_for_definition(id: &str, status: &str, _kind: &str) -> &'static str {
    if status == "research-needed" {
        "fallback"
    } else if matches!(id, "aputure-infinibar-pb12" | "litepanels-apollo-bridge") {
        "verified"
    } else {
        "catalogue-derived"
    }
}

fn beam_type_for_shape(shape: &str) -> &'static str {
    match shape {
        "bar" => "rectangle",
        "control-node" => "none",
        "fresnel" => "fresnel",
        "mat" | "panel" => "wash",
        _ => "fresnel",
    }
}

fn output_for_visual(
    id: &str,
    shape: &str,
    beam_angle_min: Option<f64>,
    beam_angle_max: Option<f64>,
    field_angle: Option<f64>,
) -> LightingFixtureOutputSnapshot {
    LightingFixtureOutputSnapshot {
        beam_type: String::from(beam_type_for_shape(shape)),
        beam_angle: if shape == "control-node" {
            None
        } else {
            beam_angle_max.or(beam_angle_min)
        },
        field_angle: if shape == "control-node" {
            None
        } else {
            field_angle
        },
        photometric_samples: photometric_samples_for_definition(id),
    }
}

fn photometric_samples_for_definition(id: &str) -> Vec<LightingFixturePhotometricSampleSnapshot> {
    if id != "aputure-infinibar-pb12" {
        return Vec::new();
    }

    vec![
        photometric_sample(
            5600,
            0.5,
            1600.0,
            "none",
            "Aputure INFINIBAR PB12 product page",
        ),
        photometric_sample(
            5600,
            1.0,
            593.0,
            "none",
            "Aputure INFINIBAR PB12 product page",
        ),
    ]
}

fn photometric_sample(
    cct: i64,
    distance_meters: f64,
    lux: f64,
    modifier: &str,
    source: &str,
) -> LightingFixturePhotometricSampleSnapshot {
    LightingFixturePhotometricSampleSnapshot {
        cct,
        distance_meters,
        lux,
        modifier: String::from(modifier),
        source: String::from(source),
    }
}

fn emitter_layout_for_visual(
    id: &str,
    symbol_kind: &str,
    pixel_layout: Option<&LightingFixturePixelLayoutSnapshot>,
) -> Option<LightingFixtureEmitterLayoutSnapshot> {
    let pixel_layout = pixel_layout?;
    Some(LightingFixtureEmitterLayoutSnapshot {
        emitter_kind: String::from(match symbol_kind {
            "linear-bar" => "pixel-line",
            "soft-mat" => "pixel-mat",
            _ => "pixel-grid",
        }),
        rows: pixel_layout.rows,
        columns: pixel_layout.columns,
        segments: pixel_layout.segments,
        physical_pixels: if id == "aputure-infinibar-pb12" {
            Some(96)
        } else {
            None
        },
        direction: pixel_layout.order.clone(),
    })
}

fn mode(
    id: &str,
    display_name: &str,
    resolution: &str,
    capabilities: Vec<&str>,
    channels: Vec<LightingFixtureChannelSnapshot>,
    controls: Vec<LightingFixtureControlSnapshot>,
    defaults: HashMap<String, i64>,
) -> LightingFixtureModeSnapshot {
    LightingFixtureModeSnapshot {
        id: String::from(id),
        display_name: String::from(display_name),
        channel_count: channels.len() as i64,
        resolution: String::from(resolution),
        capabilities: capabilities.into_iter().map(String::from).collect(),
        channels,
        controls,
        defaults,
    }
}

fn no_dmx_mode(id: &str, display_name: &str) -> LightingFixtureModeSnapshot {
    mode(
        id,
        display_name,
        "none",
        Vec::new(),
        Vec::new(),
        Vec::new(),
        HashMap::new(),
    )
}

fn ch(
    offset: i64,
    label: &str,
    control_id: &str,
    value_type: &str,
    default_dmx: i64,
) -> LightingFixtureChannelSnapshot {
    LightingFixtureChannelSnapshot {
        offset,
        label: String::from(label),
        control_id: String::from(control_id),
        value_type: String::from(value_type),
        default_dmx,
        ranges: None,
    }
}

fn ranged_ch(
    offset: i64,
    label: &str,
    control_id: &str,
    value_type: &str,
    default_dmx: i64,
    ranges: &[(&str, i64, i64)],
) -> LightingFixtureChannelSnapshot {
    LightingFixtureChannelSnapshot {
        offset,
        label: String::from(label),
        control_id: String::from(control_id),
        value_type: String::from(value_type),
        default_dmx,
        ranges: Some(
            ranges
                .iter()
                .map(
                    |(label, dmx_min, dmx_max)| LightingFixtureChannelRangeSnapshot {
                        dmx_min: *dmx_min,
                        dmx_max: *dmx_max,
                        label: String::from(*label),
                    },
                )
                .collect(),
        ),
    }
}

fn repeated_pixel_channels(pixels: i64, labels: &[&str]) -> Vec<LightingFixtureChannelSnapshot> {
    let mut channels = Vec::with_capacity((pixels as usize) * labels.len());
    let mut offset = 1;
    for pixel in 1..=pixels {
        for label in labels {
            let control_id = label.to_lowercase().replace(['/', ' '], "-");
            channels.push(ch(
                offset,
                &format!("Px {pixel} {label}"),
                control_id.as_str(),
                if *label == "CCT" { "kelvin" } else { "percent" },
                0,
            ));
            offset += 1;
        }
    }
    channels
}

fn slider(
    id: &str,
    label: &str,
    min: i64,
    max: i64,
    step: i64,
    default_value: i64,
    unit: Option<&str>,
) -> LightingFixtureControlSnapshot {
    LightingFixtureControlSnapshot {
        id: String::from(id),
        label: String::from(label),
        kind: String::from("slider"),
        value_type: String::from("number"),
        min,
        max,
        step,
        default_value,
        unit: unit.map(String::from),
        options: Vec::new(),
    }
}

fn cct_controls(min: i64, max: i64, default_cct: i64) -> Vec<LightingFixtureControlSnapshot> {
    vec![
        slider("intensity", "Intensity", 0, 100, 1, 100, Some("%")),
        slider("cct", "CCT", min, max, 100, default_cct, Some("K")),
        slider("green-magenta", "Green/Magenta", -100, 100, 1, 0, None),
        slider("fan", "Fan", 0, 255, 1, 0, None),
    ]
}

fn hsi_controls(min: i64, max: i64, default_cct: i64) -> Vec<LightingFixtureControlSnapshot> {
    let mut controls = cct_controls(min, max, default_cct);
    controls.push(slider("hue", "Hue", 0, 359, 1, 0, Some("deg")));
    controls.push(slider("saturation", "Saturation", 0, 100, 1, 0, Some("%")));
    controls
}

fn rgbw_controls(min: i64, max: i64) -> Vec<LightingFixtureControlSnapshot> {
    let mut controls = cct_controls(min, max, 3200);
    controls.push(slider("red", "Red", 0, 255, 1, 255, None));
    controls.push(slider("green", "Green", 0, 255, 1, 255, None));
    controls.push(slider("blue", "Blue", 0, 255, 1, 255, None));
    controls.push(slider("white", "White", 0, 255, 1, 255, None));
    controls
}

fn defaults(entries: &[(&str, i64)]) -> HashMap<String, i64> {
    entries
        .iter()
        .map(|(key, value)| (String::from(*key), *value))
        .collect()
}

fn build_visual(spec: VisualSpec<'_>) -> LightingFixtureVisualSnapshot {
    LightingFixtureVisualSnapshot {
        shape: String::from(spec.shape),
        symbol_kind: String::new(),
        symbol_variant: String::new(),
        width_mm: spec.width_mm,
        height_mm: spec.height_mm,
        depth_mm: spec.depth_mm,
        beam_angle_min: spec.beam_angle_min,
        beam_angle_max: spec.beam_angle_max,
        field_angle: spec.field_angle,
        pixel_layout: spec.pixel_layout,
        emitter_layout: None,
        output: LightingFixtureOutputSnapshot {
            beam_type: String::from("none"),
            beam_angle: None,
            field_angle: None,
            photometric_samples: Vec::new(),
        },
        visual_confidence: String::new(),
    }
}

fn pixel_layout(
    pixel_count: i64,
    rows: i64,
    columns: i64,
    segments: i64,
    order: &str,
) -> LightingFixturePixelLayoutSnapshot {
    LightingFixturePixelLayoutSnapshot {
        pixel_count,
        rows,
        columns,
        segments,
        order: String::from(order),
    }
}
