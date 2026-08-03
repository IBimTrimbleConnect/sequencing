const parseNumericValue = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (value == null || value === "") {
    return null;
  }

  const normalizedValue = String(value)
    .replace(/,/g, "")
    .trim();

  const parsedValue =
    Number.parseFloat(normalizedValue);

  return Number.isFinite(parsedValue)
    ? parsedValue
    : null;
};

const normalizePropertyName = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_\s/-]+/g, " ");

const findPropertyValue = (
  propertyGroups,
  matcher,
) => {
  for (const group of propertyGroups || []) {
    const groupName =
      normalizePropertyName(
        group?.name,
      );

    for (
      const property of
      group?.properties || []
    ) {
      const name = String(
        property?.name || "",
      ).trim();

      const upperName =
        name.toUpperCase();

      const normalizedName =
        normalizePropertyName(name);

      const value =
        property?.value;

      if (
        matcher({
          name,
          upperName,
          normalizedName,
          groupName,
          value,
        })
      ) {
        return value;
      }
    }
  }

  return null;
};

const findAssemblyPosition = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({
      name,
      upperName,
      normalizedName,
    }) =>
      name ===
        "Assembly/Cast unit Mark" ||
      upperName ===
        "ASSEMBLY_POS" ||
      normalizedName ===
        "ASSEMBLY POS" ||
      normalizedName ===
        "ASSEMBLY CAST UNIT MARK",
  );

const findPositionCode = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({
      name,
      upperName,
      normalizedName,
    }) =>
      name ===
        "Assembly/Cast unit position code" ||
      upperName ===
        "ASSEMBLY_POSITION_CODE" ||
      upperName === "GRID_POS" ||
      normalizedName ===
        "ASSEMBLY POSITION CODE" ||
      normalizedName ===
        "ASSEMBLY CAST UNIT POSITION CODE" ||
      normalizedName ===
        "POSITION CODE" ||
      normalizedName ===
        "GRID POS",
  );

const findWeight = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({
      normalizedName,
      groupName,
    }) => {
      const isWeightProperty =
        normalizedName === "WEIGHT" ||
        normalizedName ===
          "ASSEMBLY WEIGHT" ||
        normalizedName ===
          "CAST UNIT WEIGHT" ||
        normalizedName.endsWith(
          " WEIGHT",
        );

      const isRelevantGroup =
        !groupName ||
        groupName.includes(
          "ASSEMBLY",
        ) ||
        groupName.includes(
          "QUANTITY",
        ) ||
        groupName.includes(
          "PROPERTY",
        ) ||
        groupName.includes(
          "PRODUCT",
        );

      return (
        isWeightProperty &&
        isRelevantGroup
      );
    },
  );

const findLength = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({
      normalizedName,
      groupName,
    }) => {
      const isLengthProperty =
        normalizedName === "LENGTH" ||
        normalizedName ===
          "ASSEMBLY LENGTH" ||
        normalizedName ===
          "CAST UNIT LENGTH" ||
        normalizedName.endsWith(
          " LENGTH",
        );

      const isRelevantGroup =
        !groupName ||
        groupName.includes(
          "ASSEMBLY",
        ) ||
        groupName.includes(
          "QUANTITY",
        ) ||
        groupName.includes(
          "PROPERTY",
        ) ||
        groupName.includes(
          "PRODUCT",
        );

      return (
        isLengthProperty &&
        isRelevantGroup
      );
    },
  );

const findCogX = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({ normalizedName }) =>
      normalizedName ===
        "CENTER OF GRAVITY X" ||
      normalizedName ===
        "CENTRE OF GRAVITY X" ||
      normalizedName ===
        "GRAVITY X" ||
      normalizedName ===
        "COG X" ||
      normalizedName === "COGX",
  );

const findCogY = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({ normalizedName }) =>
      normalizedName ===
        "CENTER OF GRAVITY Y" ||
      normalizedName ===
        "CENTRE OF GRAVITY Y" ||
      normalizedName ===
        "GRAVITY Y" ||
      normalizedName ===
        "COG Y" ||
      normalizedName === "COGY",
  );

const findCogZ = (
  propertyGroups,
) =>
  findPropertyValue(
    propertyGroups,
    ({ normalizedName }) =>
      normalizedName ===
        "CENTER OF GRAVITY Z" ||
      normalizedName ===
        "CENTRE OF GRAVITY Z" ||
      normalizedName ===
        "GRAVITY Z" ||
      normalizedName ===
        "COG Z" ||
      normalizedName === "COGZ",
  );

const findAssemblyName = (
  item,
  propertyGroups,
) => {
  const productName = String(
    item?.product?.name || "",
  ).trim();

  if (productName) {
    return productName;
  }

  const propertyValue =
    findPropertyValue(
      propertyGroups,
      ({
        normalizedName,
        groupName,
      }) => {
        const isNameProperty =
          normalizedName ===
            "ASSEMBLY NAME" ||
          normalizedName ===
            "CAST UNIT NAME" ||
          normalizedName === "NAME";

        const isRelevantGroup =
          groupName.includes(
            "ASSEMBLY",
          ) ||
          groupName.includes(
            "PRODUCT",
          ) ||
          groupName.includes(
            "COMMON",
          );

        return (
          isNameProperty &&
          isRelevantGroup
        );
      },
    );

  return String(
    propertyValue || "",
  ).trim();
};

export const extractRuntimeObjectProperties = (
  item,
) => {
  const propertyGroups =
    item?.properties || [];

  const asmPosValue =
    findAssemblyPosition(
      propertyGroups,
    );

  const positionCodeValue =
    findPositionCode(
      propertyGroups,
    );

  const weightValue =
    findWeight(propertyGroups);

  const lengthValue =
    findLength(propertyGroups);

  const cogXValue =
    findCogX(propertyGroups);

  const cogYValue =
    findCogY(propertyGroups);

  const cogZValue =
    findCogZ(propertyGroups);

  const rawWeight =
    parseNumericValue(weightValue);

  const rawLength =
    parseNumericValue(lengthValue);

  const cogX =
    parseNumericValue(cogXValue);

  const cogY =
    parseNumericValue(cogYValue);

  const cogZ =
    parseNumericValue(cogZValue);

  const rawCog =
    cogX != null &&
    cogY != null &&
    cogZ != null
      ? [cogX, cogY, cogZ]
      : null;

  const asmName =
    findAssemblyName(
      item,
      propertyGroups,
    );

  const asmPos = String(
    asmPosValue || "",
  )
    .replace("(?)", "")
    .trim();

  const positionCode = String(
    positionCodeValue || "",
  ).trim();

  return {
    asmPos,

    asmName,
    name: asmName,

    positionCode,

    /*
     * Raw runtime values:
     * - weight: kilograms
     * - length: millimetres
     * - cog: millimetres
     */
    rawWeight,
    rawLength,
    rawCog,

    /*
     * Compatibility fields.
     * These are still raw values.
     */
    weight: rawWeight,
    length: rawLength,
    cog: rawCog,
  };
};

export {
  parseNumericValue,
  findPropertyValue,
};