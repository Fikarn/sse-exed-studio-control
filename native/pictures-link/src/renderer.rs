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
//! picture: the part the page asked for, smoothed or pixel for pixel. Holes
//! are cleared again, and everything else in the surface stays clear, so the
//! page shows through around the pictures. One present shows them all.
//!
//! The shell does no work per frame, and no picture leaves this process.

use crate::picture::Picture;
use std::time::{Duration, Instant};
use studio_control_protocol::picture_layer::{Scene, PICTURE_HEIGHT, PICTURE_WIDTH};
use windows::core::{s, Interface, PCSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE};
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D::{
    ID3DBlob, ID3DInclude, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST, D3D_DRIVER_TYPE_HARDWARE,
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

/// The shaders. `ps_convert` writes one pixel of the 1920 × 1080 picture
/// from the frame's UYVY: `taps` samples each way, spread over what the
/// pixel covers of the frame (one for a frame of the picture's size, two for
/// one of twice it). `ps_place` draws a part of the picture into a place.
const SHADERS: &str = r"
cbuffer Constants : register(b0) {
    float4 part;
    float2 source;
    float2 taps;
};
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
float4 ps_place(Out i) : SV_Target {
    return float4(frame.Sample(how, part.xy + i.uv * part.zw).rgb, 1);
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

/// What the shaders are told for one draw.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Constants {
    part: [f32; 4],
    source: [f32; 2],
    taps: [f32; 2],
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
    factory: IDXGIFactoryMedia,
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
    /// This process's own copy of the shell's surface handle.
    surface: HANDLE,
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
        let made = (|| {
            let vertex = compile(s!("vs"), s!("vs_4_0"))?;
            let convert = compile(s!("ps_convert"), s!("ps_4_0"))?;
            let place = compile(s!("ps_place"), s!("ps_4_0"))?;
            let clear = compile(s!("ps_clear"), s!("ps_4_0"))?;
            open_renderer(surface, &vertex, &convert, &place, &clear)
        })();
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
        let chain = self.chain.as_ref().ok_or("no swap chain")?;
        compose(self, chain, scene, &drawn)
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
        close_surface(self.surface);
    }
}

/// Compiles one entry point of `SHADERS`.
#[allow(unsafe_code)]
fn compile(entry: PCSTR, target: PCSTR) -> Result<Vec<u8>, String> {
    // SAFETY: the source is a static string passed with its length; the two
    // blobs are owned here and read within the size each reports.
    unsafe {
        let mut code: Option<ID3DBlob> = None;
        let mut messages: Option<ID3DBlob> = None;
        let compiled = D3DCompile(
            SHADERS.as_ptr().cast(),
            SHADERS.len(),
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
    surface: HANDLE,
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
                D3D_DRIVER_TYPE_HARDWARE,
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
            let dxgi: IDXGIDevice = device.cast().map_err(|e| error("no DXGI device", &e))?;
            let factory: IDXGIFactoryMedia = dxgi
                .GetAdapter()
                .and_then(|adapter| adapter.GetParent())
                .map_err(|e| error("no DXGI factory", &e))?;
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
                factory,
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
    // SAFETY: the surface handle is this process's own and open for the
    // renderer's life; the description lives across the call.
    unsafe {
        let chain = renderer
            .factory
            .CreateSwapChainForCompositionSurfaceHandle(
                &renderer.device,
                Some(renderer.surface),
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
        part: [0.0; 4],
        source: [picture.width as f32, picture.height as f32],
        taps: [
            taps(picture.width, PICTURE_WIDTH) as f32,
            taps(picture.height, PICTURE_HEIGHT) as f32,
        ],
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

/// Draws the scene's places from the cameras' pictures, clears its holes,
/// and presents. A place whose camera was not drawn this time stays clear.
#[allow(unsafe_code)]
fn compose(
    renderer: &Renderer,
    chain: &Chain,
    scene: &Scene,
    drawn: &[bool; 3],
) -> Result<Duration, String> {
    let target = chain.target.clone().ok_or("no render target")?;
    let context = &renderer.context;
    // SAFETY: every object is the renderer's own, used on its one thread;
    // the constants live across the call that copies them. The scene has
    // passed `Scene::check`: every hole lies inside the surface, and every
    // picture at least partly, within the viewport's limits; what lies
    // outside the surface is not drawn.
    unsafe {
        context.PSSetShaderResources(0, Some(&[None]));
        context.OMSetRenderTargets(Some(&[Some(target.clone())]), None);
        context.ClearRenderTargetView(&target, &[0.0, 0.0, 0.0, 0.0]);
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
                part: [
                    placed.part.x as f32 / PICTURE_WIDTH as f32,
                    placed.part.y as f32 / PICTURE_HEIGHT as f32,
                    placed.part.width as f32 / PICTURE_WIDTH as f32,
                    placed.part.height as f32 / PICTURE_HEIGHT as f32,
                ],
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
        let started = Instant::now();
        chain
            .chain
            .Present(1, DXGI_PRESENT(0))
            .ok()
            .map_err(|e| error("the present failed", &e))?;
        Ok(started.elapsed())
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
            let code = compile(entry, target).unwrap_or_else(|why| panic!("{why}"));
            assert!(!code.is_empty());
        }
    }

    #[test]
    fn the_shaders_constants_are_the_size_the_shader_declares() {
        // `cbuffer Constants`: a float4 and two float2, one register of 16
        // bytes each.
        assert_eq!(size_of::<Constants>(), 32);
    }
}
