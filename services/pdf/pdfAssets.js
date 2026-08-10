const fs = require("fs");
const path = require("path");

const PDF_ASSET_DIR = path.join(__dirname, "../../assets/pdf");
const assetCache = new Map();

const readPdfAsset = filename => {
  if (assetCache.has(filename)) return assetCache.get(filename);

  let bytes = null;
  try {
    bytes = fs.readFileSync(path.join(PDF_ASSET_DIR, filename));
  } catch (error) {
    // The generators already render a text fallback when an asset is absent.
  }

  assetCache.set(filename, bytes);
  return bytes;
};

module.exports = { readPdfAsset };
