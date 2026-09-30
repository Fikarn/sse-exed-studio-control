//! The native picture layer's lines (the camera pictures, D30): what the
//! page tells the shell, and what the shell and the pictures helper say to
//! each other on the helper's secret-guarded connection.
//!
//! The helper draws the pictures itself, into one composition surface that
//! the shell puts topmost over the Cameras page's bay. The page is the one
//! authority for what is where: it reports the bay's box, the pictures it
//! shows and the holes to leave (`PlaceReport`, in CSS pixels). The shell
//! turns that into physical pixels (`placement`) and hands the helper a
//! `Scene`. No picture passes the shell or the page.
//!
//! On the connection, after the secret's line, each side writes one JSON
//! object a line, bounded as the helper's other lines are
//! (`pictures::MAX_LINE_BYTES`):
//!
//! - helper to shell: `hello`, with its process, so the shell can hand it a
//!   surface;
//! - shell to helper: `surface`, the handle as it is in the helper's process,
//!   and `scene`, at every change.

use serde::{Deserialize, Serialize};

/// The longest edge a surface or a rectangle may have, in physical pixels.
pub const MAX_PIXELS: u32 = 7680;
/// The pictures a scene may hold: the big one, the two small ones, the loupe.
pub const MAX_PICTURES: usize = 4;
/// The holes a scene may hold.
pub const MAX_HOLES: usize = 8;
/// The picture a part is a part of: what the helper draws every camera as.
pub const PICTURE_WIDTH: u32 = 1920;
pub const PICTURE_HEIGHT: u32 = 1080;

/// A rectangle in CSS pixels of the page.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A part of a camera's picture, in the picture's own pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Part {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// One picture as the page shows it.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct ReportedPicture {
    /// 1, 2 or 3.
    pub camera: u8,
    /// Where it stands in the window.
    pub at: CssRect,
    pub part: Part,
    /// Smoothed when scaled; the loupe shows each pixel as it is.
    pub smooth: bool,
}

/// What the page reports, at every change and once a second.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceReport {
    /// The page shows the pictures now: no dialog over them, the document
    /// visible.
    pub showing: bool,
    /// Physical pixels a CSS pixel (`devicePixelRatio`).
    pub scale: f64,
    /// The Cameras bay's box: the surface covers it and nothing else.
    pub bay: CssRect,
    pub pictures: Vec<ReportedPicture>,
    /// What the page draws over a picture's place: left clear by the helper.
    pub holes: Vec<CssRect>,
}

/// A rectangle in physical pixels of the surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// A picture's rectangle in physical pixels of the surface. It may reach
/// past the surface's edges: the page's bay cuts a picture off where it
/// overflows, and the surface, which is the bay, cuts it off there too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PictureRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// One picture of a scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlacedPicture {
    pub camera: u8,
    pub at: PictureRect,
    pub part: Part,
    pub smooth: bool,
}

/// What the helper draws: the surface's size, the pictures in it and the
/// holes in them, all in the surface's own physical pixels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    pub pictures: Vec<PlacedPicture>,
    pub holes: Vec<PixelRect>,
}

/// Where the surface stands in the window, in physical pixels, and what is
/// drawn in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub scene: Scene,
}

/// A line from the helper to the shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FromLayerHelper {
    /// Its process, right after the secret's line.
    Hello { pid: u32 },
}

/// A line from the shell to the helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToLayerHelper {
    /// A composition surface made for this connection: the handle's value in
    /// the helper's own process.
    Surface {
        handle: u64,
    },
    Scene(Scene),
}

/// An edge in CSS pixels as a physical pixel. Both edges of a rectangle are
/// rounded, not its size, so neighbours meet without a gap or an overlap.
fn edge(css: f64, scale: f64) -> Option<i64> {
    let physical = (css * scale).round();
    (physical.is_finite() && physical.abs() <= f64::from(MAX_PIXELS) * 4.0)
        .then_some(physical as i64)
}

/// A CSS rectangle's physical edges: left, top, right, bottom.
fn edges(rect: &CssRect, scale: f64) -> Option<(i64, i64, i64, i64)> {
    Some((
        edge(rect.x, scale)?,
        edge(rect.y, scale)?,
        edge(rect.x + rect.width, scale)?,
        edge(rect.y + rect.height, scale)?,
    ))
}

/// A rectangle inside the surface, clipped to it; `None` when nothing of it
/// is inside.
fn inside(
    (left, top, right, bottom): (i64, i64, i64, i64),
    origin: (i64, i64),
    size: (u32, u32),
) -> Option<PixelRect> {
    let left = (left - origin.0).clamp(0, i64::from(size.0));
    let top = (top - origin.1).clamp(0, i64::from(size.1));
    let right = (right - origin.0).clamp(0, i64::from(size.0));
    let bottom = (bottom - origin.1).clamp(0, i64::from(size.1));
    (right > left && bottom > top).then(|| PixelRect {
        x: left as u32,
        y: top as u32,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    })
}

/// A part that lies inside the picture and is not empty.
fn part_fits(part: &Part) -> bool {
    part.width > 0
        && part.height > 0
        && part
            .x
            .checked_add(part.width)
            .is_some_and(|right| right <= PICTURE_WIDTH)
        && part
            .y
            .checked_add(part.height)
            .is_some_and(|bottom| bottom <= PICTURE_HEIGHT)
}

/// The page's report in physical pixels: `None` when the page shows no
/// picture, or when the report is not one a page would make (a scale or a
/// bay that is not a number, a bay with no size or too large). A picture of
/// a camera that is not one of the three, with a part outside the picture,
/// or that lies wholly outside the bay is left out, and so is a hole outside
/// the bay; more than the scene holds are left out too. A picture the bay
/// cuts keeps its whole rectangle, so its part stays the part drawn.
pub fn placement(report: &PlaceReport) -> Option<Placement> {
    if !report.showing || !report.scale.is_finite() || report.scale <= 0.0 || report.scale > 8.0 {
        return None;
    }
    let (left, top, right, bottom) = edges(&report.bay, report.scale)?;
    let width = u32::try_from(right - left)
        .ok()
        .filter(|width| (1..=MAX_PIXELS).contains(width))?;
    let height = u32::try_from(bottom - top)
        .ok()
        .filter(|height| (1..=MAX_PIXELS).contains(height))?;
    let origin = (left, top);
    let size = (width, height);
    let pictures = report
        .pictures
        .iter()
        .filter(|picture| (1..=3).contains(&picture.camera) && part_fits(&picture.part))
        .filter_map(|picture| {
            let (left, top, right, bottom) = edges(&picture.at, report.scale)?;
            // Some of it inside the bay, or nothing to draw.
            inside((left, top, right, bottom), origin, size)?;
            let length = |length: i64| {
                u32::try_from(length)
                    .ok()
                    .filter(|length| (1..=MAX_PIXELS).contains(length))
            };
            Some(PlacedPicture {
                camera: picture.camera,
                at: PictureRect {
                    x: i32::try_from(left - origin.0).ok()?,
                    y: i32::try_from(top - origin.1).ok()?,
                    width: length(right - left)?,
                    height: length(bottom - top)?,
                },
                part: picture.part,
                smooth: picture.smooth,
            })
        })
        .take(MAX_PICTURES)
        .collect::<Vec<_>>();
    if pictures.is_empty() {
        return None;
    }
    let holes = report
        .holes
        .iter()
        .filter_map(|hole| inside(edges(hole, report.scale)?, origin, size))
        .take(MAX_HOLES)
        .collect();
    Some(Placement {
        x: i32::try_from(left).ok()?,
        y: i32::try_from(top).ok()?,
        scene: Scene {
            width,
            height,
            pictures,
            holes,
        },
    })
}

impl Scene {
    /// A scene as the helper takes it: a size a surface may have, at most
    /// `MAX_PICTURES` pictures and `MAX_HOLES` holes, each hole inside the
    /// surface, each picture partly inside it at least, of one of the three
    /// cameras, with a part inside the picture.
    pub fn check(&self) -> Result<(), String> {
        if !(1..=MAX_PIXELS).contains(&self.width) || !(1..=MAX_PIXELS).contains(&self.height) {
            return Err(format!("a surface of {} × {}", self.width, self.height));
        }
        if self.pictures.len() > MAX_PICTURES || self.holes.len() > MAX_HOLES {
            return Err(format!(
                "{} pictures and {} holes",
                self.pictures.len(),
                self.holes.len()
            ));
        }
        let fits = |rect: &PixelRect| {
            rect.width > 0
                && rect.height > 0
                && rect
                    .x
                    .checked_add(rect.width)
                    .is_some_and(|right| right <= self.width)
                && rect
                    .y
                    .checked_add(rect.height)
                    .is_some_and(|bottom| bottom <= self.height)
        };
        let shows = |rect: &PictureRect| {
            let across = |at: i32, length: u32, room: u32| {
                (1..=MAX_PIXELS).contains(&length)
                    && i64::from(at) < i64::from(room)
                    && i64::from(at) + i64::from(length) > 0
            };
            across(rect.x, rect.width, self.width) && across(rect.y, rect.height, self.height)
        };
        for picture in &self.pictures {
            if !(1..=3).contains(&picture.camera) {
                return Err(format!("camera {}", picture.camera));
            }
            if !shows(&picture.at) || !part_fits(&picture.part) {
                return Err(format!("CAM {}'s picture does not fit", picture.camera));
            }
        }
        if self.holes.iter().any(|hole| !fits(hole)) {
            return Err(String::from("a hole outside the surface"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pictures::{from_line, to_line, MAX_LINE_BYTES};

    fn css(x: f64, y: f64, width: f64, height: f64) -> CssRect {
        CssRect {
            x,
            y,
            width,
            height,
        }
    }

    const WHOLE: Part = Part {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    /// The Cameras page at 2560 × 1440: the bay, the big picture, a small one
    /// with its chip, and the loupe.
    fn report(scale: f64) -> PlaceReport {
        PlaceReport {
            showing: true,
            scale,
            bay: css(428.0, 76.0, 1712.0, 1344.0),
            pictures: vec![
                ReportedPicture {
                    camera: 1,
                    at: css(444.0, 138.0, 1680.0, 945.0),
                    part: WHOLE,
                    smooth: true,
                },
                ReportedPicture {
                    camera: 2,
                    at: css(444.0, 1095.0, 544.0, 306.0),
                    part: WHOLE,
                    smooth: true,
                },
                ReportedPicture {
                    camera: 1,
                    at: css(1556.0, 1129.0, 568.0, 272.0),
                    part: Part {
                        x: 818,
                        y: 472,
                        width: 284,
                        height: 136,
                    },
                    smooth: false,
                },
            ],
            holes: vec![css(454.0, 1105.0, 120.0, 28.0)],
        }
    }

    #[test]
    fn a_report_at_scale_one_is_the_same_numbers_from_the_bay_s_corner() {
        let placed = placement(&report(1.0)).expect("a placement");
        assert_eq!((placed.x, placed.y), (428, 76));
        assert_eq!((placed.scene.width, placed.scene.height), (1712, 1344));
        assert_eq!(
            placed.scene.pictures[0].at,
            PictureRect {
                x: 16,
                y: 62,
                width: 1680,
                height: 945
            }
        );
        assert_eq!(placed.scene.pictures[2].part.width, 284);
        assert!(!placed.scene.pictures[2].smooth);
        assert_eq!(
            placed.scene.holes,
            [PixelRect {
                x: 26,
                y: 1029,
                width: 120,
                height: 28
            }]
        );
        assert_eq!(placed.scene.check(), Ok(()));
    }

    #[test]
    fn both_edges_are_rounded_so_neighbours_meet() {
        // At 125 % an edge at 444.5 CSS pixels is 555.625: 556. A rectangle
        // that ends where the next begins shares that pixel edge.
        let mut at_125 = report(1.25);
        at_125.pictures = vec![
            ReportedPicture {
                camera: 1,
                at: css(444.5, 100.0, 100.0, 50.0),
                part: WHOLE,
                smooth: true,
            },
            ReportedPicture {
                camera: 2,
                at: css(544.5, 100.0, 100.3, 50.0),
                part: WHOLE,
                smooth: true,
            },
        ];
        at_125.holes.clear();
        let placed = placement(&at_125).expect("a placement");
        assert_eq!((placed.x, placed.y), (535, 95));
        let [first, second] = placed.scene.pictures[..] else {
            panic!("two pictures")
        };
        assert_eq!(
            i64::from(first.at.x) + i64::from(first.at.width),
            i64::from(second.at.x)
        );
        assert_eq!((first.at.x, first.at.width), (21, 125));
        assert_eq!(placed.scene.width, 2140);
    }

    #[test]
    fn a_report_that_shows_nothing_places_nothing() {
        let mut hidden = report(1.0);
        hidden.showing = false;
        assert_eq!(placement(&hidden), None);
        let mut empty = report(1.0);
        empty.pictures.clear();
        assert_eq!(placement(&empty), None, "no picture, no layer");
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY, 9.0] {
            assert_eq!(placement(&report(scale)), None, "scale {scale}");
        }
        let mut no_bay = report(1.0);
        no_bay.bay = css(0.0, 0.0, 0.0, 100.0);
        assert_eq!(placement(&no_bay), None);
        let mut huge = report(1.0);
        huge.bay = css(0.0, 0.0, 9000.0, 100.0);
        assert_eq!(placement(&huge), None);
        let mut not_a_number = report(1.0);
        not_a_number.bay = css(f64::NAN, 0.0, 100.0, 100.0);
        assert_eq!(placement(&not_a_number), None);
    }

    #[test]
    fn what_does_not_fit_is_left_out() {
        let mut odd = report(1.0);
        odd.pictures[0].camera = 4;
        odd.pictures[1].part = Part {
            x: 1000,
            y: 0,
            width: 1000,
            height: 1080,
        };
        // The loupe pushed wholly out of the bay.
        odd.pictures[2].at = css(2140.0, 1129.0, 568.0, 272.0);
        odd.pictures.push(ReportedPicture {
            camera: 3,
            at: css(1000.0, 1095.0, 544.0, 306.0),
            part: WHOLE,
            smooth: true,
        });
        odd.holes = vec![css(0.0, 0.0, 10.0, 10.0), css(2100.0, 1400.0, 100.0, 100.0)];
        let placed = placement(&odd).expect("one picture is left");
        assert_eq!(placed.scene.pictures.len(), 1);
        assert_eq!(placed.scene.pictures[0].camera, 3);
        assert_eq!(
            placed.scene.holes,
            [PixelRect {
                x: 1672,
                y: 1324,
                width: 40,
                height: 20
            }],
            "a hole outside the bay goes; one half inside is clipped"
        );
        let mut many = report(1.0);
        many.pictures = vec![many.pictures[0]; 9];
        many.holes = vec![css(500.0, 200.0, 10.0, 10.0); 20];
        let placed = placement(&many).expect("a placement");
        assert_eq!(placed.scene.pictures.len(), MAX_PICTURES);
        assert_eq!(placed.scene.holes.len(), MAX_HOLES);
    }

    // The Cameras page as it stands at 2560 × 1440: the small pictures and
    // the loupe reach 13 px below the bay, whose overflow is hidden. The
    // surface is the bay, so it cuts them off where the page does, and each
    // keeps its whole rectangle and its part.
    #[test]
    fn a_picture_the_bay_cuts_is_drawn_whole_and_cut_by_the_surface() {
        let mut cut = report(1.0);
        cut.bay = css(440.0, 72.0, 1688.0, 1312.0);
        cut.pictures = vec![
            ReportedPicture {
                camera: 2,
                at: css(444.0, 1091.0, 544.0, 306.0),
                part: WHOLE,
                smooth: true,
            },
            ReportedPicture {
                camera: 1,
                at: css(1556.0, 1125.0, 568.0, 272.0),
                part: Part {
                    x: 818,
                    y: 472,
                    width: 284,
                    height: 136,
                },
                smooth: false,
            },
            // One that starts above and left of the bay.
            ReportedPicture {
                camera: 3,
                at: css(400.0, 50.0, 544.0, 306.0),
                part: WHOLE,
                smooth: true,
            },
        ];
        let placed = placement(&cut).expect("a placement");
        assert_eq!(
            placed
                .scene
                .pictures
                .iter()
                .map(|picture| picture.at)
                .collect::<Vec<_>>(),
            [
                PictureRect {
                    x: 4,
                    y: 1019,
                    width: 544,
                    height: 306
                },
                PictureRect {
                    x: 1116,
                    y: 1053,
                    width: 568,
                    height: 272
                },
                PictureRect {
                    x: -40,
                    y: -22,
                    width: 544,
                    height: 306
                },
            ]
        );
        assert_eq!(placed.scene.pictures[1].part.height, 136);
        assert_eq!(placed.scene.check(), Ok(()));
    }

    #[test]
    fn the_page_s_report_is_read_as_the_page_writes_it() {
        let read: PlaceReport = serde_json::from_str(
            r#"{"showing":true,"scale":1,"bay":{"x":428,"y":76,"width":1712,"height":1344},
                "pictures":[{"camera":1,"at":{"x":444,"y":138,"width":1680,"height":945},
                "part":{"x":0,"y":0,"width":1920,"height":1080},"smooth":true}],"holes":[]}"#,
        )
        .expect("a report");
        assert_eq!(read.pictures[0].at, css(444.0, 138.0, 1680.0, 945.0));
        assert!(serde_json::from_str::<PlaceReport>(r#"{"showing":true}"#).is_err());
    }

    #[test]
    fn the_link_s_lines_have_one_shape_both_ways() {
        let hello = FromLayerHelper::Hello { pid: 4242 };
        assert_eq!(to_line(&hello), r#"{"type":"hello","pid":4242}"#);
        assert_eq!(from_line::<FromLayerHelper>(&to_line(&hello)), Ok(hello));

        let surface = ToLayerHelper::Surface { handle: 0x1f4 };
        assert_eq!(to_line(&surface), r#"{"type":"surface","handle":500}"#);
        assert_eq!(from_line::<ToLayerHelper>(&to_line(&surface)), Ok(surface));

        let scene = placement(&report(1.0)).expect("a placement").scene;
        let line = to_line(&ToLayerHelper::Scene(scene.clone()));
        assert!(
            line.starts_with(r#"{"type":"scene","width":1712,"height":1344,"pictures":[{"camera":1,"at":{"x":16,"y":62,"width":1680,"height":945},"part":{"x":0,"y":0,"width":1920,"height":1080},"smooth":true},"#),
            "{line}"
        );
        assert_eq!(
            from_line::<ToLayerHelper>(&line),
            Ok(ToLayerHelper::Scene(scene))
        );
        assert!(from_line::<ToLayerHelper>(r#"{"type":"frame"}"#).is_err());
        assert!(from_line::<FromLayerHelper>(r#"{"type":"hello","pid":-1}"#).is_err());
    }

    #[test]
    fn the_fullest_scene_fits_a_line() {
        let rect = PixelRect {
            x: MAX_PIXELS - 1,
            y: MAX_PIXELS - 1,
            width: MAX_PIXELS,
            height: MAX_PIXELS,
        };
        let far = PictureRect {
            x: -(MAX_PIXELS as i32) + 1,
            y: -(MAX_PIXELS as i32) + 1,
            width: MAX_PIXELS,
            height: MAX_PIXELS,
        };
        let scene = Scene {
            width: MAX_PIXELS,
            height: MAX_PIXELS,
            pictures: vec![
                PlacedPicture {
                    camera: 3,
                    at: far,
                    part: Part {
                        x: 1919,
                        y: 1079,
                        width: 1920,
                        height: 1080
                    },
                    smooth: false
                };
                MAX_PICTURES
            ],
            holes: vec![rect; MAX_HOLES],
        };
        let line = to_line(&ToLayerHelper::Scene(scene));
        assert!(line.len() < MAX_LINE_BYTES / 2, "{} bytes", line.len());
    }

    #[test]
    fn a_scene_is_held_to_what_a_surface_can_show() {
        let good = placement(&report(1.0)).expect("a placement").scene;
        assert_eq!(good.check(), Ok(()));
        let broken = |change: &dyn Fn(&mut Scene)| {
            let mut scene = good.clone();
            change(&mut scene);
            scene.check().is_err()
        };
        assert!(broken(&|scene| scene.width = 0));
        assert!(broken(&|scene| scene.height = MAX_PIXELS + 1));
        assert!(broken(&|scene| scene.pictures[0].camera = 0));
        assert!(broken(&|scene| scene.pictures[0].at.width = MAX_PIXELS + 1));
        assert!(broken(&|scene| scene.pictures[0].at.height = 0));
        assert!(broken(&|scene| scene.pictures[0].at.x = i32::MAX));
        // Wholly outside the surface, by a pixel.
        assert!(broken(&|scene| scene.pictures[0].at.x = -1680));
        assert!(broken(&|scene| scene.pictures[0].at.y = 1344));
        assert!(broken(&|scene| scene.pictures[0].part.width = 0));
        assert!(broken(&|scene| scene.pictures[0].part.y = 1));
        assert!(broken(&|scene| scene.holes[0].height = 0));
        assert!(broken(
            &|scene| scene.pictures = vec![scene.pictures[0]; MAX_PICTURES + 1]
        ));
        assert!(broken(
            &|scene| scene.holes = vec![scene.holes[0]; MAX_HOLES + 1]
        ));
    }
}
