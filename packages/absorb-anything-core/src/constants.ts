/** npm product version. */
export const PRODUCT_VERSION = "0.1.0";
/** Persisted envelope version retained from the compatible on-disk format. */
export const CURRENT_VERSION = "0.14.0";
export const LAYOUT_VERSION = 8;
export const MANIFEST_SCHEMA = 4;
export const MIGRATABLE_VERSION = "0.13.0";
/** Retained only for error messages that describe compatible foreign records. */
export const SYSTEMS_REGISTRY_SCHEMA = 3;

/** Persisted logical token. It is projected to the selected physical envelope at runtime. */
export const MANAGED_DIR = ".assay";
export const PREFERRED_ENVELOPE_DIR = ".absorb";
export const LEGACY_ENVELOPE_DIR = ".assay";
export const MANIFEST_FILE = `${MANAGED_DIR}/manifest.json`;
export const MANAGED_FILES_FILE = `${MANAGED_DIR}/managed-files.json`;
export const EVENTS_DIR = `${MANAGED_DIR}/events`;
export const BACKUPS_DIR = `${MANAGED_DIR}/backups`;
export const SYSTEMS_REGISTRY_FILE = `${MANAGED_DIR}/systems-registry.json`;
