//! What NDI's library hands over and is handed (D17, D31 to D33): its
//! structures and values as the SDK 6 lays them out for 64 bits, and the
//! rule for which video frame the helper takes. Kept apart from the calls
//! (`ndi_library.rs`) so it is compiled and tested on any system.
//!
//! The SDK's headers are in `%NDI_SDK_DIR%\Include` (`Processing.NDI.structs.h`,
//! `.Find.h`, `.Recv.h`). The throwaway receiver of 2026-09-30
//! (`exp1-ndi-receive.py` in the owner's plans folder) took every frame of
//! vMix's three outputs with the same structures.

// On a system without NDI (CI's Linux) nothing calls the library, so what
// only its calls use is unused there; it is compiled and tested all the same.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::picture::{MAX_FRAME_HEIGHT, MAX_FRAME_WIDTH};
use std::ffi::{c_char, c_int};
use std::ptr::{null, null_mut};
use studio_control_protocol::pictures::PictureFormat;

/// `NDIlib_recv_color_format_fastest`: UYVY for a source without alpha, as
/// the library decodes it fastest. It is given by name: a zero here would
/// ask for BGRA.
pub const COLOR_FORMAT_FASTEST: c_int = 100;
/// `NDIlib_recv_bandwidth_highest`: the whole picture. A zero would ask for
/// the small proxy.
pub const BANDWIDTH_HIGHEST: c_int = 100;

/// `NDIlib_frame_type_e`. Anything else (a change of status or of source)
/// holds nothing to free.
pub const FRAME_NONE: c_int = 0;
pub const FRAME_VIDEO: c_int = 1;
pub const FRAME_AUDIO: c_int = 2;
pub const FRAME_METADATA: c_int = 3;
pub const FRAME_ERROR: c_int = 4;

/// `NDIlib_frame_format_type_progressive`. With the fastest colour format an
/// interlaced source comes as single fields (2 and 3), which are refused.
pub const FORMAT_PROGRESSIVE: c_int = 1;

/// `NDIlib_FourCC_video_type_UYVY`: the letters U Y V Y, the first byte the
/// lowest.
pub const FOURCC_UYVY: u32 = u32::from_le_bytes(*b"UYVY");

/// `NDIlib_source_t`.
#[repr(C)]
pub struct Source {
    pub p_ndi_name: *const c_char,
    pub p_url_address: *const c_char,
}

/// `NDIlib_find_create_t`.
#[repr(C)]
pub struct FindCreate {
    pub show_local_sources: bool,
    pub p_groups: *const c_char,
    pub p_extra_ips: *const c_char,
}

impl FindCreate {
    /// The library's own search, with sources on this PC among those it
    /// lists, in no group of its own, and with no address of ours.
    pub fn this_pc() -> Self {
        Self {
            show_local_sources: true,
            p_groups: null(),
            p_extra_ips: null(),
        }
    }
}

/// `NDIlib_recv_create_v3_t`.
#[repr(C)]
pub struct RecvCreateV3 {
    pub source_to_connect_to: Source,
    pub color_format: c_int,
    pub bandwidth: c_int,
    pub allow_video_fields: bool,
    pub p_ndi_recv_name: *const c_char,
}

impl RecvCreateV3 {
    /// A receiver of the whole picture as UYVY from the source named, at the
    /// address the search gave. Fields are allowed, as the fastest format
    /// hands them over whatever this says, and refused frame by frame.
    pub fn whole_picture(
        name: *const c_char,
        url: *const c_char,
        receiver_name: *const c_char,
    ) -> Self {
        Self {
            source_to_connect_to: Source {
                p_ndi_name: name,
                p_url_address: url,
            },
            color_format: COLOR_FORMAT_FASTEST,
            bandwidth: BANDWIDTH_HIGHEST,
            allow_video_fields: true,
            p_ndi_recv_name: receiver_name,
        }
    }
}

/// `NDIlib_video_frame_v2_t`. Its stride is a union with the data's size,
/// which is the stride for UYVY.
#[repr(C)]
pub struct VideoFrameV2 {
    pub xres: c_int,
    pub yres: c_int,
    pub four_cc: u32,
    pub frame_rate_n: c_int,
    pub frame_rate_d: c_int,
    pub _picture_aspect_ratio: f32,
    pub frame_format_type: c_int,
    pub _timecode: i64,
    pub p_data: *mut u8,
    pub line_stride_in_bytes: c_int,
    pub _p_metadata: *const c_char,
    pub _timestamp: i64,
}

/// `NDIlib_audio_frame_v3_t`: taken and freed, never read.
#[repr(C)]
pub struct AudioFrameV3 {
    pub _sample_rate: c_int,
    pub _no_channels: c_int,
    pub _no_samples: c_int,
    pub _timecode: i64,
    pub _four_cc: u32,
    pub _p_data: *mut u8,
    pub _channel_stride_in_bytes: c_int,
    pub _p_metadata: *const c_char,
    pub _timestamp: i64,
}

/// `NDIlib_metadata_frame_t`: taken and freed, never read.
#[repr(C)]
pub struct MetadataFrame {
    pub _length: c_int,
    pub _timecode: i64,
    pub _p_data: *mut c_char,
}

/// `NDIlib_recv_performance_t`.
#[repr(C)]
#[derive(Default)]
pub struct Performance {
    pub video_frames: i64,
    pub _audio_frames: i64,
    pub _metadata_frames: i64,
}

/// `NDIlib_recv_queue_t`.
#[repr(C)]
#[derive(Default)]
pub struct Queue {
    pub video_frames: c_int,
    pub _audio_frames: c_int,
    pub _metadata_frames: c_int,
}

impl VideoFrameV2 {
    /// A frame for the library to fill.
    pub fn empty() -> Self {
        Self {
            xres: 0,
            yres: 0,
            four_cc: 0,
            frame_rate_n: 0,
            frame_rate_d: 0,
            _picture_aspect_ratio: 0.0,
            frame_format_type: 0,
            _timecode: 0,
            p_data: null_mut(),
            line_stride_in_bytes: 0,
            _p_metadata: null(),
            _timestamp: 0,
        }
    }

    /// What it says of itself, before a byte of its picture is read.
    pub fn header(&self) -> VideoHeader {
        VideoHeader {
            width: self.xres,
            height: self.yres,
            four_cc: self.four_cc,
            format_type: self.frame_format_type,
            stride: self.line_stride_in_bytes,
            rate_numerator: self.frame_rate_n,
            rate_denominator: self.frame_rate_d,
            has_data: !self.p_data.is_null(),
        }
    }
}

impl AudioFrameV3 {
    pub fn empty() -> Self {
        Self {
            _sample_rate: 0,
            _no_channels: 0,
            _no_samples: 0,
            _timecode: 0,
            _four_cc: 0,
            _p_data: null_mut(),
            _channel_stride_in_bytes: 0,
            _p_metadata: null(),
            _timestamp: 0,
        }
    }
}

impl MetadataFrame {
    pub fn empty() -> Self {
        Self {
            _length: 0,
            _timecode: 0,
            _p_data: null_mut(),
        }
    }
}

/// What one capture brought.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Captured {
    Video,
    Audio,
    Metadata,
    /// Nothing within the wait.
    Nothing,
    /// The library says the connection was lost.
    Lost,
    /// A change of status or of source, which holds nothing.
    Other(c_int),
}

/// What a video frame says of itself, as the library hands it over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoHeader {
    pub width: c_int,
    pub height: c_int,
    pub four_cc: u32,
    pub format_type: c_int,
    pub stride: c_int,
    pub rate_numerator: c_int,
    pub rate_denominator: c_int,
    pub has_data: bool,
}

/// A frame the helper takes: its size, its rows, and how many bytes of the
/// library's are read, the last row only to its own end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Checked {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub length: usize,
    pub format: PictureFormat,
}

/// A video frame as a receiver hands it on while the library holds it: taken
/// with its picture, or refused and why.
pub type Taken<'a> = Result<(Checked, &'a [u8]), String>;

/// The helper takes progressive 8-bit 4:2:2 (UYVY) with an even width, no
/// larger than 3840 × 2160, with every row inside its stride: what vMix's
/// outputs send. Anything else is refused, and said in the minute's line.
pub fn check_video(header: &VideoHeader) -> Result<Checked, String> {
    if !header.has_data {
        return Err(String::from("a frame without its picture"));
    }
    if header.format_type != FORMAT_PROGRESSIVE {
        return Err(format!(
            "a frame that is not progressive (type {})",
            header.format_type
        ));
    }
    if header.four_cc != FOURCC_UYVY {
        return Err(format!("a frame in {}", four_cc_words(header.four_cc)));
    }
    let size = |value: c_int, largest: u32| {
        u32::try_from(value)
            .ok()
            .filter(|value| (1..=largest).contains(value))
    };
    let (Some(width), Some(height)) = (
        size(header.width, MAX_FRAME_WIDTH),
        size(header.height, MAX_FRAME_HEIGHT),
    ) else {
        return Err(format!("a frame of {} × {}", header.width, header.height));
    };
    if width < 2 || !width.is_multiple_of(2) {
        return Err(format!("a frame {width} wide"));
    }
    let stride = u32::try_from(header.stride)
        .ok()
        .filter(|stride| (width * 2..=MAX_FRAME_WIDTH * 4).contains(stride))
        .ok_or_else(|| format!("rows of {} bytes for {width} pixels", header.stride))?;
    let rate = |value: c_int| u32::try_from(value).unwrap_or(0);
    Ok(Checked {
        width,
        height,
        stride,
        length: stride as usize * (height as usize - 1) + width as usize * 2,
        format: PictureFormat {
            width,
            height,
            rate_numerator: rate(header.rate_numerator),
            rate_denominator: rate(header.rate_denominator),
        },
    })
}

/// A FourCC as its four letters.
fn four_cc_words(code: u32) -> String {
    code.to_le_bytes()
        .iter()
        .map(|byte| {
            if byte.is_ascii_graphic() {
                char::from(*byte)
            } else {
                '?'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    // The sizes and places the 64-bit library expects, from the SDK's
    // headers' field order (the same as the throwaway receiver's, which the
    // library filled right for three outputs).
    #[test]
    fn the_structures_are_laid_out_as_the_sdk_s() {
        assert_eq!(size_of::<Source>(), 16);
        assert_eq!(size_of::<FindCreate>(), 24);
        assert_eq!(offset_of!(FindCreate, p_groups), 8);
        assert_eq!(size_of::<RecvCreateV3>(), 40);
        assert_eq!(offset_of!(RecvCreateV3, color_format), 16);
        assert_eq!(offset_of!(RecvCreateV3, bandwidth), 20);
        assert_eq!(offset_of!(RecvCreateV3, allow_video_fields), 24);
        assert_eq!(offset_of!(RecvCreateV3, p_ndi_recv_name), 32);
        assert_eq!(size_of::<VideoFrameV2>(), 72);
        assert_eq!(offset_of!(VideoFrameV2, frame_format_type), 24);
        assert_eq!(offset_of!(VideoFrameV2, _timecode), 32);
        assert_eq!(offset_of!(VideoFrameV2, p_data), 40);
        assert_eq!(offset_of!(VideoFrameV2, line_stride_in_bytes), 48);
        assert_eq!(offset_of!(VideoFrameV2, _p_metadata), 56);
        assert_eq!(offset_of!(VideoFrameV2, _timestamp), 64);
        assert_eq!(size_of::<AudioFrameV3>(), 64);
        assert_eq!(offset_of!(AudioFrameV3, _four_cc), 24);
        assert_eq!(offset_of!(AudioFrameV3, _p_data), 32);
        assert_eq!(offset_of!(AudioFrameV3, _channel_stride_in_bytes), 40);
        assert_eq!(offset_of!(AudioFrameV3, _timestamp), 56);
        assert_eq!(size_of::<MetadataFrame>(), 24);
        assert_eq!(offset_of!(MetadataFrame, _p_data), 16);
        assert_eq!(size_of::<Performance>(), 24);
        assert_eq!(size_of::<Queue>(), 12);
        assert_eq!(size_of::<bool>(), 1);
        assert_eq!(size_of::<*const c_char>(), 8, "a 64-bit build");
        assert_eq!(FOURCC_UYVY, 0x5956_5955);
        let settings = RecvCreateV3::whole_picture(null(), null(), null());
        assert_eq!(
            (settings.color_format, settings.bandwidth),
            (100, 100),
            "UYVY and the whole picture, both by name"
        );
    }

    fn header(width: c_int, height: c_int, stride: c_int) -> VideoHeader {
        VideoHeader {
            width,
            height,
            four_cc: FOURCC_UYVY,
            format_type: FORMAT_PROGRESSIVE,
            stride,
            rate_numerator: 30000,
            rate_denominator: 1001,
            has_data: true,
        }
    }

    #[test]
    fn a_frame_is_taken_when_it_is_progressive_uyvy_of_a_size_the_renderer_takes() {
        let taken = check_video(&header(3840, 2160, 7680)).expect("vMix's output");
        assert_eq!(
            (taken.width, taken.height, taken.stride, taken.length),
            (3840, 2160, 7680, 3840 * 2160 * 2)
        );
        assert_eq!(taken.format.words(), "3840 × 2160 · 29.97");
        let padded = check_video(&header(1920, 1080, 4096)).expect("rows with room to spare");
        assert_eq!(
            padded.length,
            4096 * 1079 + 3840,
            "the last row only to its end"
        );

        let refused = |mutate: &dyn Fn(&mut VideoHeader)| {
            let mut frame = header(1920, 1080, 3840);
            mutate(&mut frame);
            check_video(&frame).expect_err("refused")
        };
        assert!(refused(&|frame| frame.has_data = false).contains("without"));
        assert!(
            refused(&|frame| frame.format_type = 2).contains("progressive"),
            "a field"
        );
        assert!(
            refused(&|frame| frame.format_type = 0).contains("progressive"),
            "interleaved"
        );
        assert_eq!(
            refused(&|frame| frame.four_cc = u32::from_le_bytes(*b"UYVA")),
            "a frame in UYVA"
        );
        assert!(refused(&|frame| frame.four_cc = u32::from_le_bytes(*b"P216")).contains("P216"));
        for (width, height, stride) in [
            (0, 1080, 3840),
            (-2, 1080, 3840),
            (1920, 0, 3840),
            (1921, 1080, 3842),
            (3842, 2160, 7684),
            (3840, 2162, 7680),
            (1920, 1080, 3838),
            (1920, 1080, -3840),
            (1920, 1080, 15_361),
        ] {
            assert!(
                check_video(&header(width, height, stride)).is_err(),
                "{width} × {height}, {stride}"
            );
        }
        let no_rate = check_video(&VideoHeader {
            rate_numerator: -1,
            rate_denominator: 0,
            ..header(1920, 1080, 3840)
        })
        .expect("taken without a rate");
        assert_eq!(no_rate.format.words(), "1920 × 1080 · ?");
    }

    #[test]
    fn an_empty_frame_says_it_has_no_picture() {
        let empty = VideoFrameV2::empty();
        assert!(!empty.header().has_data);
        assert!(check_video(&empty.header()).is_err());
    }
}
