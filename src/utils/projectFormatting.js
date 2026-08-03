const DEFAULT_FORMATTING = {
  unitSystem: "metric",
  lengthUnit: "mm",
  lengthDecimals: 0,
  massUnit: "kg",
  massDecimals: 2,
};

export const normalizeUnit = (unit) =>
  String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

export const roundByDecimals = (value, decimals = 2) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  const numericDecimals = Number(decimals);

  const safeDecimals = Number.isInteger(numericDecimals)
    ? Math.max(0, numericDecimals)
    : 2;

  const factor = 10 ** safeDecimals;

  return Math.round((numericValue + Number.EPSILON) * factor) / factor;
};

const greatestCommonDivisor = (a, b) => {
  let first = Math.abs(Number(a));
  let second = Math.abs(Number(b));

  while (second !== 0) {
    const temporary = second;
    second = first % second;
    first = temporary;
  }

  return first || 1;
};

const getFeetInchesDenominator = (formatting) => {
  const configured = Number(
    formatting?.lengthFractionDenominator ??
      formatting?.fractionDenominator,
  );

  return [2, 4, 8, 16, 32, 64].includes(configured)
    ? configured
    : 16;
};

const formatFeetInchesFraction = (valueMm, denominator = 16) => {
  const lengthMm = Number(valueMm);

  if (!Number.isFinite(lengthMm)) {
    return "";
  }

  const sign = lengthMm < 0 ? "-" : "";
  const totalInches = Math.abs(lengthMm) / 25.4;

  let feet = Math.floor(totalInches / 12);
  const remainingInches = totalInches - feet * 12;

  let wholeInches = Math.floor(remainingInches);
  let numerator = Math.round(
    (remainingInches - wholeInches) * denominator,
  );

  if (numerator >= denominator) {
    wholeInches += 1;
    numerator = 0;
  }

  if (wholeInches >= 12) {
    feet += Math.floor(wholeInches / 12);
    wholeInches %= 12;
  }

  if (numerator === 0) {
    return `${sign}${feet}'-${wholeInches}"`;
  }

  const divisor = greatestCommonDivisor(numerator, denominator);

  return `${sign}${feet}'-${wholeInches} ${
    numerator / divisor
  }/${denominator / divisor}"`;
};

export const convertLengthFromMm = (
  value,
  formatting = DEFAULT_FORMATTING,
) => {
  const lengthMm = Number(value);

  if (!Number.isFinite(lengthMm)) {
    return "";
  }

  const targetUnit = normalizeUnit(formatting?.lengthUnit || "mm");
  const decimals = formatting?.lengthDecimals ?? 0;

  let convertedValue = lengthMm;

  switch (targetUnit) {
    case "cm":
      convertedValue = lengthMm / 10;
      break;
    case "m":
      convertedValue = lengthMm / 1000;
      break;
    case "km":
      convertedValue = lengthMm / 1_000_000;
      break;
    case "in":
    case "inch":
    case "inches":
      convertedValue = lengthMm / 25.4;
      break;
    case "ft":
    case "foot":
    case "feet":
      convertedValue = lengthMm / 304.8;
      break;
    case "ft-in":
    case "ftin":
    case "feet-inches":
    case "feet-inch":
    case "foot-inch":
      return formatFeetInchesFraction(
        lengthMm,
        getFeetInchesDenominator(formatting),
      );
    case "yd":
    case "yard":
    case "yards":
      convertedValue = lengthMm / 914.4;
      break;
    case "mi":
    case "mile":
    case "miles":
      convertedValue = lengthMm / 1_609_344;
      break;
    case "sin":
      convertedValue = lengthMm / (1200 / 39.37);
      break;
    case "sft":
      convertedValue = lengthMm / (1200 / 3.937);
      break;
    case "syd":
      convertedValue = lengthMm / ((1200 / 3.937) * 3);
      break;
    case "smi":
      convertedValue = lengthMm / ((1200 / 3.937) * 5280);
      break;
    default:
      convertedValue = lengthMm;
      break;
  }

  return roundByDecimals(convertedValue, decimals);
};

export const convertMassFromKg = (
  value,
  formatting = DEFAULT_FORMATTING,
) => {
  const massKg = Number(value);

  if (!Number.isFinite(massKg)) {
    return "";
  }

  const targetUnit = normalizeUnit(formatting?.massUnit || "kg");
  const decimals = formatting?.massDecimals ?? 2;

  let convertedValue = massKg;

  switch (targetUnit) {
    case "mg":
      convertedValue = massKg * 1_000_000;
      break;
    case "g":
    case "gram":
    case "grams":
      convertedValue = massKg * 1000;
      break;
    case "t":
    case "tonne":
    case "tonnes":
    case "metric-ton":
    case "metricton":
      convertedValue = massKg / 1000;
      break;
    case "oz":
    case "ounce":
    case "ounces":
      convertedValue = massKg * 35.2739619496;
      break;
    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      convertedValue = massKg * 2.20462262185;
      break;
    case "ton":
    case "short-ton":
    case "shortton":
      convertedValue = massKg / 907.18474;
      break;
    case "long-ton":
    case "longton":
      convertedValue = massKg / 1016.0469088;
      break;
    default:
      convertedValue = massKg;
      break;
  }

  return roundByDecimals(convertedValue, decimals);
};

export const getDisplayLengthUnit = (
  formatting = DEFAULT_FORMATTING,
) => {
  const unit = normalizeUnit(formatting?.lengthUnit || "mm");

  switch (unit) {
    case "inch":
    case "inches":
      return "in";
    case "foot":
    case "feet":
      return "ft";
    case "feet-inches":
    case "feet-inch":
    case "foot-inch":
    case "ftin":
      return "ft-in";
    case "yard":
    case "yards":
      return "yd";
    case "mile":
    case "miles":
      return "mi";
    default:
      return unit || "mm";
  }
};

export const getDisplayMassUnit = (
  formatting = DEFAULT_FORMATTING,
) => {
  const unit = normalizeUnit(formatting?.massUnit || "kg");

  switch (unit) {
    case "gram":
    case "grams":
      return "g";
    case "kilogram":
    case "kilograms":
      return "kg";
    case "lbs":
    case "pound":
    case "pounds":
      return "lb";
    case "ounce":
    case "ounces":
      return "oz";
    case "tonne":
    case "tonnes":
    case "metric-ton":
    case "metricton":
      return "t";
    case "short-ton":
    case "shortton":
      return "ton";
    case "longton":
      return "long-ton";
    default:
      return unit || "kg";
  }
};

export const normalizeProjectFormatting = (formatting = {}) => ({
  unitSystem:
    formatting?.unitSystem || DEFAULT_FORMATTING.unitSystem,
  lengthUnit:
    formatting?.lengthUnit || DEFAULT_FORMATTING.lengthUnit,
  lengthDecimals:
    formatting?.lengthDecimals ?? DEFAULT_FORMATTING.lengthDecimals,
  lengthFractionDenominator:
    formatting?.lengthFractionDenominator ??
    formatting?.fractionDenominator ??
    16,
  massUnit:
    formatting?.massUnit || DEFAULT_FORMATTING.massUnit,
  massDecimals:
    formatting?.massDecimals ?? DEFAULT_FORMATTING.massDecimals,
});

export const formatCog = (
  cog,
  formatting = DEFAULT_FORMATTING,
) => {
  if (!Array.isArray(cog) || cog.length < 3) {
    return "";
  }

  const values = cog
    .slice(0, 3)
    .map((value) => convertLengthFromMm(value, formatting));

  if (values.some((value) => value === "" || value == null)) {
    return "";
  }

  const lengthUnit = getDisplayLengthUnit(formatting);
  const unitText = lengthUnit === "ft-in" ? "" : ` ${lengthUnit}`;

  return `(${values[0]}, ${values[1]}, ${values[2]})${unitText}`;
};

export { DEFAULT_FORMATTING };
