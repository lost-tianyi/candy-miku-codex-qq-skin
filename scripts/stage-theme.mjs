import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { loadDeepThemeDirectory } from "./deep-theme-core.mjs";

const [sourceDirArg, stageDirArg] = process.argv.slice(2);
if (!sourceDirArg || !stageDirArg) {
  throw new Error("Usage: stage-theme.mjs <source-theme-dir> <stage-dir>");
}

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function assertContained(rootPath, candidatePath, label) {
  const relative = path.relative(rootPath, candidatePath);
  if (
    relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) return;
  throw new Error(`${label} must stay inside its theme directory`);
}

function sameStat(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readStableFile(filePath, label, maxBytes) {
  let handle;
  const pathBefore = await fs.lstat(filePath);
  if (pathBefore.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  if (!pathBefore.isFile()) throw new Error(`${label} must be a regular file`);
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    if (!sameStat(pathBefore, before)) throw new Error(`${label} changed before it was staged`);
    if (before.size > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await fs.lstat(filePath);
    if (pathAfter.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
    if (!sameStat(before, after) || !sameStat(after, pathAfter)) {
      throw new Error(`${label} changed while it was being staged`);
    }
    if (bytes.length > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

function decodeJson(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error(`${label} contains NUL characters`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function writeExclusive(filePath, bytes) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function main() {
  const sourceRoot = await fs.realpath(sourceDirArg);
  const sourceStat = await fs.stat(sourceRoot);
  if (!sourceStat.isDirectory()) throw new Error("Theme source must be a directory");

  const configPath = path.join(sourceRoot, "theme.json");
  const config = await readStableFile(configPath, "Theme config", MAX_CONFIG_BYTES);
  const theme = decodeJson(config.bytes, "Theme config");
  if (theme?.schemaVersion === 2) {
    const loaded = await loadDeepThemeDirectory(sourceRoot);
    const stageRoot = await fs.realpath(stageDirArg);
    if (!(await fs.stat(stageRoot)).isDirectory()) throw new Error("Theme stage must be a directory");
    for (const asset of Object.values(loaded.assets)) {
      assertContained(stageRoot, path.join(stageRoot, asset.filename), `Staged asset ${asset.filename}`);
      await writeExclusive(path.join(stageRoot, asset.filename), asset.bytes);
    }
    await writeExclusive(path.join(stageRoot, "theme.json"), loaded.configBytes);
    process.stdout.write(loaded.theme.assets.background);
    return;
  }
  if (theme?.schemaVersion !== 1 || typeof theme.image !== "string" || !theme.image) {
    throw new Error("Theme config has an unsupported schema or image field");
  }
  const optionalAssetNames = ["pet", "avatar", "overlayPet"];
  const stagedAssetNames = [theme.image];
  const extraAssetNames = [];
  if (theme.petFrames !== undefined) {
    if (!Array.isArray(theme.petFrames) || theme.petFrames.length > 8) {
      throw new Error("Theme petFrames field must be an array with at most 8 entries");
    }
    for (const [index, frame] of theme.petFrames.entries()) {
      if (!frame || typeof frame !== "object" || Array.isArray(frame) || typeof frame.image !== "string" || !frame.image) {
        throw new Error(`Theme petFrames[${index}].image must be a non-empty string`);
      }
      extraAssetNames.push(frame.image);
    }
  }
  if (theme.overlayPetFrames !== undefined) {
    if (!Array.isArray(theme.overlayPetFrames) || theme.overlayPetFrames.length > 8) {
      throw new Error("Theme overlayPetFrames field must be an array with at most 8 entries");
    }
    for (const [index, frame] of theme.overlayPetFrames.entries()) {
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
        throw new Error(`Theme overlayPetFrames[${index}] must be an object`);
      }
      if (Array.isArray(frame.images)) {
        if (frame.images.length < 1 || frame.images.length > 8) {
          throw new Error(`Theme overlayPetFrames[${index}].images must have 1-8 entries`);
        }
        for (const image of frame.images) {
          if (typeof image !== "string" || !image) {
            throw new Error(`Theme overlayPetFrames[${index}].images entries must be non-empty strings`);
          }
          extraAssetNames.push(image);
        }
        continue;
      }
      if (typeof frame.image !== "string" || !frame.image) {
        throw new Error(`Theme overlayPetFrames[${index}].image must be a non-empty string`);
      }
      extraAssetNames.push(frame.image);
    }
  }
  if (theme.overlayLive2D !== undefined) {
    if (!theme.overlayLive2D || typeof theme.overlayLive2D !== "object" || Array.isArray(theme.overlayLive2D)) {
      throw new Error("Theme overlayLive2D field must be an object");
    }
    if (!Array.isArray(theme.overlayLive2D.layers) || theme.overlayLive2D.layers.length < 1 || theme.overlayLive2D.layers.length > 16) {
      throw new Error("Theme overlayLive2D.layers must have 1-16 entries");
    }
    const collectLive2DLayers = (layers, label) => {
      for (const [index, layer] of layers.entries()) {
        if (!layer || typeof layer !== "object" || Array.isArray(layer) || typeof layer.image !== "string" || !layer.image) {
          throw new Error(`Theme ${label}[${index}].image must be a non-empty string`);
        }
        extraAssetNames.push(layer.image);
      }
    };
    collectLive2DLayers(theme.overlayLive2D.layers, "overlayLive2D.layers");
    if (theme.overlayLive2D.states !== undefined) {
      if (!theme.overlayLive2D.states || typeof theme.overlayLive2D.states !== "object"
        || Array.isArray(theme.overlayLive2D.states)) {
        throw new Error("Theme overlayLive2D.states must be an object");
      }
      for (const [stateName, pack] of Object.entries(theme.overlayLive2D.states)) {
        if (!pack || typeof pack !== "object" || Array.isArray(pack)
          || !Array.isArray(pack.layers) || pack.layers.length < 1) {
          throw new Error(`Theme overlayLive2D.states.${stateName} must have layers`);
        }
        collectLive2DLayers(pack.layers, `overlayLive2D.states.${stateName}.layers`);
      }
    }
  }
  for (const field of ["image", ...optionalAssetNames]) {
    if (theme[field] === undefined) continue;
    if (typeof theme[field] !== "string" || !theme[field]) {
      throw new Error(`Theme ${field} field must be a non-empty string`);
    }
    if (path.basename(theme[field]) !== theme[field]) {
      throw new Error(`Theme ${field} must stay inside its theme directory`);
    }
    if (theme[field] === "theme.json") {
      throw new Error(`Theme ${field} must not replace theme.json`);
    }
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(theme[field])) {
      throw new Error(`Theme ${field} contains control characters`);
    }
    if (field !== "image") stagedAssetNames.push(theme[field]);
  }
  for (const assetName of extraAssetNames) {
    if (path.basename(assetName) !== assetName) {
      throw new Error("Theme petFrames image must stay inside its theme directory");
    }
    if (assetName === "theme.json") {
      throw new Error("Theme petFrames image must not replace theme.json");
    }
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(assetName)) {
      throw new Error("Theme petFrames image contains control characters");
    }
    stagedAssetNames.push(assetName);
  }

  const imagePath = path.resolve(sourceRoot, theme.image);
  assertContained(sourceRoot, imagePath, "Theme image");
  const image = await readStableFile(imagePath, "Theme image", MAX_IMAGE_BYTES);
  if (image.bytes.length < 1) throw new Error("Theme image is empty");

  const stageRoot = await fs.realpath(stageDirArg);
  const stageStat = await fs.stat(stageRoot);
  if (!stageStat.isDirectory()) throw new Error("Theme stage must be a directory");
  assertContained(stageRoot, path.join(stageRoot, "theme.json"), "Staged theme config");
  for (const assetName of stagedAssetNames) {
    assertContained(stageRoot, path.join(stageRoot, assetName), `Staged theme asset ${assetName}`);
  }

  // Write both files from the already-open, stable descriptors. The caller
  // publishes the image first and theme.json last, so the watcher only ever
  // observes a complete pair; subsequent source edits cannot race the copy.
  await writeExclusive(path.join(stageRoot, theme.image), image.bytes);
  for (const field of optionalAssetNames) {
    const assetName = theme[field];
    if (!assetName) continue;
    const assetPath = path.resolve(sourceRoot, assetName);
    assertContained(sourceRoot, assetPath, `Theme ${field}`);
    const asset = await readStableFile(assetPath, `Theme ${field}`, MAX_IMAGE_BYTES);
    if (asset.bytes.length < 1) throw new Error(`Theme ${field} is empty`);
    await writeExclusive(path.join(stageRoot, assetName), asset.bytes);
  }
  for (const assetName of extraAssetNames) {
    const assetPath = path.resolve(sourceRoot, assetName);
    assertContained(sourceRoot, assetPath, "Theme petFrames image");
    const asset = await readStableFile(assetPath, "Theme petFrames image", MAX_IMAGE_BYTES);
    if (asset.bytes.length < 1) throw new Error("Theme petFrames image is empty");
    await writeExclusive(path.join(stageRoot, assetName), asset.bytes);
  }
  await writeExclusive(path.join(stageRoot, "theme.json"), config.bytes);
  process.stdout.write(theme.image);
}

await main();
