export function parseByteRange(rangeHeader, size) {
  if (typeof rangeHeader !== "string" || size < 0) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, startText, endText] = match;

  if (startText === "" && endText === "") {
    return null;
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(size - suffixLength, 0);
    const end = size - 1;

    if (size === 0) {
      return null;
    }

    return { start, end };
  }

  const start = Number(startText);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return null;
  }

  let end = size - 1;
  if (endText !== "") {
    end = Number(endText);
    if (!Number.isInteger(end) || end < start) {
      return null;
    }
    end = Math.min(end, size - 1);
  }

  return { start, end };
}
