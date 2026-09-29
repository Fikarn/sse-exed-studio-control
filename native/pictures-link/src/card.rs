//! The simulated source's pictures: each camera's test card, the one the
//! page drew until the pictures came (`frontend/app/src/app/cameras/pictures/
//! testPicture.ts`), in the picture's own 1920 × 1080 pixels and at the small
//! pictures' 544 × 306, as UYVY, the format NDI hands out. A mark moves along
//! the card's foot, so a picture that stops is seen to stop.
//!
//! The card holds what the aids are for: bars at 75 %, a ramp and steps that
//! reach full white for the zebras, and line pairs down to one pixel for the
//! peaking. The cameras are told apart by one, two or three squares at the
//! top left.

/// The picture's size, and the small pictures'.
pub const FULL: (u16, u16) = (1920, 1080);
pub const SMALL: (u16, u16) = (544, 306);

type Rgb = [u8; 3];

/// A picture in full-range RGB, row by row.
struct Canvas {
    width: usize,
    height: usize,
    pixels: Vec<Rgb>,
}

impl Canvas {
    fn new(width: usize, height: usize, fill: Rgb) -> Self {
        Self {
            width,
            height,
            pixels: vec![fill; width * height],
        }
    }

    fn rect(&mut self, left: usize, top: usize, width: usize, height: usize, colour: Rgb) {
        for y in top..(top + height).min(self.height) {
            for x in left..(left + width).min(self.width) {
                self.pixels[y * self.width + x] = colour;
            }
        }
    }
}

fn hex(value: u32) -> Rgb {
    [(value >> 16) as u8, (value >> 8) as u8, value as u8]
}

fn grey(share: f64) -> Rgb {
    let level = (share.clamp(0.0, 1.0) * 255.0).round() as u8;
    [level, level, level]
}

const BARS: [u32; 7] = [
    0xbfbfbf, 0xbfbf00, 0x00bfbf, 0x00bf00, 0xbf00bf, 0xbf0000, 0x0000bf,
];
const FIELD_LEFT: usize = 120;
const FIELD_RIGHT: usize = 1800;
const LINE_WIDTHS: [usize; 4] = [8, 4, 2, 1];

/// Camera `camera`'s card, as the page drew it.
fn card(camera: u8) -> Canvas {
    let field_width = FIELD_RIGHT - FIELD_LEFT;
    let mut canvas = Canvas::new(usize::from(FULL.0), usize::from(FULL.1), hex(0x1c1c1f));
    // Which camera: one, two or three squares.
    for index in 0..usize::from(camera.clamp(1, 3)) {
        canvas.rect(FIELD_LEFT + index * 64, 40, 48, 48, hex(0xbfbfbf));
    }
    // The bars.
    let bar = field_width as f64 / BARS.len() as f64;
    for (index, colour) in BARS.iter().enumerate() {
        let left = (FIELD_LEFT as f64 + index as f64 * bar).round() as usize;
        let right = (FIELD_LEFT as f64 + (index + 1) as f64 * bar).round() as usize;
        canvas.rect(left, 120, right - left, 440, hex(*colour));
    }
    // The ramp, black to white.
    for x in FIELD_LEFT..FIELD_RIGHT {
        let share = (x - FIELD_LEFT) as f64 / (field_width - 1) as f64;
        canvas.rect(x, 600, 1, 120, grey(share));
    }
    // Eleven steps, 0 % to 100 %.
    let step = field_width as f64 / 11.0;
    for index in 0..=10 {
        let left = (FIELD_LEFT as f64 + index as f64 * step).round() as usize;
        canvas.rect(
            left,
            740,
            step.ceil() as usize,
            80,
            grey(index as f64 / 10.0),
        );
    }
    // Line pairs, white on black.
    canvas.rect(FIELD_LEFT, 860, 800, 140, hex(0x000000));
    for (block, width) in LINE_WIDTHS.iter().enumerate() {
        let left = FIELD_LEFT + block * 200 + 12;
        let mut x = 0;
        while x + width <= 176 {
            canvas.rect(left + x, 872, *width, 116, hex(0xffffff));
            x += width * 2;
        }
    }
    // Patches: full white, 18 % grey, a skin tone and black.
    for (index, colour) in [hex(0xffffff), grey(0.18), hex(0xc08b6d), hex(0x000000)]
        .iter()
        .enumerate()
    {
        canvas.rect(1000 + index * 200, 860, 184, 140, *colour);
    }
    // The frame's centre, a ring 4 pixels wide, and its edge.
    let (centre_x, centre_y, radius) = (960.0_f64, 340.0_f64, 180.0_f64);
    for y in 150..530 {
        for x in 770..1150 {
            let distance =
                ((x as f64 + 0.5 - centre_x).powi(2) + (y as f64 + 0.5 - centre_y).powi(2)).sqrt();
            if (distance - radius).abs() <= 2.0 {
                canvas.rect(x, y, 1, 1, hex(0xbfbfbf));
            }
        }
    }
    let (width, height) = (canvas.width, canvas.height);
    for (left, top, w, h) in [
        (0, 0, width, 4),
        (0, height - 4, width, 4),
        (0, 0, 4, height),
        (width - 4, 0, 4, height),
    ] {
        canvas.rect(left, top, w, h, hex(0xbfbfbf));
    }
    canvas
}

/// The card at the small pictures' size: each small pixel the average of
/// the pixels it covers.
fn shrink(canvas: &Canvas, width: usize, height: usize) -> Canvas {
    let mut small = Canvas::new(width, height, [0, 0, 0]);
    for y in 0..height {
        let top = y * canvas.height / height;
        let bottom = ((y + 1) * canvas.height / height).max(top + 1);
        for x in 0..width {
            let left = x * canvas.width / width;
            let right = ((x + 1) * canvas.width / width).max(left + 1);
            let mut sum = [0_u32; 3];
            for source_y in top..bottom {
                for source_x in left..right {
                    let pixel = canvas.pixels[source_y * canvas.width + source_x];
                    for channel in 0..3 {
                        sum[channel] += u32::from(pixel[channel]);
                    }
                }
            }
            let count = ((bottom - top) * (right - left)) as u32;
            small.pixels[y * width + x] = sum.map(|total| ((total + count / 2) / count) as u8);
        }
    }
    small
}

/// Full-range RGB to BT.709 video-range Y, Cb and Cr, as NDI's UYVY holds
/// them: what a camera through vMix would send.
fn ycbcr(rgb: Rgb) -> (f64, f64, f64) {
    let [r, g, b] = rgb.map(|channel| f64::from(channel) / 255.0);
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let cb = (b - y) / 1.8556;
    let cr = (r - y) / 1.5748;
    (16.0 + 219.0 * y, 128.0 + 224.0 * cb, 128.0 + 224.0 * cr)
}

fn byte(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

/// A picture as UYVY: two pixels in four bytes, U Y0 V Y1.
fn uyvy(canvas: &Canvas) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(canvas.pixels.len() * 2);
    for pair in canvas.pixels.chunks_exact(2) {
        let (y0, cb0, cr0) = ycbcr(pair[0]);
        let (y1, cb1, cr1) = ycbcr(pair[1]);
        bytes.extend_from_slice(&[
            byte((cb0 + cb1) / 2.0),
            byte(y0),
            byte((cr0 + cr1) / 2.0),
            byte(y1),
        ]);
    }
    bytes
}

/// One camera's cards as UYVY, big and small, made once.
pub struct Cards {
    pub full: Vec<u8>,
    pub small: Vec<u8>,
}

impl Cards {
    pub fn new(camera: u8) -> Self {
        let full = card(camera);
        let small = shrink(&full, usize::from(SMALL.0), usize::from(SMALL.1));
        Self {
            full: uyvy(&full),
            small: uyvy(&small),
        }
    }
}

/// Draws the moving mark into a UYVY picture of `width` × `height`: a white
/// square along the card's foot, one sweep every four seconds.
pub fn mark(picture: &mut [u8], width: u16, height: u16, frame: u64) {
    let (width, height) = (usize::from(width), usize::from(height));
    let scale = |full: usize| full * width / usize::from(FULL.0);
    let side = scale(32).max(2) & !1;
    let span = scale(FIELD_RIGHT - FIELD_LEFT).saturating_sub(side);
    // 120 frames a sweep: four seconds at 29.97.
    let step = (frame % 120) as usize;
    let left = (scale(FIELD_LEFT) + span * step / 119) & !1;
    let top = scale(1024).min(height.saturating_sub(side));
    for y in top..(top + side).min(height) {
        for x in (left..(left + side).min(width)).step_by(2) {
            let at = (y * width + x) * 2;
            if let Some(pair) = picture.get_mut(at..at + 4) {
                pair.copy_from_slice(&[128, 235, 128, 235]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_card_holds_the_bars_the_steps_and_the_cameras_squares() {
        let one = card(1);
        let at = |canvas: &Canvas, x: usize, y: usize| canvas.pixels[y * canvas.width + x];
        assert_eq!(at(&one, 200, 300), [191, 191, 191], "the first bar at 75 %");
        assert_eq!(
            at(&one, 1700, 780),
            [255, 255, 255],
            "the last step, full white"
        );
        assert_eq!(at(&one, 900, 780), [128, 128, 128], "the middle step, 50 %");
        assert_eq!(at(&one, 1050, 900), [255, 255, 255], "the white patch");
        assert_eq!(
            at(&one, 120 + 64 + 10, 60),
            [28, 28, 31],
            "CAM 1 has one square"
        );
        let three = card(3);
        assert_eq!(
            at(&three, 120 + 128 + 10, 60),
            [191, 191, 191],
            "CAM 3 has three"
        );
    }

    #[test]
    fn white_and_black_are_video_range_and_grey_has_no_colour() {
        assert_eq!(ycbcr([255, 255, 255]).0.round(), 235.0);
        assert_eq!(ycbcr([0, 0, 0]).0.round(), 16.0);
        let (_, cb, cr) = ycbcr([128, 128, 128]);
        assert_eq!((cb.round(), cr.round()), (128.0, 128.0));
        let cards = Cards::new(2);
        assert_eq!(cards.full.len(), 1920 * 1080 * 2);
        assert_eq!(cards.small.len(), 544 * 306 * 2);
    }

    #[test]
    fn the_mark_moves_and_stays_inside_the_picture() {
        let cards = Cards::new(1);
        for (width, height, base) in [(1920_u16, 1080_u16, &cards.full), (544, 306, &cards.small)] {
            let mut first = base.clone();
            mark(&mut first, width, height, 0);
            let mut later = base.clone();
            mark(&mut later, width, height, 60);
            assert_ne!(first, *base, "the mark is drawn");
            assert_ne!(first, later, "it moves");
            mark(&mut later, width, height, u64::MAX);
            assert_eq!(later.len(), base.len());
        }
    }
}
