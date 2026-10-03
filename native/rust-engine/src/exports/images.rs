//! The profile's image library (2026-10-03): an image for every key and
//! every strip cell, by its own name, drawn at the deck's own size by
//! `scripts/deck-assets.py` into `assets/deck/images.json`. A key's layer
//! takes its image by name (`$(image:<name>)`), so the brand's label images
//! replace these without a change to any key.

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeckImage {
    pub(super) name: String,
    pub(super) description: String,
    // The tests hold every image to its control's size.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) width: u32,
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) height: u32,
    /// Companion's own checksum of an upload: the SHA-1 of the data URL.
    pub(super) checksum: String,
    pub(super) data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeckImages {
    rendered_at_ms: u64,
    images: Vec<DeckImage>,
}

fn rendered() -> DeckImages {
    serde_json::from_str(include_str!("../../assets/deck/images.json"))
        .expect("assets/deck/images.json is the image script's manifest")
}

/// Every image of the profile, as the script drew it.
#[cfg(test)]
pub(super) fn deck_images() -> Vec<DeckImage> {
    rendered().images
}

/// The library as a full export carries it. Companion stores each entry as
/// it is, under its name, and a layer reads it as `$(image:<name>)`; the
/// preview is the image itself, no image being wider than Companion's
/// previews (200 px).
pub(super) fn image_library() -> Value {
    let rendered = rendered();
    Value::Array(
        rendered
            .images
            .iter()
            .enumerate()
            .map(|(sort_order, image)| {
                json!({
                    "info": {
                        "name": image.name,
                        "description": image.description,
                        "originalSize": image.data_url.len(),
                        "previewSize": image.data_url.len(),
                        "createdAt": rendered.rendered_at_ms,
                        "modifiedAt": rendered.rendered_at_ms,
                        "checksum": image.checksum,
                        "mimeType": "image/png",
                        "sortOrder": sort_order,
                        "backgroundColor": "rgba(0, 0, 0, 0)"
                    },
                    "originalImage": image.data_url,
                    "previewImage": image.data_url
                })
            })
            .collect(),
    )
}
