//! A camera's frame as the renderer takes it, and the rule for what it
//! takes: kept apart from `renderer.rs` so it is compiled and tested on any
//! system.

/// The largest frame a camera may hand over.
pub const MAX_FRAME_WIDTH: u32 = 3840;
pub const MAX_FRAME_HEIGHT: u32 = 2160;

/// A camera's newest frame, as it came: UYVY, `stride` bytes a row.
pub struct Picture<'a> {
    pub uyvy: &'a [u8],
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    /// Counts the camera's frames: a frame of the count the renderer drew
    /// last is not uploaded again. Only Direct3D's renderer reads it.
    pub sequence: u64,
}

impl Picture<'_> {
    /// A frame the renderer can take: an even width, no larger than
    /// `MAX_FRAME_WIDTH` × `MAX_FRAME_HEIGHT`, and every row inside its bytes.
    pub fn check(&self) -> Result<(), String> {
        let sized = self.width >= 2
            && self.width.is_multiple_of(2)
            && self.height >= 1
            && self.width <= MAX_FRAME_WIDTH
            && self.height <= MAX_FRAME_HEIGHT
            && self.stride >= self.width * 2
            && self.stride <= MAX_FRAME_WIDTH * 4;
        if !sized {
            return Err(format!(
                "a frame of {} × {} with rows of {} bytes",
                self.width, self.height, self.stride
            ));
        }
        let needed = self.stride as usize * (self.height as usize - 1) + self.width as usize * 2;
        if self.uyvy.len() < needed {
            return Err(format!(
                "a frame of {} × {} in {} bytes",
                self.width,
                self.height,
                self.uyvy.len()
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(uyvy: &[u8], width: u32, height: u32, stride: u32) -> Picture<'_> {
        Picture {
            uyvy,
            width,
            height,
            stride,
            sequence: 0,
        }
    }

    #[test]
    fn a_frame_is_taken_when_every_row_lies_inside_its_bytes() {
        let bytes = vec![0_u8; 1920 * 1080 * 2];
        assert!(picture(&bytes, 1920, 1080, 3840).check().is_ok());
        // Rows padded to a wider stride: the last row needs only its own bytes.
        let padded = vec![0_u8; 4096 * 1079 + 3840];
        assert!(picture(&padded, 1920, 1080, 4096).check().is_ok());
        assert!(picture(&padded[..padded.len() - 1], 1920, 1080, 4096)
            .check()
            .is_err());
        let large = vec![0_u8; 3840 * 2160 * 2];
        assert!(picture(&large, 3840, 2160, 7680).check().is_ok());
    }

    #[test]
    fn a_frame_of_a_wrong_shape_is_refused() {
        let bytes = vec![0_u8; 4096 * 2200 * 2];
        for (width, height, stride) in [
            (0, 1080, 3840),
            (1920, 0, 3840),
            (1921, 1080, 3842),
            (1920, 1080, 3839),
            (3842, 2160, 7684),
            (3840, 2162, 7680),
            (1920, 1080, 15361),
        ] {
            assert!(
                picture(&bytes, width, height, stride).check().is_err(),
                "{width} × {height}, {stride}"
            );
        }
        assert!(picture(&bytes[..100], 1920, 1080, 3840).check().is_err());
    }
}
