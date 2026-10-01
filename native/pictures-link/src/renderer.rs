//! The pictures drawn on the graphics card (the camera pictures, D30), into
//! the composition surface the shell made for this process and put over the
//! Cameras page (`shell_picture_layer.rs` in the shell).
//!
//! Each camera's newest frame is uploaded once, as it arrives: UYVY, two
//! pixels in a texel. A frame drawn before (a draw between two of vMix's
//! frames) is drawn again from its picture, not uploaded again. One pass turns it into the camera's picture, 1920 ×
//! 1080 in RGB (BT.709, video range), whatever size the frame has: a frame of
//! 3840 × 2160 is averaged down to it, so the page's 1:1 view and its loupe
//! mean what they say. A second pass draws each place of the scene from that
//! picture: the part the page asked for, smoothed or pixel for pixel, with
//! the aids the page asked for over it (`aids.rs`, the page's numbers):
//! zebras and peaking worked out at the picture's pixel under each of the
//! surface's, as the page's shader does, and the guides and the loupe's
//! marker as lines in the picture's pixels. Holes are cleared again, and
//! everything else in the surface stays clear, so the page shows through
//! around the pictures. One present shows them all.
//!
//! The shell does no work per frame, and no picture leaves this process.

use crate::aids;
use crate::picture::Picture;
use std::time::{Duration, Instant};
use studio_control_protocol::picture_layer::{
    Part, PlacedPicture, Scene, PICTURE_HEIGHT, PICTURE_WIDTH,
};
use windows::core::{s, Interface, PCSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE};
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D::{
    ID3DBlob, ID3DInclude, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST, D3D_DRIVER_TYPE,
    D3D_DRIVER_TYPE_HARDWARE,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Buffer, ID3D11Device, ID3D11DeviceContext, ID3D11PixelShader,
    ID3D11RenderTargetView, ID3D11SamplerState, ID3D11ShaderResourceView, ID3D11Texture2D,
    ID3D11VertexShader, D3D11_BIND_CONSTANT_BUFFER, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_BUFFER_DESC, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_FILTER,
    D3D11_FILTER_MIN_MAG_MIP_LINEAR, D3D11_FILTER_MIN_MAG_MIP_POINT, D3D11_FLOAT32_MAX,
    D3D11_RESOURCE_MISC_GENERATE_MIPS, D3D11_SAMPLER_DESC, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_TEXTURE_ADDRESS_CLAMP, D3D11_USAGE_DEFAULT, D3D11_VIEWPORT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_PREMULTIPLIED, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM,
    DXGI_FORMAT_UNKNOWN, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactoryMedia, IDXGISwapChain1, DXGI_PRESENT, DXGI_SCALING_STRETCH,
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_CHAIN_FLAG, DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
    DXGI_USAGE_RENDER_TARGET_OUTPUT,
};

/// The shaders, the aids' numbers first (`aids::shader_numbers`).
fn shaders() -> String {
    format!("{}{SHADERS}", aids::shader_numbers())
}

/// The shaders' code. `ps_convert` writes one pixel of the 1920 × 1080
/// picture from the frame's UYVY: `taps` samples each way, spread over what
/// the pixel covers of the frame (one for a frame of the picture's size, two
/// for one of twice it). `ps_place` draws a part of the picture into a place
/// (`whole`, in the picture's pixels, into `view` of the surface's), and lays
/// the aids over it: zebras and peaking from the picture's pixel under each
/// of the surface's, as `pictureDrawer.ts` does; then the guides and the
/// marker, each the share of the surface's pixel that its line covers, as a
/// canvas strokes them.
const SHADERS: &str = r"
cbuffer Constants : register(b0) {
    float4 whole;
    float4 marker;
    float2 view;
    float2 source;
    float2 taps;
    uint aids;
    uint spare;
};
static const float2 PICTURE = float2(1920.0, 1080.0);
static const uint GUIDES = 1;
static const uint ZEBRAS = 2;
static const uint PEAKING = 4;
static const uint MARKER = 8;
Texture2D<float4> frame : register(t0);
SamplerState how : register(s0);
struct Out { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
Out vs(uint id : SV_VertexID) {
    Out o;
    float2 uv = float2((id << 1) & 2, id & 2);
    o.uv = uv;
    o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
    return o;
}
float3 rgb_at(int2 p) {
    float4 t = frame.Load(int3(p.x >> 1, p.y, 0)) * 255.0;
    float y = (p.x & 1) ? t.a : t.g;
    float Y = (y - 16.0) / 219.0;
    float Cb = (t.r - 128.0) / 224.0;
    float Cr = (t.b - 128.0) / 224.0;
    return saturate(float3(Y + 1.5748 * Cr, Y - 0.1873 * Cb - 0.4681 * Cr, Y + 1.8556 * Cb));
}
float4 ps_convert(Out i) : SV_Target {
    float2 ratio = source / float2(1920.0, 1080.0);
    float2 corner = floor(i.pos.xy);
    int2 last = int2(source) - int2(1, 1);
    float3 sum = float3(0, 0, 0);
    int across = (int)taps.x;
    int down = (int)taps.y;
    for (int b = 0; b < down; b++) {
        for (int a = 0; a < across; a++) {
            float2 at = (corner + (float2(a, b) + 0.5) / taps) * ratio;
            sum += rgb_at(clamp(int2(floor(at)), int2(0, 0), last));
        }
    }
    return float4(sum / (taps.x * taps.y), 1);
}
float brightness(float3 rgb) {
    return dot(rgb, float3(0.2126, 0.7152, 0.0722));
}
float level_at(int2 p) {
    return brightness(frame.Load(int3(p, 0)).rgb);
}
// The share of a pixel `reach` either side of `at` that `from` to `to`
// covers, along one axis.
float cover(float at, float reach, float from, float to) {
    return saturate((min(at + reach, to) - max(at - reach, from)) / (2.0 * reach));
}
// The marker's dashes: on for MARKER_ON of each MARKER_PERIOD along the
// frame, from its top left corner, clockwise.
float dash(float along) {
    return fmod(max(along, 0.0), MARKER_PERIOD) < MARKER_ON ? 1.0 : 0.0;
}
float marker_cover(float2 at, float2 reach) {
    float w = MARKER_WIDTH * 0.5;
    float left = marker.x;
    float top = marker.y;
    float right = marker.x + marker.z;
    float bottom = marker.y + marker.w;
    float across = cover(at.x, reach.x, left - w, right + w);
    float down = cover(at.y, reach.y, top - w, bottom + w);
    float shown = across * cover(at.y, reach.y, top - w, top + w) * dash(at.x - left);
    shown = max(shown, cover(at.x, reach.x, right - w, right + w) * down * dash(marker.z + at.y - top));
    shown = max(shown, across * cover(at.y, reach.y, bottom - w, bottom + w)
        * dash(marker.z + marker.w + right - at.x));
    shown = max(shown, cover(at.x, reach.x, left - w, left + w) * down
        * dash(2.0 * marker.z + marker.w + bottom - at.y));
    return shown;
}
float4 ps_place(Out i) : SV_Target {
    float2 at = whole.xy + i.uv * whole.zw;
    float3 rgb = frame.Sample(how, at / PICTURE).rgb;
    int2 last = int2(PICTURE) - int2(1, 1);
    int2 pixel = clamp(int2(floor(at)), int2(0, 0), last);
    if ((aids & ZEBRAS) != 0 && level_at(pixel) >= ZEBRA_LEVEL) {
        bool light = ((pixel.x + pixel.y) % STRIPE_PERIOD) < STRIPE_PERIOD / 2;
        rgb = light ? lerp(rgb, (float3)1.0, STRIPE_LIGHT_ALPHA) : lerp(rgb, (float3)0.0, STRIPE_DARK_ALPHA);
    }
    if ((aids & PEAKING) != 0) {
        float here = level_at(pixel);
        bool sharp =
            (pixel.x < last.x && abs(level_at(pixel + int2(1, 0)) - here) > PEAKING_STEP) ||
            (pixel.x > 0 && abs(level_at(pixel - int2(1, 0)) - here) > PEAKING_STEP) ||
            (pixel.y < last.y && abs(level_at(pixel + int2(0, 1)) - here) > PEAKING_STEP) ||
            (pixel.y > 0 && abs(level_at(pixel - int2(0, 1)) - here) > PEAKING_STEP);
        if (sharp) {
            rgb = PEAKING_INK;
        }
    }
    // Half a pixel of the surface, in the picture's pixels.
    float2 reach = 0.5 * whole.zw / view;
    if ((aids & GUIDES) != 0) {
        float w = GUIDE_WIDTH * 0.5;
        float2 third = PICTURE / 3.0;
        float upright = cover(at.x, reach.x, third.x - w, third.x + w)
            + cover(at.x, reach.x, 2.0 * third.x - w, 2.0 * third.x + w);
        float level = cover(at.y, reach.y, third.y - w, third.y + w)
            + cover(at.y, reach.y, 2.0 * third.y - w, 2.0 * third.y + w);
        // One path: where two lines cross, it is drawn once.
        float thirds = 1.0 - (1.0 - saturate(upright)) * (1.0 - saturate(level));
        rgb = lerp(rgb, (float3)1.0, GUIDE_ALPHA * thirds);
        float2 centre = PICTURE * 0.5;
        float lying = cover(at.x, reach.x, centre.x - CROSS_ARM, centre.x + CROSS_ARM)
            * cover(at.y, reach.y, centre.y - w, centre.y + w);
        float standing = cover(at.x, reach.x, centre.x - w, centre.x + w)
            * cover(at.y, reach.y, centre.y - CROSS_ARM, centre.y + CROSS_ARM);
        rgb = lerp(rgb, (float3)1.0, CROSS_ALPHA * (1.0 - (1.0 - lying) * (1.0 - standing)));
    }
    if ((aids & MARKER) != 0) {
        rgb = lerp(rgb, (float3)1.0, marker_cover(at, reach));
    }
    return float4(rgb, 1);
}
float4 ps_clear(Out i) : SV_Target {
    return float4(0, 0, 0, 0);
}
";

/// How many samples each way `ps_convert` takes of a frame for one pixel of
/// the picture: one where the frame is no larger than the picture, else as
/// many as the frame has pixels for one of the picture's, at most four.
fn taps(frame: u32, picture: u32) -> u32 {
    frame.div_ceil(picture).clamp(1, 4)
}

/// What the shaders are told for one draw, laid out as `cbuffer Constants`.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Constants {
    /// The part of the picture a place shows, in the picture's pixels.
    whole: [f32; 4],
    /// Where the loupe looks, in the picture's pixels.
    marker: [f32; 4],
    /// The place's size, in the surface's pixels.
    view: [f32; 2],
    /// The frame's size, and the samples each way (the convert pass).
    source: [f32; 2],
    taps: [f32; 2],
    /// The aids drawn over the place (`aid_bits`).
    aids: u32,
    spare: u32,
}

/// A place's aids as the shader reads them: 1 the guides, 2 the zebras, 4
/// the peaking, 8 the marker.
fn aid_bits(placed: &PlacedPicture) -> u32 {
    u32::from(placed.guides)
        | u32::from(placed.zebras) << 1
        | u32::from(placed.peaking) << 2
        | u32::from(placed.marker.is_some()) << 3
}

/// A rectangle of the picture as the shader reads it.
fn rect(part: &Part) -> [f32; 4] {
    [
        part.x as f32,
        part.y as f32,
        part.width as f32,
        part.height as f32,
    ]
}

/// A camera's frame on the graphics card: UYVY, two pixels in a texel.
struct Source {
    texture: ID3D11Texture2D,
    view: ID3D11ShaderResourceView,
    width: u32,
    height: u32,
}

/// A camera's picture: 1920 × 1080 in RGB, with its smaller copies for the
/// small places.
struct Converted {
    target: ID3D11RenderTargetView,
    view: ID3D11ShaderResourceView,
}

/// The swap chain on the shell's surface, at the scene's size.
struct Chain {
    chain: IDXGISwapChain1,
    target: Option<ID3D11RenderTargetView>,
    width: u32,
    height: u32,
}

pub struct Renderer {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    vertex: ID3D11VertexShader,
    convert: ID3D11PixelShader,
    place: ID3D11PixelShader,
    clear: ID3D11PixelShader,
    smooth: ID3D11SamplerState,
    pixels: ID3D11SamplerState,
    constants: ID3D11Buffer,
    sources: [Option<Source>; 3],
    converted: [Option<Converted>; 3],
    /// The count of the frame each camera's picture holds.
    holds: [Option<u64>; 3],
    /// This process's own copy of the shell's surface handle; none for a
    /// renderer that draws into a texture of its own (the tests).
    surface: Option<HANDLE>,
    chain: Option<Chain>,
}

fn error(context: &str, error: &windows::core::Error) -> String {
    format!("{context}: {error}")
}

impl Renderer {
    /// Opens the renderer on the surface the shell handed to this process
    /// (`surface` is this process's value of the handle). The swap chain is
    /// made at the first scene, whose size it takes.
    pub fn open(surface: u64) -> Result<Self, String> {
        let surface = HANDLE(surface as usize as _);
        let made = open_with(Some(surface), D3D_DRIVER_TYPE_HARDWARE);
        if made.is_err() {
            // The handle is this process's to close, renderer or none.
            close_surface(surface);
        }
        made
    }

    /// Draws `scene` from the cameras' newest frames and presents it; returns
    /// how long the present took. A camera with no frame leaves its places
    /// clear, and so does one whose frame the renderer cannot take.
    pub fn draw(
        &mut self,
        scene: &Scene,
        pictures: &[Option<Picture<'_>>; 3],
    ) -> Result<Duration, String> {
        match self.chain.as_mut() {
            Some(chain) if (chain.width, chain.height) == (scene.width, scene.height) => {}
            Some(chain) => resize_chain(
                &self.device,
                &self.context,
                chain,
                scene.width,
                scene.height,
            )?,
            None => self.chain = Some(open_chain(self, scene.width, scene.height)?),
        }
        let drawn = self.convert_all(scene, pictures)?;
        let chain = self.chain.as_ref().ok_or("no swap chain")?;
        let target = chain.target.clone().ok_or("no render target")?;
        compose(self, &target, scene, &drawn);
        present(&chain.chain)
    }

    /// Turns each shown camera's newest frame into its picture, unless the
    /// picture holds that frame already: which cameras have one to draw.
    fn convert_all(
        &mut self,
        scene: &Scene,
        pictures: &[Option<Picture<'_>>; 3],
    ) -> Result<[bool; 3], String> {
        let mut drawn = [false; 3];
        for (index, picture) in pictures.iter().enumerate() {
            let shown = scene
                .pictures
                .iter()
                .any(|placed| usize::from(placed.camera) == index + 1);
            let Some(picture) = picture.as_ref().filter(|_| shown) else {
                continue;
            };
            if picture.check().is_err() {
                continue;
            }
            if self.converted[index].is_some() && self.holds[index] == Some(picture.sequence) {
                drawn[index] = true;
                continue;
            }
            let fits = self.sources[index].as_ref().is_some_and(|source| {
                (source.width, source.height) == (picture.width, picture.height)
            });
            if !fits {
                self.sources[index] =
                    Some(make_source(&self.device, picture.width, picture.height)?);
            }
            if self.converted[index].is_none() {
                self.converted[index] = Some(make_converted(&self.device)?);
            }
            if let (Some(source), Some(converted)) = (&self.sources[index], &self.converted[index])
            {
                convert(self, source, converted, picture);
                drawn[index] = true;
            }
            self.holds[index] = drawn[index].then_some(picture.sequence);
        }
        Ok(drawn)
    }

    /// The swap chain's own counts, for the minute line.
    pub fn statistics(&self) -> String {
        self.chain.as_ref().map_or_else(
            || String::from("no swap chain yet"),
            |chain| read_statistics(&chain.chain),
        )
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        // The chain first: it presents into the surface the handle names.
        self.chain = None;
        if let Some(surface) = self.surface {
            close_surface(surface);
        }
    }
}

/// The shaders compiled, and a renderer on a device of `driver`'s kind.
fn open_with(surface: Option<HANDLE>, driver: D3D_DRIVER_TYPE) -> Result<Renderer, String> {
    let source = shaders();
    let vertex = compile(&source, s!("vs"), s!("vs_4_0"))?;
    let convert = compile(&source, s!("ps_convert"), s!("ps_4_0"))?;
    let place = compile(&source, s!("ps_place"), s!("ps_4_0"))?;
    let clear = compile(&source, s!("ps_clear"), s!("ps_4_0"))?;
    open_renderer(surface, driver, &vertex, &convert, &place, &clear)
}

/// Compiles one entry point of the shaders' `source`.
#[allow(unsafe_code)]
fn compile(source: &str, entry: PCSTR, target: PCSTR) -> Result<Vec<u8>, String> {
    // SAFETY: the source is passed with its length and lives across the
    // call; the two blobs are owned here and read within the size each
    // reports.
    unsafe {
        let mut code: Option<ID3DBlob> = None;
        let mut messages: Option<ID3DBlob> = None;
        let compiled = D3DCompile(
            source.as_ptr().cast(),
            source.len(),
            PCSTR::null(),
            None,
            None::<&ID3DInclude>,
            entry,
            target,
            0,
            0,
            &mut code,
            Some(&mut messages),
        );
        if let Err(failed) = compiled {
            let said = messages.map_or_else(String::new, |blob| {
                let bytes = std::slice::from_raw_parts(
                    blob.GetBufferPointer().cast::<u8>(),
                    blob.GetBufferSize(),
                );
                String::from_utf8_lossy(bytes).into_owned()
            });
            return Err(format!("a shader did not compile: {failed} {said}"));
        }
        let code = code.ok_or("a shader compiled to nothing")?;
        Ok(
            std::slice::from_raw_parts(code.GetBufferPointer().cast::<u8>(), code.GetBufferSize())
                .to_vec(),
        )
    }
}

/// The device and everything that does not depend on a size.
#[allow(unsafe_code)]
fn open_renderer(
    surface: Option<HANDLE>,
    driver: D3D_DRIVER_TYPE,
    vertex: &[u8],
    convert: &[u8],
    place: &[u8],
    clear: &[u8],
) -> Result<Renderer, String> {
    // SAFETY: Direct3D calls with owned out-values and descriptions that
    // live across each call. The surface handle is only kept here: the
    // renderer's drop closes it, or `Renderer::open` when this fails.
    unsafe {
        {
            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            D3D11CreateDevice(
                None,
                driver,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|e| error("no graphics device", &e))?;
            let device = device.ok_or("no graphics device")?;
            let context = context.ok_or("no device context")?;
            let mut vertex_shader: Option<ID3D11VertexShader> = None;
            device
                .CreateVertexShader(vertex, None, Some(&mut vertex_shader))
                .map_err(|e| error("no vertex shader", &e))?;
            let pixel_shader = |code: &[u8]| -> Result<ID3D11PixelShader, String> {
                let mut shader: Option<ID3D11PixelShader> = None;
                device
                    .CreatePixelShader(code, None, Some(&mut shader))
                    .map_err(|e| error("no pixel shader", &e))?;
                shader.ok_or_else(|| String::from("no pixel shader"))
            };
            let sampler =
                |filter: D3D11_FILTER, smallest: f32| -> Result<ID3D11SamplerState, String> {
                    let desc = D3D11_SAMPLER_DESC {
                        Filter: filter,
                        AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                        AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                        AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                        MaxAnisotropy: 1,
                        MinLOD: 0.0,
                        MaxLOD: smallest,
                        ..Default::default()
                    };
                    let mut state: Option<ID3D11SamplerState> = None;
                    device
                        .CreateSamplerState(&desc, Some(&mut state))
                        .map_err(|e| error("no sampler", &e))?;
                    state.ok_or_else(|| String::from("no sampler"))
                };
            let buffer_desc = D3D11_BUFFER_DESC {
                ByteWidth: size_of::<Constants>() as u32,
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
                ..Default::default()
            };
            let mut constants: Option<ID3D11Buffer> = None;
            device
                .CreateBuffer(&buffer_desc, None, Some(&mut constants))
                .map_err(|e| error("no constants", &e))?;
            Ok(Renderer {
                convert: pixel_shader(convert)?,
                place: pixel_shader(place)?,
                clear: pixel_shader(clear)?,
                // The small places are drawn from the picture's smaller copies.
                smooth: sampler(D3D11_FILTER_MIN_MAG_MIP_LINEAR, D3D11_FLOAT32_MAX)?,
                // The loupe: each pixel of the picture as it is.
                pixels: sampler(D3D11_FILTER_MIN_MAG_MIP_POINT, 0.0)?,
                vertex: vertex_shader.ok_or("no vertex shader")?,
                constants: constants.ok_or("no constants")?,
                device,
                context,
                sources: [None, None, None],
                converted: [None, None, None],
                holds: [None, None, None],
                surface,
                chain: None,
            })
        }
    }
}

/// The swap chain on the shell's surface, at the scene's size, clear where
/// nothing is drawn.
#[allow(unsafe_code)]
fn open_chain(renderer: &Renderer, width: u32, height: u32) -> Result<Chain, String> {
    let desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: width,
        Height: height,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
        BufferCount: 2,
        Scaling: DXGI_SCALING_STRETCH,
        SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
        AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
        ..Default::default()
    };
    let surface = renderer.surface.ok_or("no surface to draw into")?;
    // SAFETY: the surface handle is this process's own and open for the
    // renderer's life; the description lives across the call. The factory
    // is the one that made the renderer's device.
    unsafe {
        let dxgi: IDXGIDevice = renderer
            .device
            .cast()
            .map_err(|e| error("no DXGI device", &e))?;
        let factory: IDXGIFactoryMedia = dxgi
            .GetAdapter()
            .and_then(|adapter| adapter.GetParent())
            .map_err(|e| error("no DXGI factory", &e))?;
        let chain = factory
            .CreateSwapChainForCompositionSurfaceHandle(
                &renderer.device,
                Some(surface),
                &desc,
                None,
            )
            .map_err(|e| error("no swap chain on the shell's surface", &e))?;
        let target = chain_target(&renderer.device, &chain)?;
        Ok(Chain {
            chain,
            target: Some(target),
            width,
            height,
        })
    }
}

/// The swap chain's buffer as something to draw into.
#[allow(unsafe_code)]
fn chain_target(
    device: &ID3D11Device,
    chain: &IDXGISwapChain1,
) -> Result<ID3D11RenderTargetView, String> {
    // SAFETY: the chain's first buffer, viewed as a render target on the
    // chain's own device.
    unsafe {
        let buffer: ID3D11Texture2D = chain.GetBuffer(0).map_err(|e| error("no buffer", &e))?;
        let mut target: Option<ID3D11RenderTargetView> = None;
        device
            .CreateRenderTargetView(&buffer, None, Some(&mut target))
            .map_err(|e| error("no render target", &e))?;
        target.ok_or_else(|| String::from("no render target"))
    }
}

/// A new size for the surface: the scene's.
#[allow(unsafe_code)]
fn resize_chain(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    chain: &mut Chain,
    width: u32,
    height: u32,
) -> Result<(), String> {
    chain.target = None;
    // SAFETY: no view of the buffers is held or bound while they are
    // resized: the target above is dropped, the context lets go of all it
    // binds, and the flush lets Direct3D destroy what it deferred.
    unsafe {
        context.ClearState();
        context.Flush();
        chain
            .chain
            .ResizeBuffers(
                0,
                width,
                height,
                DXGI_FORMAT_UNKNOWN,
                DXGI_SWAP_CHAIN_FLAG(0),
            )
            .map_err(|e| error("the surface did not resize", &e))?;
    }
    chain.width = width;
    chain.height = height;
    chain.target = Some(chain_target(device, &chain.chain)?);
    Ok(())
}

/// The texture a camera's frames are uploaded to: half the frame's width in
/// texels, for UYVY holds two pixels in four bytes.
#[allow(unsafe_code)]
fn make_source(device: &ID3D11Device, width: u32, height: u32) -> Result<Source, String> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width / 2,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_R8G8B8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
        ..Default::default()
    };
    // SAFETY: Direct3D calls with owned out-values; the description lives
    // across the call.
    unsafe {
        let mut texture: Option<ID3D11Texture2D> = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut texture))
            .map_err(|e| error("no texture for a frame", &e))?;
        let texture = texture.ok_or("no texture for a frame")?;
        let mut view: Option<ID3D11ShaderResourceView> = None;
        device
            .CreateShaderResourceView(&texture, None, Some(&mut view))
            .map_err(|e| error("no view of a frame", &e))?;
        Ok(Source {
            texture,
            view: view.ok_or("no view of a frame")?,
            width,
            height,
        })
    }
}

/// A camera's picture: 1920 × 1080 in RGB, drawn into and read from, with
/// its smaller copies.
#[allow(unsafe_code)]
fn make_converted(device: &ID3D11Device) -> Result<Converted, String> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: PICTURE_WIDTH,
        Height: PICTURE_HEIGHT,
        MipLevels: 0,
        ArraySize: 1,
        Format: DXGI_FORMAT_R8G8B8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
        MiscFlags: D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32,
        ..Default::default()
    };
    // SAFETY: Direct3D calls with owned out-values; the description lives
    // across the call.
    unsafe {
        let mut texture: Option<ID3D11Texture2D> = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut texture))
            .map_err(|e| error("no texture for a picture", &e))?;
        let texture = texture.ok_or("no texture for a picture")?;
        let mut target: Option<ID3D11RenderTargetView> = None;
        device
            .CreateRenderTargetView(&texture, None, Some(&mut target))
            .map_err(|e| error("no target for a picture", &e))?;
        let mut view: Option<ID3D11ShaderResourceView> = None;
        device
            .CreateShaderResourceView(&texture, None, Some(&mut view))
            .map_err(|e| error("no view of a picture", &e))?;
        Ok(Converted {
            target: target.ok_or("no target for a picture")?,
            view: view.ok_or("no view of a picture")?,
        })
    }
}

/// A rectangle of the target to draw into. It may reach past the target's
/// edges: what lies outside is not drawn.
fn viewport(x: i32, y: i32, width: u32, height: u32) -> D3D11_VIEWPORT {
    D3D11_VIEWPORT {
        TopLeftX: x as f32,
        TopLeftY: y as f32,
        Width: width as f32,
        Height: height as f32,
        MinDepth: 0.0,
        MaxDepth: 1.0,
    }
}

/// Uploads a camera's frame and turns it into the camera's picture.
/// `picture` has passed `Picture::check`, and `source` has its size.
#[allow(unsafe_code)]
fn convert(renderer: &Renderer, source: &Source, converted: &Converted, picture: &Picture<'_>) {
    let constants = Constants {
        source: [picture.width as f32, picture.height as f32],
        taps: [
            taps(picture.width, PICTURE_WIDTH) as f32,
            taps(picture.height, PICTURE_HEIGHT) as f32,
        ],
        ..Constants::default()
    };
    let context = &renderer.context;
    // SAFETY: the frame's bytes hold `height` rows of `stride` bytes, the
    // last at least the row's own length (`Picture::check`), which is what
    // the upload reads for a texture of the frame's size. The constants live
    // across the call that copies them. Every object is the renderer's own,
    // used on its one thread.
    unsafe {
        context.UpdateSubresource(
            &source.texture,
            0,
            None,
            picture.uyvy.as_ptr().cast(),
            picture.stride,
            0,
        );
        context.UpdateSubresource(
            &renderer.constants,
            0,
            None,
            (&raw const constants).cast(),
            0,
            0,
        );
        // The picture is not read while it is drawn into.
        context.PSSetShaderResources(0, Some(&[None]));
        context.OMSetRenderTargets(Some(&[Some(converted.target.clone())]), None);
        context.RSSetViewports(Some(&[viewport(0, 0, PICTURE_WIDTH, PICTURE_HEIGHT)]));
        context.IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        context.VSSetShader(&renderer.vertex, None);
        context.PSSetShader(&renderer.convert, None);
        context.PSSetConstantBuffers(0, Some(&[Some(renderer.constants.clone())]));
        context.PSSetShaderResources(0, Some(&[Some(source.view.clone())]));
        context.Draw(3, 0);
        context.OMSetRenderTargets(None, None);
        context.GenerateMips(&converted.view);
    }
}

/// Draws the scene's places from the cameras' pictures, with their aids,
/// into `target`, and clears its holes. A place whose camera was not drawn
/// this time stays clear.
#[allow(unsafe_code)]
fn compose(renderer: &Renderer, target: &ID3D11RenderTargetView, scene: &Scene, drawn: &[bool; 3]) {
    let context = &renderer.context;
    // SAFETY: every object is the renderer's own, used on its one thread;
    // the constants live across the call that copies them. The scene has
    // passed `Scene::check`: every hole lies inside the surface, and every
    // picture at least partly, within the viewport's limits; what lies
    // outside the surface is not drawn.
    unsafe {
        context.PSSetShaderResources(0, Some(&[None]));
        context.OMSetRenderTargets(Some(&[Some(target.clone())]), None);
        context.ClearRenderTargetView(target, &[0.0, 0.0, 0.0, 0.0]);
        context.IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        context.VSSetShader(&renderer.vertex, None);
        context.PSSetConstantBuffers(0, Some(&[Some(renderer.constants.clone())]));
        context.PSSetShader(&renderer.place, None);
        for placed in &scene.pictures {
            let index = usize::from(placed.camera).wrapping_sub(1);
            let Some(converted) = renderer.converted.get(index).and_then(Option::as_ref) else {
                continue;
            };
            if !drawn.get(index).copied().unwrap_or(false) {
                continue;
            }
            let constants = Constants {
                whole: rect(&placed.part),
                marker: placed.marker.as_ref().map_or([0.0; 4], rect),
                view: [placed.at.width as f32, placed.at.height as f32],
                aids: aid_bits(placed),
                ..Constants::default()
            };
            context.UpdateSubresource(
                &renderer.constants,
                0,
                None,
                (&raw const constants).cast(),
                0,
                0,
            );
            let sampler = if placed.smooth {
                &renderer.smooth
            } else {
                &renderer.pixels
            };
            context.PSSetSamplers(0, Some(&[Some(sampler.clone())]));
            context.PSSetShaderResources(0, Some(&[Some(converted.view.clone())]));
            context.RSSetViewports(Some(&[viewport(
                placed.at.x,
                placed.at.y,
                placed.at.width,
                placed.at.height,
            )]));
            context.Draw(3, 0);
        }
        context.PSSetShader(&renderer.clear, None);
        for hole in &scene.holes {
            context.RSSetViewports(Some(&[viewport(
                hole.x as i32,
                hole.y as i32,
                hole.width,
                hole.height,
            )]));
            context.Draw(3, 0);
        }
    }
}

/// Shows what was drawn into the swap chain; returns how long it took.
#[allow(unsafe_code)]
fn present(chain: &IDXGISwapChain1) -> Result<Duration, String> {
    let started = Instant::now();
    // SAFETY: the chain is the renderer's own, used on its one thread.
    unsafe {
        chain
            .Present(1, DXGI_PRESENT(0))
            .ok()
            .map_err(|e| error("the present failed", &e))?;
    }
    Ok(started.elapsed())
}

/// How many presents the swap chain has taken.
#[allow(unsafe_code)]
fn read_statistics(chain: &IDXGISwapChain1) -> String {
    // SAFETY: a plain read of a count.
    unsafe {
        chain.GetLastPresentCount().map_or_else(
            |e| format!("no present count ({e})"),
            |count| format!("present count {count}"),
        )
    }
}

/// Closes this process's copy of the shell's surface handle.
#[allow(unsafe_code)]
fn close_surface(surface: HANDLE) {
    // SAFETY: the handle is this process's own (the shell duplicated it
    // here), closed once: from the renderer's drop, or from `Renderer::open`
    // when no renderer was made.
    unsafe {
        let _ = CloseHandle(surface);
    }
}

/// A texture a scene is drawn into in place of the shell's surface, and read
/// back from: what the tests draw with.
#[cfg(test)]
struct Offscreen {
    texture: ID3D11Texture2D,
    view: ID3D11RenderTargetView,
    width: u32,
    height: u32,
}

#[cfg(test)]
impl Renderer {
    /// A renderer on Windows' software device (WARP), with no surface.
    fn open_offscreen() -> Result<Self, String> {
        open_with(
            None,
            windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_WARP,
        )
    }

    /// Draws `scene` into `target` as `draw` draws it into the surface, and
    /// reads it back: BGRA, row by row.
    fn draw_offscreen(
        &mut self,
        scene: &Scene,
        pictures: &[Option<Picture<'_>>; 3],
        target: &Offscreen,
    ) -> Result<Vec<u8>, String> {
        let drawn = self.convert_all(scene, pictures)?;
        compose(self, &target.view, scene, &drawn);
        read_back(self, target)
    }
}

/// A texture of the surface's format to draw a scene into.
#[cfg(test)]
#[allow(unsafe_code)]
fn make_target(device: &ID3D11Device, width: u32, height: u32) -> Result<Offscreen, String> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
        ..Default::default()
    };
    // SAFETY: Direct3D calls with owned out-values; the description lives
    // across the call.
    unsafe {
        let mut texture: Option<ID3D11Texture2D> = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut texture))
            .map_err(|e| error("no texture to draw into", &e))?;
        let texture = texture.ok_or("no texture to draw into")?;
        let mut view: Option<ID3D11RenderTargetView> = None;
        device
            .CreateRenderTargetView(&texture, None, Some(&mut view))
            .map_err(|e| error("no target to draw into", &e))?;
        Ok(Offscreen {
            texture,
            view: view.ok_or("no target to draw into")?,
            width,
            height,
        })
    }
}

/// What was drawn into `target`, copied to the processor: BGRA, row by row.
#[cfg(test)]
#[allow(unsafe_code)]
fn read_back(renderer: &Renderer, target: &Offscreen) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_USAGE_STAGING,
    };
    let desc = D3D11_TEXTURE2D_DESC {
        Width: target.width,
        Height: target.height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        ..Default::default()
    };
    let row = target.width as usize * 4;
    // SAFETY: a copy of the target made for the processor to read, mapped
    // for reading and read only while it is mapped, each of its rows
    // `RowPitch` bytes apart and `row` bytes long; every object is the
    // renderer's own, used on its one thread.
    unsafe {
        let mut copy: Option<ID3D11Texture2D> = None;
        renderer
            .device
            .CreateTexture2D(&desc, None, Some(&mut copy))
            .map_err(|e| error("no texture to read back", &e))?;
        let copy = copy.ok_or("no texture to read back")?;
        renderer.context.CopyResource(&copy, &target.texture);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        renderer
            .context
            .Map(&copy, 0, D3D11_MAP_READ, 0, Some(&raw mut mapped))
            .map_err(|e| error("the copy could not be read", &e))?;
        let mut pixels = Vec::with_capacity(row * target.height as usize);
        for y in 0..target.height as usize {
            let start = mapped.pData.cast::<u8>().add(y * mapped.RowPitch as usize);
            pixels.extend_from_slice(std::slice::from_raw_parts(start, row));
        }
        renderer.context.Unmap(&copy, 0);
        Ok(pixels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::card_uyvy;
    use studio_control_protocol::picture_layer::PictureRect;

    const WHOLE: Part = Part {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    /// Where the loupe looks at 2:1, in the whole view.
    const LOUPE: Part = Part {
        x: 818,
        y: 472,
        width: 284,
        height: 136,
    };

    /// One place showing CAM 1's whole picture 1:1, pixel for pixel, with the
    /// aids asked for: as the page's 1:1 view and the loupe show it.
    fn one_to_one(guides: bool, zebras: bool, peaking: bool, marker: Option<Part>) -> Scene {
        Scene {
            width: 1920,
            height: 1080,
            pictures: vec![PlacedPicture {
                camera: 1,
                at: PictureRect {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                },
                part: WHOLE,
                smooth: false,
                guides,
                zebras,
                peaking,
                marker,
            }],
            holes: Vec::new(),
        }
    }

    /// Draws `scene` from CAM 1's test card on Windows' software device:
    /// RGB, row by row.
    struct Card {
        renderer: Renderer,
        target: Offscreen,
        card: Vec<u8>,
    }

    impl Card {
        fn open() -> Self {
            let renderer = Renderer::open_offscreen().unwrap_or_else(|why| panic!("{why}"));
            let target =
                make_target(&renderer.device, 1920, 1080).unwrap_or_else(|why| panic!("{why}"));
            Self {
                renderer,
                target,
                card: card_uyvy(1),
            }
        }

        fn draw(&mut self, scene: &Scene) -> Vec<[u8; 3]> {
            let frame = Picture {
                uyvy: &self.card,
                width: 1920,
                height: 1080,
                stride: 3840,
                sequence: 1,
            };
            self.renderer
                .draw_offscreen(scene, &[Some(frame), None, None], &self.target)
                .unwrap_or_else(|why| panic!("{why}"))
                .chunks_exact(4)
                .map(|bgra| [bgra[2], bgra[1], bgra[0]])
                .collect()
        }
    }

    // The page's own bar (`cameras.spec.ts`): a channel within 2, and no
    // more than 0.2 % of the pixels otherwise. The card's greys stand clear
    // of 95 % and of the 0.12 step, so the graphics card's sums and the
    // reference's agree on them.
    #[test]
    fn the_zebras_and_the_peaking_are_drawn_as_the_page_draws_them() {
        let mut card = Card::open();
        let base = card.draw(&one_to_one(false, false, false, None));
        for (zebras, peaking) in [(true, false), (false, true), (true, true)] {
            let drawn = card.draw(&one_to_one(false, zebras, peaking, None));
            let expected = aids::lay_over(&base, 1920, 1080, zebras, peaking);
            let differing = drawn
                .iter()
                .zip(&expected)
                .filter(|(got, want)| got.iter().zip(want.iter()).any(|(g, w)| g.abs_diff(*w) > 2))
                .count();
            assert!(
                differing <= drawn.len() / 500,
                "{differing} pixels differ from the reference (zebras {zebras}, peaking {peaking})"
            );
            let marked = drawn
                .iter()
                .zip(&base)
                .filter(|(got, was)| got != was)
                .count();
            assert!(marked > 10_000, "the card is marked: {marked} pixels");
        }
    }

    #[test]
    fn the_guides_and_the_marker_stand_where_the_page_draws_them() {
        let mut card = Card::open();
        let base = card.draw(&one_to_one(false, false, false, None));
        let drawn = card.draw(&one_to_one(true, false, false, Some(LOUPE)));
        let at = |pixels: &[[u8; 3]], x: usize, y: usize| pixels[y * 1920 + x];
        let near =
            |got: [u8; 3], want: [u8; 3]| got.iter().zip(want).all(|(g, w)| g.abs_diff(w) <= 2);
        let lifted = |under: [u8; 3], alpha: f64| {
            under.map(|c| (f64::from(c) + (255.0 - f64::from(c)) * alpha).round() as u8)
        };
        let unmoved = |x: usize, y: usize| near(at(&drawn, x, y), at(&base, x, y));
        let guide =
            |x: usize, y: usize, alpha: f64| near(at(&drawn, x, y), lifted(at(&base, x, y), alpha));

        // The thirds: 2 pixels wide on 640 and 1280, 360 and 720, the pixel
        // on each side of the line covered and the next one not.
        for y in [100, 300, 900] {
            for x in [639, 640, 1279, 1280] {
                assert!(guide(x, y, aids::GUIDE_ALPHA), "the third at x {x}, y {y}");
            }
            for x in [638, 641, 1278, 1281] {
                assert!(unmoved(x, y), "beside a third at x {x}, y {y}");
            }
        }
        for y in [359, 360, 719, 720] {
            assert!(guide(100, y, aids::GUIDE_ALPHA), "the third at y {y}");
        }
        for y in [358, 361, 718, 721] {
            assert!(unmoved(100, y), "beside a third at y {y}");
        }
        // Where two thirds cross they are one path: drawn once.
        assert!(guide(640, 360, aids::GUIDE_ALPHA));
        // The cross at the centre, its arms 30 pixels each way.
        assert!(guide(940, 540, aids::CROSS_ALPHA) && guide(960, 520, aids::CROSS_ALPHA));
        assert!(guide(930, 539, aids::CROSS_ALPHA) && guide(989, 540, aids::CROSS_ALPHA));
        assert!(unmoved(929, 540) && unmoved(990, 540) && unmoved(940, 538) && unmoved(940, 541));
        assert!(unmoved(960, 509) && unmoved(960, 570));

        // The marker: 3 pixels wide, centred on the loupe's edge, so the two
        // rows at the edge are white, the one each side half, and the next
        // the picture; dashed from its top left corner, 14 on and 8 off.
        let half = |x: usize, y: usize| near(at(&drawn, x, y), lifted(at(&base, x, y), 0.5));
        for x in [823, 831, 840, 845, 867] {
            for y in [471, 472] {
                assert_eq!(at(&drawn, x, y), [255; 3], "a dash at x {x}, y {y}");
            }
            assert!(half(x, 470) && half(x, 473), "the dash's edges at x {x}");
            assert!(
                unmoved(x, 469) && unmoved(x, 474),
                "beside the dash at x {x}"
            );
        }
        for x in [832, 836, 839, 858] {
            assert!(unmoved(x, 472), "a gap at x {x}");
        }
        // Its left edge, the same across.
        for y in [475, 540] {
            assert_eq!(at(&drawn, 817, y), [255; 3]);
            assert_eq!(at(&drawn, 818, y), [255; 3]);
            assert!(
                half(816, y) && half(819, y),
                "the left edge's sides at y {y}"
            );
            assert!(
                unmoved(815, y) && unmoved(820, y),
                "beside the left edge at y {y}"
            );
        }
        // Nothing inside it.
        assert!(unmoved(900, 540));
    }

    #[test]
    fn a_place_s_aids_are_told_to_the_shader_as_bits() {
        let mut placed = one_to_one(true, false, true, None).pictures[0];
        assert_eq!(aid_bits(&placed), 0b0101);
        placed.zebras = true;
        placed.marker = Some(LOUPE);
        assert_eq!(aid_bits(&placed), 0b1111);
        assert_eq!(rect(&LOUPE), [818.0, 472.0, 284.0, 136.0]);
    }

    #[test]
    fn a_larger_frame_is_averaged_and_a_smaller_one_is_not() {
        assert_eq!(taps(1920, 1920), 1);
        assert_eq!(taps(1280, 1920), 1);
        assert_eq!(taps(3840, 1920), 2);
        assert_eq!(taps(2560, 1920), 2);
        assert_eq!(taps(2160, 1080), 2);
        assert_eq!(taps(7680, 1920), 4);
        assert_eq!(taps(0, 1920), 1);
    }

    // D3DCompile is Windows' own, and needs no graphics card: the shaders
    // are held to it here, before a development run first draws with them.
    #[test]
    fn the_shaders_compile() {
        for (entry, target) in [
            (s!("vs"), s!("vs_4_0")),
            (s!("ps_convert"), s!("ps_4_0")),
            (s!("ps_place"), s!("ps_4_0")),
            (s!("ps_clear"), s!("ps_4_0")),
        ] {
            let code = compile(&shaders(), entry, target).unwrap_or_else(|why| panic!("{why}"));
            assert!(!code.is_empty());
        }
    }

    #[test]
    fn the_shaders_constants_are_the_size_the_shader_declares() {
        // `cbuffer Constants`: two float4, then two float2, then a float2
        // and two uint: four registers of 16 bytes.
        assert_eq!(size_of::<Constants>(), 64);
    }
}
