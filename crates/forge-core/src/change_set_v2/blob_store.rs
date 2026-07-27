use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use super::{BlobContentKind, BlobRef, MAXIMUM_BLOB_BYTES, sha256, validate_blob_ref};

#[cfg(unix)]
use std::fs::File;

static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct FileBlobStore {
    root: PathBuf,
}

impl FileBlobStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn stage(&self, bytes: &[u8], content_kind: BlobContentKind) -> Result<BlobRef, String> {
        let byte_count =
            u64::try_from(bytes.len()).map_err(|_| "Blob size overflowed u64.".to_owned())?;
        if byte_count > MAXIMUM_BLOB_BYTES {
            return Err(format!(
                "Blob exceeds the {MAXIMUM_BLOB_BYTES} byte staging limit."
            ));
        }
        if content_kind == BlobContentKind::Utf8Text {
            std::str::from_utf8(bytes)
                .map_err(|_| "utf8_text blob content is not valid UTF-8.".to_owned())?;
        }
        let reference = BlobRef {
            sha256: sha256(bytes),
            bytes: byte_count,
            content_kind,
        };
        self.put(&reference, bytes)?;
        Ok(reference)
    }

    pub fn put(&self, reference: &BlobRef, bytes: &[u8]) -> Result<(), String> {
        validate_blob_ref(reference)?;
        if reference.bytes != bytes.len() as u64 || reference.sha256 != sha256(bytes) {
            return Err("Blob bytes do not match the declared reference.".to_owned());
        }
        if reference.content_kind == BlobContentKind::Utf8Text {
            std::str::from_utf8(bytes)
                .map_err(|_| "utf8_text blob content is not valid UTF-8.".to_owned())?;
        }

        let directory = self.blob_directory(reference)?;
        ensure_directory(&self.root)?;
        let blobs = self.root.join("blobs");
        ensure_directory(&blobs)?;
        ensure_directory(&directory)?;
        let target = directory.join(&reference.sha256);
        if target.exists() {
            return self.verify_path(&target, reference).map(|_| ());
        }

        let sequence = TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary = directory.join(format!(
            ".{}.{}.{sequence}.tmp",
            reference.sha256,
            std::process::id()
        ));
        let result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .map_err(|error| format!("Cannot create staged blob: {error}"))?;
            file.write_all(bytes)
                .map_err(|error| format!("Cannot write staged blob: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Cannot sync staged blob: {error}"))?;
            drop(file);
            match fs::hard_link(&temporary, &target) {
                Ok(()) => {
                    fs::remove_file(&temporary).map_err(|error| {
                        format!("Cannot remove published blob temporary file: {error}")
                    })?;
                    sync_directory(&directory)?;
                    Ok(())
                }
                Err(_error) if target.exists() => {
                    fs::remove_file(&temporary).map_err(|cleanup_error| {
                        format!(
                            "Blob was staged concurrently, but temporary cleanup failed: {cleanup_error}"
                        )
                    })?;
                    self.verify_path(&target, reference).map(|_| ())
                }
                Err(error) => Err(format!(
                    "Cannot publish staged blob without overwrite: {error}"
                )),
            }
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub fn read(&self, reference: &BlobRef) -> Result<Vec<u8>, String> {
        validate_blob_ref(reference)?;
        self.verify_path(&self.blob_path(reference)?, reference)
    }

    fn blob_directory(&self, reference: &BlobRef) -> Result<PathBuf, String> {
        validate_blob_ref(reference)?;
        Ok(self.root.join("blobs").join(&reference.sha256[..2]))
    }

    fn blob_path(&self, reference: &BlobRef) -> Result<PathBuf, String> {
        Ok(self.blob_directory(reference)?.join(&reference.sha256))
    }

    fn verify_path(&self, path: &Path, reference: &BlobRef) -> Result<Vec<u8>, String> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Cannot inspect staged blob {}: {error}", reference.sha256))?;
        if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
            return Err(format!(
                "Staged blob {} is not a regular file.",
                reference.sha256
            ));
        }
        if metadata.len() != reference.bytes || metadata.len() > MAXIMUM_BLOB_BYTES {
            return Err(format!(
                "Staged blob {} has unexpected size.",
                reference.sha256
            ));
        }
        let bytes = fs::read(path)
            .map_err(|error| format!("Cannot read staged blob {}: {error}", reference.sha256))?;
        if sha256(&bytes) != reference.sha256 {
            return Err(format!(
                "Staged blob {} failed digest verification.",
                reference.sha256
            ));
        }
        if reference.content_kind == BlobContentKind::Utf8Text
            && std::str::from_utf8(&bytes).is_err()
        {
            return Err(format!(
                "Staged blob {} is not valid UTF-8 text.",
                reference.sha256
            ));
        }
        Ok(bytes)
    }
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| {
        format!(
            "Cannot create blob-store directory {}: {error}",
            path.display()
        )
    })?;
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        format!(
            "Cannot inspect blob-store directory {}: {error}",
            path.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Blob-store path is not a regular directory: {}.",
            path.display()
        ));
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Cannot sync blob-store directory: {error}"))?;
    }
    #[cfg(windows)]
    {
        let _ = path;
    }
    Ok(())
}
