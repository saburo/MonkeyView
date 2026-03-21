use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, File},
    hash::{Hash, Hasher},
    io::BufWriter,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::UNIX_EPOCH,
};

use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader};
use serde::Serialize;
use thiserror::Error;

const CACHE_DIRECTORY_NAME: &str = "monkey-view";
const MAX_TIFF_PREVIEW_EDGE: u32 = 8192;
const SIPS_COMMAND_PATH: &str = "/usr/bin/sips";
#[cfg(target_os = "windows")]
const POWERSHELL_COMMAND_PATH: &str = "powershell.exe";
#[cfg(target_os = "windows")]
const WINDOWS_TIFF_PREVIEW_SCRIPT_NAME: &str = "monkey-view-tiff-preview.ps1";
#[cfg(target_os = "windows")]
const WINDOWS_TIFF_PREVIEW_SCRIPT: &str = r#"
param(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$MaxEdge
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName PresentationCore

$inputStream = [System.IO.File]::Open(
  $InputPath,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::Read
)

try {
  $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
    $inputStream,
    [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
    [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  )
} finally {
  $inputStream.Dispose()
}

$frame = $decoder.Frames[0]
$sourceWidth = [int]$frame.PixelWidth
$sourceHeight = [int]$frame.PixelHeight
$longestEdge = [Math]::Max($sourceWidth, $sourceHeight)

if ($longestEdge -gt $MaxEdge) {
  $scale = [double]$MaxEdge / [double]$longestEdge
} else {
  $scale = 1.0
}

$targetWidth = [Math]::Max(1, [int][Math]::Round($sourceWidth * $scale))
$targetHeight = [Math]::Max(1, [int][Math]::Round($sourceHeight * $scale))

if (-not (Test-Path -LiteralPath $OutputPath)) {
  $previewStream = [System.IO.File]::Open(
    $InputPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )

  try {
    $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
    $bitmap.BeginInit()
    $bitmap.StreamSource = $previewStream
    $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad

    if ($sourceWidth -ge $sourceHeight) {
      $bitmap.DecodePixelWidth = $targetWidth
    } else {
      $bitmap.DecodePixelHeight = $targetHeight
    }

    $bitmap.EndInit()
    $bitmap.Freeze()
  } finally {
    $previewStream.Dispose()
  }

  $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))

  $directory = Split-Path -Parent $OutputPath
  if ($directory) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  }

  $outputStream = [System.IO.File]::Open(
    $OutputPath,
    [System.IO.FileMode]::Create,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )

  try {
    $encoder.Save($outputStream)
  } finally {
    $outputStream.Dispose()
  }
}

Write-Output ("{0}|{1}" -f $sourceWidth, $sourceHeight)
"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ImageDimensions {
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImageAsset {
    pub image_path: String,
    pub render_asset_path: String,
    pub source_width: u32,
    pub source_height: u32,
    pub format: String,
}

#[derive(Debug, Error)]
enum ImageLoadingError {
    #[error("The selected image does not exist: {path}", path = .path.display())]
    MissingFile { path: PathBuf },
    #[error("Unsupported image format: {format} ({path})", path = .path.display())]
    UnsupportedFormat { path: PathBuf, format: String },
    #[error("Failed to open image file: {source} ({path})", path = .path.display())]
    OpenFailure {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Failed to determine the image format: {source} ({path})", path = .path.display())]
    FormatDetectionFailure {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Failed to read source file metadata: {source} ({path})", path = .path.display())]
    MetadataFailure {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Failed to decode image data: {source} ({path})", path = .path.display())]
    DecodeFailure {
        path: PathBuf,
        #[source]
        source: image::ImageError,
    },
    #[error("Failed to create the render cache directory: {source} ({path})", path = .path.display())]
    CacheDirectoryFailure {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Failed to create the render cache file: {source} ({path})", path = .path.display())]
    CacheFileCreateFailure {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error(
        "Failed to write the render cache image: {source} ({source_path} -> {output_path})",
        source_path = .source_path.display(),
        output_path = .output_path.display()
    )]
    RenderWriteFailure {
        source_path: PathBuf,
        output_path: PathBuf,
        #[source]
        source: image::ImageError,
    },
    #[error("Failed to query TIFF properties: {details} ({path})", path = .path.display())]
    TiffPreviewQueryFailure { path: PathBuf, details: String },
    #[error("Failed to render the TIFF preview: {details} ({path})", path = .path.display())]
    TiffPreviewRenderFailure { path: PathBuf, details: String },
    #[cfg(target_os = "windows")]
    #[error("Failed to create the TIFF preview helper: {source} ({path})", path = .path.display())]
    TiffPreviewHelperWriteFailure {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[tauri::command]
pub async fn load_image_asset(path: String) -> Result<LoadedImageAsset, String> {
    let path_buf = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || load_image_asset_from_path(&path_buf))
        .await
        .map_err(|error| format!("Image loading task failed: {error}"))?
        .map_err(|error| error.to_string())
}

fn load_image_asset_from_path(path: &Path) -> Result<LoadedImageAsset, ImageLoadingError> {
    if !path.exists() {
        return Err(ImageLoadingError::MissingFile {
            path: path.to_path_buf(),
        });
    }

    let mut reader = ImageReader::open(path).map_err(|source| ImageLoadingError::OpenFailure {
        path: path.to_path_buf(),
        source,
    })?;
    reader = reader.with_guessed_format().map_err(|source| {
        ImageLoadingError::FormatDetectionFailure {
            path: path.to_path_buf(),
            source,
        }
    })?;

    let detected_format = reader
        .format()
        .or_else(|| ImageFormat::from_path(path).ok());
    let format = match detected_format {
        Some(format) if is_supported_format(&format) => format,
        Some(format) => {
            return Err(ImageLoadingError::UnsupportedFormat {
                path: path.to_path_buf(),
                format: describe_format(format),
            });
        }
        None => {
            return Err(ImageLoadingError::UnsupportedFormat {
                path: path.to_path_buf(),
                format: "unknown".to_string(),
            });
        }
    };

    if format == ImageFormat::Tiff {
        #[cfg(target_os = "macos")]
        {
            return load_tiff_preview_asset(path);
        }

        #[cfg(target_os = "windows")]
        {
            return load_tiff_preview_asset(path);
        }
    }

    let image = reader
        .decode()
        .map_err(|source| ImageLoadingError::DecodeFailure {
            path: path.to_path_buf(),
            source,
        })?;
    let (source_width, source_height) = image.dimensions();
    let render_asset_path = write_render_asset(&image, path, format)?;

    Ok(LoadedImageAsset {
        image_path: path.to_string_lossy().into_owned(),
        render_asset_path,
        source_width,
        source_height,
        format: format_label(format).to_string(),
    })
}

fn is_supported_format(format: &ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Tiff
    )
}

fn format_label(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::Tiff => "tiff",
        _ => "unknown",
    }
}

fn describe_format(format: ImageFormat) -> String {
    match format {
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Tiff => {
            format_label(format).to_string()
        }
        other => format!("{other:?}"),
    }
}

fn compute_preview_dimensions(source: ImageDimensions, max_edge: u32) -> ImageDimensions {
    let longest_edge = source.width.max(source.height);

    if longest_edge <= max_edge {
        return source;
    }

    let scale = max_edge as f64 / longest_edge as f64;

    ImageDimensions {
        width: ((source.width as f64 * scale).round().max(1.0)) as u32,
        height: ((source.height as f64 * scale).round().max(1.0)) as u32,
    }
}

#[cfg(target_os = "macos")]
fn load_tiff_preview_asset(path: &Path) -> Result<LoadedImageAsset, ImageLoadingError> {
    let source_dimensions = query_tiff_dimensions(path)?;
    let preview_dimensions = compute_preview_dimensions(source_dimensions, MAX_TIFF_PREVIEW_EDGE);
    let render_asset_path = write_tiff_preview_asset(path, preview_dimensions)?;

    Ok(LoadedImageAsset {
        image_path: path.to_string_lossy().into_owned(),
        render_asset_path,
        source_width: source_dimensions.width,
        source_height: source_dimensions.height,
        format: format_label(ImageFormat::Tiff).to_string(),
    })
}

#[cfg(target_os = "windows")]
fn load_tiff_preview_asset(path: &Path) -> Result<LoadedImageAsset, ImageLoadingError> {
    let cache_dir = ensure_cache_dir()?;
    let render_asset_path = cache_dir.join(format!(
        "{}-tiff-preview-max{}.png",
        build_asset_hash(path, ImageFormat::Tiff)?,
        MAX_TIFF_PREVIEW_EDGE
    ));
    let source_dimensions = render_windows_tiff_preview_asset(path, &render_asset_path)?;

    Ok(LoadedImageAsset {
        image_path: path.to_string_lossy().into_owned(),
        render_asset_path: render_asset_path.to_string_lossy().into_owned(),
        source_width: source_dimensions.width,
        source_height: source_dimensions.height,
        format: format_label(ImageFormat::Tiff).to_string(),
    })
}

#[cfg(target_os = "macos")]
fn query_tiff_dimensions(path: &Path) -> Result<ImageDimensions, ImageLoadingError> {
    let output = Command::new(SIPS_COMMAND_PATH)
        .arg("-1")
        .arg("-g")
        .arg("pixelWidth")
        .arg("-g")
        .arg("pixelHeight")
        .arg("-g")
        .arg("format")
        .arg(path)
        .output()
        .map_err(|source| ImageLoadingError::TiffPreviewQueryFailure {
            path: path.to_path_buf(),
            details: source.to_string(),
        })?;

    if !output.status.success() {
        return Err(ImageLoadingError::TiffPreviewQueryFailure {
            path: path.to_path_buf(),
            details: describe_command_failure(&output),
        });
    }

    parse_sips_dimensions(&output).ok_or_else(|| ImageLoadingError::TiffPreviewQueryFailure {
        path: path.to_path_buf(),
        details: "Could not read pixelWidth/pixelHeight from sips output.".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn write_tiff_preview_asset(
    source_path: &Path,
    dimensions: ImageDimensions,
) -> Result<String, ImageLoadingError> {
    let cache_dir = ensure_cache_dir()?;
    let output_path = cache_dir.join(format!(
        "{}-tiff-preview-{}x{}.png",
        build_asset_hash(source_path, ImageFormat::Tiff)?,
        dimensions.width,
        dimensions.height
    ));

    if output_path.exists() {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    let output = Command::new(SIPS_COMMAND_PATH)
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg("-z")
        .arg(dimensions.height.to_string())
        .arg(dimensions.width.to_string())
        .arg(source_path)
        .arg("--out")
        .arg(&output_path)
        .output()
        .map_err(|source| ImageLoadingError::TiffPreviewRenderFailure {
            path: source_path.to_path_buf(),
            details: source.to_string(),
        })?;

    if !output.status.success() {
        return Err(ImageLoadingError::TiffPreviewRenderFailure {
            path: source_path.to_path_buf(),
            details: describe_command_failure(&output),
        });
    }

    Ok(output_path.to_string_lossy().into_owned())
}

#[cfg(target_os = "windows")]
fn render_windows_tiff_preview_asset(
    source_path: &Path,
    output_path: &Path,
) -> Result<ImageDimensions, ImageLoadingError> {
    let script_path = write_windows_tiff_preview_script()?;
    let output = Command::new(POWERSHELL_COMMAND_PATH)
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-STA")
        .arg("-File")
        .arg(&script_path)
        .arg(source_path)
        .arg(output_path)
        .arg(MAX_TIFF_PREVIEW_EDGE.to_string())
        .output()
        .map_err(|source| ImageLoadingError::TiffPreviewRenderFailure {
            path: source_path.to_path_buf(),
            details: source.to_string(),
        })?;

    if !output.status.success() {
        return Err(ImageLoadingError::TiffPreviewRenderFailure {
            path: source_path.to_path_buf(),
            details: describe_command_failure(&output),
        });
    }

    parse_windows_preview_dimensions(&output).ok_or_else(|| {
        ImageLoadingError::TiffPreviewRenderFailure {
            path: source_path.to_path_buf(),
            details: "Could not read pixelWidth/pixelHeight from PowerShell output.".to_string(),
        }
    })
}

#[cfg(target_os = "windows")]
fn write_windows_tiff_preview_script() -> Result<PathBuf, ImageLoadingError> {
    let cache_dir = ensure_cache_dir()?;
    let script_path = cache_dir.join(WINDOWS_TIFF_PREVIEW_SCRIPT_NAME);
    fs::write(&script_path, WINDOWS_TIFF_PREVIEW_SCRIPT).map_err(|source| {
        ImageLoadingError::TiffPreviewHelperWriteFailure {
            path: script_path.clone(),
            source,
        }
    })?;

    Ok(script_path)
}

fn ensure_cache_dir() -> Result<PathBuf, ImageLoadingError> {
    let cache_dir = std::env::temp_dir().join(CACHE_DIRECTORY_NAME);
    fs::create_dir_all(&cache_dir).map_err(|source| ImageLoadingError::CacheDirectoryFailure {
        path: cache_dir.clone(),
        source,
    })?;

    Ok(cache_dir)
}

fn parse_sips_dimensions(output: &Output) -> Option<ImageDimensions> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_sips_dimensions_from_stdout(&stdout)
}

#[cfg(target_os = "windows")]
fn parse_windows_preview_dimensions(output: &Output) -> Option<ImageDimensions> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|candidate| !candidate.trim().is_empty())?;

    parse_windows_preview_dimensions_line(line)
}

fn parse_sips_dimensions_from_stdout(stdout: &str) -> Option<ImageDimensions> {
    let width = parse_sips_property(stdout, "pixelWidth")?
        .parse::<u32>()
        .ok()?;
    let height = parse_sips_property(stdout, "pixelHeight")?
        .parse::<u32>()
        .ok()?;

    Some(ImageDimensions { width, height })
}

fn parse_windows_preview_dimensions_line(line: &str) -> Option<ImageDimensions> {
    let mut parts = line.trim().split('|');
    let width = parts.next()?.trim().parse::<u32>().ok()?;
    let height = parts.next()?.trim().parse::<u32>().ok()?;

    if parts.next().is_some() {
        return None;
    }

    Some(ImageDimensions { width, height })
}

fn parse_sips_property(stdout: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");

    stdout.split('|').find_map(|segment| {
        segment
            .trim()
            .strip_prefix(&prefix)
            .map(|value| value.trim().to_string())
    })
}

fn describe_command_failure(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stderr.is_empty() && !stdout.is_empty() {
        return format!("{stderr} | {stdout}");
    }

    if !stderr.is_empty() {
        return stderr;
    }

    if !stdout.is_empty() {
        return stdout;
    }

    format!("process exited with status {}", output.status)
}

fn write_render_asset(
    image: &DynamicImage,
    source_path: &Path,
    format: ImageFormat,
) -> Result<String, ImageLoadingError> {
    let cache_dir = ensure_cache_dir()?;

    let output_path = cache_dir.join(format!("{}.png", build_asset_hash(source_path, format)?));
    let file =
        File::create(&output_path).map_err(|source| ImageLoadingError::CacheFileCreateFailure {
            path: output_path.clone(),
            source,
        })?;
    let mut writer = BufWriter::new(file);
    let render_image = DynamicImage::ImageRgba8(image.to_rgba8());
    render_image
        .write_to(&mut writer, ImageFormat::Png)
        .map_err(|source| ImageLoadingError::RenderWriteFailure {
            source_path: source_path.to_path_buf(),
            output_path: output_path.clone(),
            source,
        })?;

    Ok(output_path.to_string_lossy().into_owned())
}

fn build_asset_hash(source_path: &Path, format: ImageFormat) -> Result<u64, ImageLoadingError> {
    let metadata =
        fs::metadata(source_path).map_err(|source| ImageLoadingError::MetadataFailure {
            path: source_path.to_path_buf(),
            source,
        })?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos());
    let mut hasher = DefaultHasher::new();

    source_path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    format_label(format).hash(&mut hasher);

    Ok(hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgba};
    use std::fs;
    use tempfile::TempDir;

    fn sample_image() -> DynamicImage {
        let buffer = ImageBuffer::from_fn(4, 3, |x, y| {
            let value = ((x + y) * 32) as u8;
            Rgba([value, 255u8.saturating_sub(value), 128, 255])
        });

        DynamicImage::ImageRgba8(buffer)
    }

    fn write_image(path: &Path, format: ImageFormat) {
        sample_image()
            .save_with_format(path, format)
            .expect("sample image should be written");
    }

    #[test]
    fn loads_png_jpeg_and_tiff_images() {
        let temp_dir = TempDir::new().expect("temp dir should be created");

        for (file_name, format, expected_label) in [
            ("sample.png", ImageFormat::Png, "png"),
            ("sample.jpg", ImageFormat::Jpeg, "jpeg"),
            ("sample.tiff", ImageFormat::Tiff, "tiff"),
        ] {
            let path = temp_dir.path().join(file_name);
            write_image(&path, format);

            let asset = load_image_asset_from_path(&path).expect("image should load");

            assert_eq!(asset.source_width, 4);
            assert_eq!(asset.source_height, 3);
            assert_eq!(asset.format, expected_label);
            assert!(Path::new(&asset.render_asset_path).exists());
        }
    }

    #[test]
    fn missing_file_errors_include_the_path() {
        let missing_path = PathBuf::from("/definitely-missing-image.tiff");
        let error = load_image_asset_from_path(&missing_path)
            .expect_err("missing files should return an error")
            .to_string();

        assert!(error.contains("does not exist"));
        assert!(error.contains("definitely-missing-image.tiff"));
    }

    #[test]
    fn unsupported_format_errors_include_the_detected_format() {
        let temp_dir = TempDir::new().expect("temp dir should be created");
        let path = temp_dir.path().join("sample.bmp");
        let sample_bmp = [
            0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00,
            0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
            0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00,
        ];
        fs::write(&path, sample_bmp).expect("bmp image should be written");

        let error = load_image_asset_from_path(&path)
            .expect_err("bmp should be rejected")
            .to_string();

        assert!(error.contains("Unsupported image format"));
        assert!(error.contains("Bmp"));
        assert!(error.contains("sample.bmp"));
    }

    #[test]
    fn preview_dimensions_clamp_large_images_to_the_max_edge() {
        let preview = compute_preview_dimensions(
            ImageDimensions {
                width: 16000,
                height: 8000,
            },
            MAX_TIFF_PREVIEW_EDGE,
        );

        assert_eq!(
            preview,
            ImageDimensions {
                width: 8192,
                height: 4096,
            }
        );
    }

    #[test]
    fn parses_one_line_sips_dimension_output() {
        let parsed = parse_sips_dimensions_from_stdout(
            "/tmp/sample.tiff|pixelWidth: 6144|pixelHeight: 4096|format: tiff|",
        )
        .expect("sips dimensions should parse");

        assert_eq!(
            parsed,
            ImageDimensions {
                width: 6144,
                height: 4096,
            }
        );
    }

    #[test]
    fn parses_windows_preview_dimension_output() {
        let parsed = parse_windows_preview_dimensions_line("6144|4096")
            .expect("preview dimensions should parse");

        assert_eq!(
            parsed,
            ImageDimensions {
                width: 6144,
                height: 4096,
            }
        );
    }
}
