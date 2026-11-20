const fail = message => Object.assign(new Error(message), { status: 400 });

// A line records actual rejected-piece length, independently of the template.
function validateRejectedLines(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw fail('Add between 1 and 200 rejected cut-length lines.');
  const lines = value.map(line => {
    const length = String(line?.cutLengthMm ?? '').trim();
    const pieces = String(line?.pieces ?? '').trim();
    if (!/^\d+(?:\.\d{1,3})?$/.test(length) || Number(length) <= 0 || Number(length) > 1000000) throw fail('Enter rejected cut length above 0 and at most 1000000 mm, with up to three decimals.');
    if (!/^\d+$/.test(pieces) || Number(pieces) < 1 || Number(pieces) > 100000) throw fail('Enter rejected NOS as a whole number from 1 to 100000.');
    return { cutLengthMm: Number(length), pieces: Number(pieces) };
  });
  if (lines.reduce((sum, line) => sum + line.pieces, 0) > 100000) throw fail('Total rejected pieces must not exceed 100000.');
  return lines;
}

module.exports = { validateRejectedLines };
