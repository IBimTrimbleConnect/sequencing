const getCellText = (cell) => {
  if (!cell?.value) return "";
  if (typeof cell.value === "string") return cell.value;
  if (cell.value.richText) {
    return cell.value.richText.map((item) => item.text).join("");
  }
  if (cell.value.text) return cell.value.text;
  if (cell.value.result != null) return String(cell.value.result);
  return "";
};

const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
};

const fillText = (value, data, keepMissing = true) => {
  if (typeof value !== "string") return value;

  return value.replace(/\{\{\s*(.*?)\s*\}\}/g, (match, key) => {
    const field = key.trim();

    return Object.prototype.hasOwnProperty.call(data, field)
      ? data[field] ?? ""
      : keepMissing
        ? match
        : "";
  });
};

export const fillRow = (row, data, keepMissing = false) => {
  row.eachCell({ includeEmpty: true }, (cell) => {
    const text = getCellText(cell);
    if (text) cell.value = fillText(text, data, keepMissing);
  });
  row.commit();
};

export const fillHeader = (worksheet, data) => {
  worksheet.eachRow((row) => fillRow(row, data, true));
};

export const findTemplateRows = (worksheet) => {
  let planRowIndex = null;
  let groupRowIndex = null;
  let itemRowIndex = null;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const text = getCellText(cell);
      if (!text) return;

      if (text.includes("{{PlanName}}")) planRowIndex = rowNumber;
      if (text.includes("{{GroupDate}}") || text.includes("{{Qty}}")) {
        groupRowIndex = rowNumber;
      }
      if (
        text.includes("{{Index}}") ||
        text.includes("{{AsmName}}") ||
        text.includes("{{AsmPos}}")
      ) {
        itemRowIndex = rowNumber;
      }
    });
  });

  if (!planRowIndex) throw new Error("Missing {{PlanName}} in Excel template.");
  if (!groupRowIndex) {
    throw new Error("Missing {{GroupDate}} or {{Qty}} in Excel template.");
  }
  if (!itemRowIndex) {
    throw new Error(
      "Missing {{Index}}, {{AsmName}} or {{AsmPos}} in Excel template.",
    );
  }
  if (!(planRowIndex < groupRowIndex && groupRowIndex < itemRowIndex)) {
    throw new Error(
      "Template row order must be {{PlanName}} → {{GroupDate}} → {{Index}}.",
    );
  }

  return { planRowIndex, groupRowIndex, itemRowIndex };
};

export const copyRowTo = (worksheet, sourceRowNumber, targetRowNumber) => {
  worksheet.spliceRows(targetRowNumber, 0, []);

  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);

  targetRow.height = sourceRow.height;
  targetRow.hidden = sourceRow.hidden;
  targetRow.outlineLevel = sourceRow.outlineLevel;

  sourceRow.eachCell({ includeEmpty: true }, (sourceCell, columnNumber) => {
    const targetCell = targetRow.getCell(columnNumber);

    targetCell.value = clone(sourceCell.value);
    targetCell.style = clone(sourceCell.style);
    targetCell.numFmt = sourceCell.numFmt;
    targetCell.alignment = clone(sourceCell.alignment);
    targetCell.border = clone(sourceCell.border);
    targetCell.fill = clone(sourceCell.fill);
    targetCell.font = clone(sourceCell.font);
    targetCell.protection = clone(sourceCell.protection);
  });

  targetRow.commit();
  return targetRow;
};

export const fillGroups = (worksheet, planGroups) => {
  const { planRowIndex, groupRowIndex, itemRowIndex } =
    findTemplateRows(worksheet);

  let insertAt = itemRowIndex + 1;

  planGroups.forEach((plan, planIndex) => {
    if (!plan?.groups?.length) return;

    const planRow = copyRowTo(worksheet, planRowIndex, insertAt++);
    fillRow(planRow, { PlanName: plan.planName || "" });

    plan.groups.forEach((group) => {
      const items = group.items || [];

      const groupRow = copyRowTo(worksheet, groupRowIndex, insertAt++);
      fillRow(groupRow, {
        GroupDate: group.date || "",
        Qty: items.length,
      });

      items.forEach((item, itemIndex) => {
        const itemRow = copyRowTo(worksheet, itemRowIndex, insertAt++);

        fillRow(itemRow, {
          Index: itemIndex + 1,
          AsmName: item.AsmName || "",
          AsmPos: item.AsmPos || "",
          MainProfile: item.MainProfile || "",
          GridPos: item.GridPos || "",
          Length: item.Length ?? "",
          Weight: item.Weight ?? "",
          Cog: item.Cog || "",
          CogX: item.CogX ?? "",
          CogY: item.CogY ?? "",
          CogZ: item.CogZ ?? "",
          Comment: item.Comment || "",
        });
      });
    });

    if (planIndex < planGroups.length - 1) {
      worksheet.spliceRows(insertAt++, 0, []);
    }
  });

  worksheet.spliceRows(
    planRowIndex,
    itemRowIndex - planRowIndex + 1,
  );
};
