use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, File},
    hash::{Hash, Hasher},
    io::BufWriter,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader};
use serde::Serialize;
use thiserror::Error;

const CACHE_DIRECTORY_NAME: &str = "monkey-view";

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
    #[error("The selected image does not exist: {0}")]
    MissingFile(PathBuf),
    #[error("Unsupported image format for file: {0}")]
    UnsupportedFormat(PathBuf),
    #[error("Failed to open image file: {0}")]
    OpenFailure(#[from] std::io::Error),
    #[error("Failed to decode image data: {0}")]
    DecodeFailure(#[from] image::ImageError),
}

#[tauri::command]
pub fn load_image_asset(path: String) -> Result<LoadedImageAsset, String> {
    load_image_asset_from_path(Path::new(&path)).map_err(|error| error.to_string())
}

fn load_image_asset_from_path(path: &Path) -> Result<LoadedImageAsset, ImageLoadingError> {
    if !path.exists() {
        return Err(ImageLoadingError::MissingFile(path.to_path_buf()));
    }

    let mut reader = ImageReader::open(path)?;
    reader = reader.with_guessed_format()?;
    let format = reader
        .format()
        .or_else(|| ImageFormat::from_path(path).ok())
        .filter(is_supported_format)
        .ok_or_else(|| ImageLoadingError::UnsupportedFormat(path.to_path_buf()))?;
    let image = reader.decode()?;
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
    matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Tiff)
}

fn format_label(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::Tiff => "tiff",
        _ => "unknown",
    }
}

fn write_render_asset(
    image: &DynamicImage,
    source_path: &Path,
    format: ImageFormat,
) -> Result<String, ImageLoadingError> {
    let cache_dir = std::env::temp_dir().join(CACHE_DIRECTORY_NAME);
    fs::create_dir_all(&cache_dir)?;

    let output_path = cache_dir.join(format!("{}.png", build_asset_hash(source_path, format)?));
    let file = File::create(&output_path)?;
    let mut writer = BufWriter::new(file);
    let render_image = DynamicImage::ImageRgba8(image.to_rgba8());
    render_image.write_to(&mut writer, ImageFormat::Png)?;

    Ok(output_path.to_string_lossy().into_owned())
}

fn build_asset_hash(source_path: &Path, format: ImageFormat) -> Result<u64, ImageLoadingError> {
    let metadata = fs::metadata(source_path)?;
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
}
