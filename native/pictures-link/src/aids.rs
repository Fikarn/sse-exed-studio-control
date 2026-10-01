//! The picture aids as the helper draws them (the camera pictures, D30):
//! zebras, peaking, the guides and the loupe's marker, with the page's own
//! numbers. The page's are the reference (`pictureAids.ts`, held to these by
//! `pictureAids.test.ts`, which reads this file); the renderer's shader is
//! written from these (`shader_numbers`), and the rules below, the tests'
//! alone, are what the shader does, so that a test can hold a drawn picture
//! to them.
//!
//! Zebras and peaking are worked out at the picture's own pixels (1920 ×
//! 1080, after a larger frame is averaged down to it), from their 8-bit RGB:
//! the same pixels a page in a browser works them out from for a frame of
//! the picture's size. The guides and the marker are lines in the picture's
//! pixels, scaled with the view.

/// Where the zebras start: 95 % of full brightness (at or over).
pub const ZEBRA_LEVEL: f64 = 0.95;
/// How far two neighbours must differ in brightness to count as sharp (more
/// than).
pub const PEAKING_STEP: f64 = 0.12;
/// The zebra stripes' period, in the picture's pixels: light for the first
/// half, dark for the second, along `x + y`.
pub const STRIPE_PERIOD: u32 = 16;
/// The stripes' inks: white at 230 of 255, black at 153 of 255.
pub const STRIPE_LIGHT_ALPHA: u32 = 230;
pub const STRIPE_DARK_ALPHA: u32 = 153;
/// The peaking's ink, the display's blue (`#7cc4ff`), opaque.
pub const PEAKING_INK: [u8; 3] = [124, 196, 255];
/// The guides: the thirds, and a cross at the centre, white, in the
/// picture's pixels.
pub const GUIDE_WIDTH: f64 = 2.0;
pub const GUIDE_ALPHA: f64 = 0.45;
pub const CROSS_ARM: f64 = 30.0;
pub const CROSS_ALPHA: f64 = 0.7;
/// The loupe's marker: a dashed white frame, centred on the loupe's edge.
pub const MARKER_WIDTH: f64 = 3.0;
pub const MARKER_DASH: [f64; 2] = [14.0, 8.0];

/// A pixel's brightness from 0 to 1: Rec. 709 luma of its 8-bit values.
#[cfg(test)]
pub fn brightness(rgb: [u8; 3]) -> f64 {
    (0.2126 * f64::from(rgb[0]) + 0.7152 * f64::from(rgb[1]) + 0.0722 * f64::from(rgb[2])) / 255.0
}

/// Whether the stripe at picture pixel (`x`, `y`) is the light one.
#[cfg(test)]
pub fn stripe_is_light(x: u32, y: u32) -> bool {
    (x + y) % STRIPE_PERIOD < STRIPE_PERIOD / 2
}

/// `ink` laid over `under` at `alpha` of 255, rounded as a canvas or the page
/// test rounds it.
#[cfg(test)]
fn over(under: u8, ink: u8, alpha: u32) -> u8 {
    let alpha = f64::from(alpha) / 255.0;
    (f64::from(ink) * alpha + f64::from(under) * (1.0 - alpha)).round() as u8
}

/// The zebras and the peaking laid over a picture of `width` × `height`
/// pixels in 8-bit RGB, as the shader lays them over each pixel shown at
/// 1:1: the stripes where a pixel is at or over `ZEBRA_LEVEL`, then the
/// peaking's ink where it differs from a neighbour by more than
/// `PEAKING_STEP`.
#[cfg(test)]
pub fn lay_over(
    picture: &[[u8; 3]],
    width: usize,
    height: usize,
    zebras: bool,
    peaking: bool,
) -> Vec<[u8; 3]> {
    let level: Vec<f64> = picture.iter().map(|rgb| brightness(*rgb)).collect();
    let at = |x: usize, y: usize| level[y * width + x];
    picture
        .iter()
        .enumerate()
        .map(|(index, rgb)| {
            let (x, y) = (index % width, index / width);
            let mut out = *rgb;
            if zebras && at(x, y) >= ZEBRA_LEVEL {
                let (ink, alpha) = if stripe_is_light(x as u32, y as u32) {
                    (255, STRIPE_LIGHT_ALPHA)
                } else {
                    (0, STRIPE_DARK_ALPHA)
                };
                out = out.map(|channel| over(channel, ink, alpha));
            }
            if peaking {
                let here = at(x, y);
                let sharp = [
                    (x > 0).then(|| at(x - 1, y)),
                    (x + 1 < width).then(|| at(x + 1, y)),
                    (y > 0).then(|| at(x, y - 1)),
                    (y + 1 < height).then(|| at(x, y + 1)),
                ]
                .into_iter()
                .flatten()
                .any(|neighbour| (neighbour - here).abs() > PEAKING_STEP);
                if sharp {
                    out = PEAKING_INK;
                }
            }
            out
        })
        .collect()
}

/// The numbers as HLSL constants, for the renderer's shader.
pub fn shader_numbers() -> String {
    format!(
        "static const float ZEBRA_LEVEL = {ZEBRA_LEVEL:?};\n\
         static const float PEAKING_STEP = {PEAKING_STEP:?};\n\
         static const int STRIPE_PERIOD = {STRIPE_PERIOD};\n\
         static const float STRIPE_LIGHT_ALPHA = {STRIPE_LIGHT_ALPHA}.0 / 255.0;\n\
         static const float STRIPE_DARK_ALPHA = {STRIPE_DARK_ALPHA}.0 / 255.0;\n\
         static const float3 PEAKING_INK = float3({}.0, {}.0, {}.0) / 255.0;\n\
         static const float GUIDE_WIDTH = {GUIDE_WIDTH:?};\n\
         static const float GUIDE_ALPHA = {GUIDE_ALPHA:?};\n\
         static const float CROSS_ARM = {CROSS_ARM:?};\n\
         static const float CROSS_ALPHA = {CROSS_ALPHA:?};\n\
         static const float MARKER_WIDTH = {MARKER_WIDTH:?};\n\
         static const float MARKER_ON = {:?};\n\
         static const float MARKER_PERIOD = {:?};\n",
        PEAKING_INK[0],
        PEAKING_INK[1],
        PEAKING_INK[2],
        MARKER_DASH[0],
        MARKER_DASH[0] + MARKER_DASH[1],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grey(value: u8) -> [u8; 3] {
        [value, value, value]
    }

    // The cases of `pictureAids.test.ts`, the page's reference.
    #[test]
    fn brightness_is_rec_709_luma_of_the_8_bit_values() {
        assert!((brightness([255, 255, 255]) - 1.0).abs() < 1e-12);
        assert_eq!(brightness([0, 0, 0]), 0.0);
        assert!((brightness([255, 0, 0]) - 0.2126).abs() < 1e-12);
        assert!((brightness([0, 255, 0]) - 0.7152).abs() < 1e-12);
        assert!((brightness([0, 0, 255]) - 0.0722).abs() < 1e-12);
    }

    #[test]
    fn the_zebras_mark_what_is_at_or_over_95_percent() {
        let picture = [grey(243), grey(242), grey(255), grey(0)];
        let out = lay_over(&picture, 4, 1, true, false);
        assert_ne!(out[0], picture[0], "243 of 255 is over 95 %");
        assert_eq!(out[1], picture[1], "242 of 255 is under");
        assert_eq!(out[3], picture[3]);
        // At (0, 0) the stripe is light: white at 230 of 255 over the grey,
        // which leaves white white.
        assert_eq!(out[2], grey(255));
        assert_eq!(out[0], grey(over(243, 255, 230)));
    }

    #[test]
    fn the_stripes_run_along_x_plus_y_eight_light_then_eight_dark() {
        assert!(stripe_is_light(0, 0));
        assert!(stripe_is_light(7, 0));
        assert!(!stripe_is_light(8, 0));
        assert!(!stripe_is_light(0, 15));
        assert!(stripe_is_light(9, 7));
        assert!(stripe_is_light(16, 0));
        let white = vec![grey(255); 16];
        let out = lay_over(&white, 16, 1, true, false);
        assert_eq!(out[7], grey(255), "light: white over white");
        assert_eq!(out[8], grey(over(255, 0, 153)), "dark: black at 153");
    }

    #[test]
    fn peaking_marks_both_sides_of_an_edge_over_the_step_and_not_a_slope() {
        // A step of 31 of 255 (0.1216) is sharp, one of 30 (0.1176) is not.
        let picture = [grey(100), grey(131), grey(131), grey(161)];
        let out = lay_over(&picture, 4, 1, false, true);
        assert_eq!(out[0], PEAKING_INK);
        assert_eq!(out[1], PEAKING_INK);
        assert_eq!(out[2], grey(131), "30 of 255 is not over the step");
        assert_eq!(out[3], grey(161));
        // Below, too; and nothing past the picture's edge counts.
        let column = [grey(0), grey(255)];
        assert_eq!(
            lay_over(&column, 1, 2, false, true),
            [PEAKING_INK, PEAKING_INK]
        );
        let slope: Vec<[u8; 3]> = (0..20).map(|step| grey(step * 10)).collect();
        assert_eq!(lay_over(&slope, 20, 1, false, true), slope);
    }

    #[test]
    fn peaking_is_laid_over_the_zebras() {
        let picture = [grey(255), grey(0)];
        let out = lay_over(&picture, 2, 1, true, true);
        assert_eq!(out, [PEAKING_INK, PEAKING_INK]);
    }

    #[test]
    fn the_shader_is_given_every_number() {
        let numbers = shader_numbers();
        for line in [
            "static const float ZEBRA_LEVEL = 0.95;",
            "static const float PEAKING_STEP = 0.12;",
            "static const int STRIPE_PERIOD = 16;",
            "static const float STRIPE_LIGHT_ALPHA = 230.0 / 255.0;",
            "static const float STRIPE_DARK_ALPHA = 153.0 / 255.0;",
            "static const float3 PEAKING_INK = float3(124.0, 196.0, 255.0) / 255.0;",
            "static const float GUIDE_WIDTH = 2.0;",
            "static const float GUIDE_ALPHA = 0.45;",
            "static const float CROSS_ARM = 30.0;",
            "static const float CROSS_ALPHA = 0.7;",
            "static const float MARKER_WIDTH = 3.0;",
            "static const float MARKER_ON = 14.0;",
            "static const float MARKER_PERIOD = 22.0;",
        ] {
            assert!(numbers.contains(line), "{line}\n{numbers}");
        }
    }
}
