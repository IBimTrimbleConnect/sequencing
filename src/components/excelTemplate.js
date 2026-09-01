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
  let headerRowIndex = null;
  let planRowIndex = null;
  let groupRowIndex = null;
  let itemRowIndex = null;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const text = getCellText(cell);
      if (!text) return;

      if (text.trim() === "Sequence No") headerRowIndex = rowNumber;
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

  if (!headerRowIndex) throw new Error("Missing Sequence No header in Excel template.");
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

  return { headerRowIndex, planRowIndex, groupRowIndex, itemRowIndex };
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

const getExportColumnHeader = (column) => {
  const field = String(column?.field || "").trim();
  if (!field) return "";

  return field.includes("+") ? field.split("+").pop().trim() : field;
};

const configureColumnSetTemplate = (
  worksheet,
  headerRowIndex,
  planRowIndex,
  groupRowIndex,
  itemRowIndex,
  columns,
) => {
  const headerRow = worksheet.getRow(headerRowIndex);
  const planRow = worksheet.getRow(planRowIndex);
  const groupRow = worksheet.getRow(groupRowIndex);
  const itemRow = worksheet.getRow(itemRowIndex);
  const headerStyle = clone(headerRow.getCell(2).style);
  const planStyle = clone(planRow.getCell(2).style);
  const groupStyle = clone(groupRow.getCell(2).style);
  const itemStyle = clone(itemRow.getCell(2).style);
  const requiredColumnCount = 1 + columns.length;
  const clearUntil = Math.max(worksheet.columnCount, requiredColumnCount);

  for (let columnNumber = 1; columnNumber <= clearUntil; columnNumber += 1) {
    headerRow.getCell(columnNumber).value = null;
    itemRow.getCell(columnNumber).value = null;
  }

  headerRow.getCell(1).value = "Sequence No";
  itemRow.getCell(1).value = "{{SequenceNo}}";

  columns.forEach((column, index) => {
    const columnNumber = index + 2;
    const field = String(column.field).trim();
    const headerCell = headerRow.getCell(columnNumber);
    const itemCell = itemRow.getCell(columnNumber);

    if (columnNumber > 1) {
      headerCell.style = clone(headerStyle);
      itemCell.style = clone(itemStyle);
      planRow.getCell(columnNumber).style = clone(planStyle);
      groupRow.getCell(columnNumber).style = clone(groupStyle);
    }

    headerCell.value = getExportColumnHeader(column);
    itemCell.value = `{{${field}}}`;
    worksheet.getColumn(columnNumber).width = Math.max(
      12,
      Math.min(32, getExportColumnHeader(column).length + 4),
    );
  });

  headerRow.commit();
  planRow.commit();
  groupRow.commit();
  itemRow.commit();
};

export const fillGroups = (worksheet, planGroups, columns = []) => {
  const { headerRowIndex, planRowIndex, groupRowIndex, itemRowIndex } =
    findTemplateRows(worksheet);

  const exportColumns = (columns || []).filter((column) => {
    const field = String(column?.field || "").trim();
    return field && field.toLowerCase() !== "name";
  });

  configureColumnSetTemplate(
    worksheet,
    headerRowIndex,
    planRowIndex,
    groupRowIndex,
    itemRowIndex,
    exportColumns,
  );

  let insertAt = itemRowIndex + 1;
  let sequenceNumber = 1;

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

      items.forEach((item) => {
        const itemRow = copyRowTo(worksheet, itemRowIndex, insertAt++);

        fillRow(itemRow, {
          SequenceNo: sequenceNumber,
          ...(item.DataTableValues || {}),
        });

        sequenceNumber += 1;
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
