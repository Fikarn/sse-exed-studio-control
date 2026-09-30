//! No renderer where there is no Direct3D: the pictures are drawn on Windows
//! alone (`renderer.rs`). The helper still runs, says what it receives and
//! makes its link, so its tests run on any system. The shell makes no
//! surface on such a system either, so nothing here is ever asked to draw;
//! asked all the same, it says why it cannot.

use crate::picture::Picture;
use std::time::Duration;
use studio_control_protocol::picture_layer::Scene;

pub struct Renderer;

const WHY: &str = "the pictures are drawn on Windows alone";

impl Renderer {
    pub fn open(_surface: u64) -> Result<Self, String> {
        Ok(Self)
    }

    pub fn draw(
        &mut self,
        _scene: &Scene,
        pictures: &[Option<Picture<'_>>; 3],
    ) -> Result<Duration, String> {
        for picture in pictures.iter().flatten() {
            picture.check()?;
        }
        Err(String::from(WHY))
    }

    pub fn statistics(&self) -> String {
        String::new()
    }
}
