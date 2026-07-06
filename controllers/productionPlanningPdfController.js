const fs = require("fs");
const { PDFParse } = require("pdf-parse");

const cleanLine = (value) => {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
};

const extractTopLeftPartyName = (text) => {
  const lines = text
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const deliveryIndex = lines.findIndex((line) =>
    line.toUpperCase().includes("DELIVERY CHALLAN"),
  );

  if (deliveryIndex !== -1 && lines[deliveryIndex + 1]) {
    return lines[deliveryIndex + 1];
  }

  return lines[0] || "";
};

const extractMaterialDescription = (text) => {
  const match = text.match(/1\s*-\s*([\s\S]*?)\n\s*\d{7}\s*/i);

  if (!match) {
    return "";
  }

  return cleanLine(match[1]);
};

const extractThirdPartyName = (text) => {
  // Get text between SGST line and Round Off
  const sgstToRoundOffMatch = text.match(
    /SGST\s*:\s*9\.00%\s*[\d,]+\.\d{2}([\s\S]*?)Round\s*Off/i,
  );

  if (sgstToRoundOffMatch) {
    const middleText = sgstToRoundOffMatch[1];

    const lines = middleText
      .split("\n")
      .map((line) => cleanLine(line))
      .filter(Boolean);

    if (lines.length > 0) {
      return lines[lines.length - 1];
    }
  }

  return "";
};

const extractPlanningPdf = async (req, res) => {
  let filePath;
  let parser;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "PDF file is required",
      });
    }

    filePath = req.file.path;

    parser = new PDFParse({
      data: fs.readFileSync(filePath),
    });

    const pdfData = await parser.getText();
    const text = pdfData.text || "";

    const challanNo =
      text.match(/Challan\s*No\.?\s*:\s*([A-Z0-9/-]+)/i)?.[1] || "";

    const partyName = extractTopLeftPartyName(text);

    const materialDescription = extractMaterialDescription(text);

    const qtyMatches = [...materialDescription.matchAll(/(\d+)\s*NOS/gi)];

    const plannedQty = qtyMatches.reduce((sum, match) => {
      return sum + Number(match[1] || 0);
    }, 0);

    const thirdPartyName = extractThirdPartyName(text);

    return res.json({
      success: true,
      message: "PDF extracted successfully",
      data: {
        challan_no: cleanLine(challanNo),
        party_name: cleanLine(partyName),
        material_description: materialDescription,
        planned_qty: plannedQty ? String(plannedQty) : "",
        third_party_name: thirdPartyName,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "PDF extraction failed",
      error: error.message,
    });
  } finally {
    try {
      if (parser) {
        await parser.destroy();
      }
    } catch (error) {}

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};

module.exports = {
  extractPlanningPdf,
};
