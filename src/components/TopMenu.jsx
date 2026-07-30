import {
  Button,
  DatePicker,
  Flex,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Tooltip,
} from "antd";

import React, { useState } from "react";

import {
  DownloadOutlined,
  FileSearchOutlined,
  FolderAddOutlined,
} from "@ant-design/icons";

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

import { useDispatch, useSelector } from "react-redux";

import {
  CreatePlanRequest,
  SetActiveSimulationItem,
} from "../store/sequence/action";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
];

const DEFAULT_FORMATTING = {
  unitSystem: "metric",

  lengthUnit: "mm",
  lengthDecimals: 0,

  massUnit: "kg",
  massDecimals: 2,
};

/* =========================================================
 * UNIT HELPERS
 * ======================================================= */

const normalizeUnit = (unit) =>
  String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

const roundByDecimals = (value, decimals = 2) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  const numericDecimals = Number(decimals);

  const safeDecimals = Number.isInteger(numericDecimals)
    ? Math.max(0, numericDecimals)
    : 2;

  const factor = 10 ** safeDecimals;

  return (
    Math.round(
      (numericValue + Number.EPSILON) * factor,
    ) / factor
  );
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
  const configured =
    Number(
      formatting?.lengthFractionDenominator ??
        formatting?.fractionDenominator,
    );

  if (
    [2, 4, 8, 16, 32, 64].includes(configured)
  ) {
    return configured;
  }

  return 16;
};

const formatFeetInchesFraction = (
  valueMm,
  denominator = 16,
) => {
  const lengthMm = Number(valueMm);

  if (!Number.isFinite(lengthMm)) {
    return "";
  }

  const sign = lengthMm < 0 ? "-" : "";
  const absoluteMm = Math.abs(lengthMm);

  const totalInches = absoluteMm / 25.4;

  let feet = Math.floor(totalInches / 12);

  const remainingInches =
    totalInches - feet * 12;

  let wholeInches =
    Math.floor(remainingInches);

  let numerator = Math.round(
    (remainingInches - wholeInches) *
      denominator,
  );

  if (numerator >= denominator) {
    wholeInches += 1;
    numerator = 0;
  }

  if (wholeInches >= 12) {
    feet += Math.floor(
      wholeInches / 12,
    );

    wholeInches =
      wholeInches % 12;
  }

  if (numerator === 0) {
    return `${sign}${feet}'-${wholeInches}"`;
  }

  const divisor =
    greatestCommonDivisor(
      numerator,
      denominator,
    );

  const reducedNumerator =
    numerator / divisor;

  const reducedDenominator =
    denominator / divisor;

  return `${sign}${feet}'-${wholeInches} ${reducedNumerator}/${reducedDenominator}"`;
};


const convertLengthFromMm = (
  value,
  formatting = DEFAULT_FORMATTING,
) => {
  const lengthMm = Number(value);

  if (!Number.isFinite(lengthMm)) {
    return "";
  }

  const targetUnit = normalizeUnit(
    formatting?.lengthUnit || "mm",
  );

  const decimals =
    formatting?.lengthDecimals ?? 0;

  let convertedValue = lengthMm;

  switch (targetUnit) {
    case "mm":
      convertedValue = lengthMm;
      break;

    case "cm":
      convertedValue = lengthMm / 10;
      break;

    case "m":
      convertedValue = lengthMm / 1000;
      break;

    case "km":
      convertedValue =
        lengthMm / 1_000_000;
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
        getFeetInchesDenominator(
          formatting,
        ),
      );

    case "yd":
    case "yard":
    case "yards":
      convertedValue = lengthMm / 914.4;
      break;

    case "mi":
    case "mile":
    case "miles":
      convertedValue =
        lengthMm / 1_609_344;
      break;

    /*
     * US Survey units
     */
    case "sin":
      convertedValue =
        lengthMm / (1200 / 39.37);
      break;

    case "sft":
      convertedValue =
        lengthMm / (1200 / 3.937);
      break;

    case "syd":
      convertedValue =
        lengthMm /
        ((1200 / 3.937) * 3);
      break;

    case "smi":
      convertedValue =
        lengthMm /
        ((1200 / 3.937) * 5280);
      break;

    default:
      convertedValue = lengthMm;
      break;
  }

  return roundByDecimals(
    convertedValue,
    decimals,
  );
};


const convertMassFromKg = (
  value,
  formatting = DEFAULT_FORMATTING,
) => {
  const massKg = Number(value);

  if (!Number.isFinite(massKg)) {
    return "";
  }

  const targetUnit = normalizeUnit(
    formatting?.massUnit || "kg",
  );

  const decimals =
    formatting?.massDecimals ?? 2;

  let convertedValue = massKg;

  switch (targetUnit) {
    case "mg":
      convertedValue =
        massKg * 1_000_000;
      break;

    case "g":
    case "gram":
    case "grams":
      convertedValue =
        massKg * 1000;
      break;

    case "kg":
    case "kilogram":
    case "kilograms":
      convertedValue = massKg;
      break;

    /*
     * Metric tonne
     */
    case "t":
    case "tonne":
    case "tonnes":
    case "metric-ton":
    case "metricton":
      convertedValue =
        massKg / 1000;
      break;

    case "oz":
    case "ounce":
    case "ounces":
      convertedValue =
        massKg * 35.2739619496;
      break;

    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      convertedValue =
        massKg * 2.20462262185;
      break;

    /*
     * US short ton
     */
    case "ton":
    case "short-ton":
    case "shortton":
      convertedValue =
        massKg / 907.18474;
      break;

    /*
     * Imperial long ton
     */
    case "long-ton":
    case "longton":
      convertedValue =
        massKg / 1016.0469088;
      break;

    default:
      convertedValue = massKg;
      break;
  }

  return roundByDecimals(
    convertedValue,
    decimals,
  );
};

const getDisplayLengthUnit = (
  formatting = DEFAULT_FORMATTING,
) => {
  const unit = normalizeUnit(
    formatting?.lengthUnit || "mm",
  );

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

const getDisplayMassUnit = (
  formatting = DEFAULT_FORMATTING,
) => {
  const unit = normalizeUnit(
    formatting?.massUnit || "kg",
  );

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

const normalizeProjectFormatting = (
  formatting = {},
) => {
  return {
    unitSystem:
      formatting?.unitSystem ||
      DEFAULT_FORMATTING.unitSystem,

    lengthUnit:
      formatting?.lengthUnit ||
      DEFAULT_FORMATTING.lengthUnit,

    lengthDecimals:
      formatting?.lengthDecimals ??
      DEFAULT_FORMATTING.lengthDecimals,

    lengthFractionDenominator:
      formatting?.lengthFractionDenominator ??
      formatting?.fractionDenominator ??
      16,

    massUnit:
      formatting?.massUnit ||
      DEFAULT_FORMATTING.massUnit,

    massDecimals:
      formatting?.massDecimals ??
      DEFAULT_FORMATTING.massDecimals,
  };
};

/* =========================================================
 * COG CONVERSION
 *
 * Input cog is assumed to be:
 * [x, y, z] in millimeter.
 * ======================================================= */

const formatCog = (
  cog,
  formatting = DEFAULT_FORMATTING,
) => {
  if (
    !Array.isArray(cog) ||
    cog.length < 3
  ) {
    return "";
  }

  const convertedValues = cog
    .slice(0, 3)
    .map((value) =>
      convertLengthFromMm(
        value,
        formatting,
      ),
    );

  if (
    convertedValues.some(
      (value) =>
        value === "" ||
        value == null,
    )
  ) {
    return "";
  }

  const lengthUnit =
    getDisplayLengthUnit(
      formatting,
    );

  /*
   * ft-in values already contain:
   * ' and "
   */
  const unitText =
    lengthUnit === "ft-in"
      ? ""
      : ` ${lengthUnit}`;

  return `(${convertedValues[0]}, ${convertedValues[1]}, ${convertedValues[2]})${unitText}`;
};

/* =========================================================
 * TOP MENU
 * ======================================================= */

const TopMenu = ({
  projectName: projectNameProp = "",
}) => {
  const dispatch = useDispatch();

  const [form] = Form.useForm();
  const [exportForm] = Form.useForm();

  const plans = useSelector(
    (state) =>
      state.sequence.plans || [],
  );

  const rootFolderId = useSelector(
    (state) =>
      state.sequence.rootFolderId,
  );

  const rootCommentId = useSelector(
    (state) =>
      state.sequence.rootCommentId,
  );

  const sequenceObjects =
    useSelector(
      (state) =>
        state.sequence
          .sequenceObjects || [],
    );

  const projectNameFromRedux =
    useSelector(
      (state) =>
        state.sequence.projectName ||
        "",
    );

  const projectName =
    projectNameProp ||
    projectNameFromRedux ||
    "";

  const [
    isModalOpen,
    setIsModalOpen,
  ] = useState(false);

  const [
    exportModalOpen,
    setExportModalOpen,
  ] = useState(false);

  const [
    exporting,
    setExporting,
  ] = useState(false);

  const planName = Form.useWatch(
    "planName",
    form,
  );

  /* =======================================================
   * CREATE PLAN
   * ===================================================== */

  const handleCreate = async () => {
    try {
      const values =
        await form.validateFields();

      dispatch(
        CreatePlanRequest({
          name:
            values.planName.trim(),

          rootCommentId,
          rootFolderId,
          plans,
        }),
      );

      form.resetFields();
      setIsModalOpen(false);
    } catch (error) {
      if (!error?.errorFields) {
        console.error(
          "Create plan error:",
          error,
        );
      }
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setIsModalOpen(false);
  };

  /* =======================================================
   * HIGHLIGHT SELECTED OBJECT
   * ===================================================== */

  const handleHighlight = async () => {
    try {
      const tcapi =
        await WorkspaceAPI.connect(
          window.parent,
        );

      const selections =
        await tcapi.viewer.getSelection();

      if (!selections?.length) {
        message.warning(
          "Please select an object in Trimble Connect.",
        );

        return;
      }

      const modelId =
        selections[0]?.modelId;

      const runtimeId =
        selections[0]
          ?.objectRuntimeIds?.[0];

      if (
        !modelId ||
        runtimeId == null
      ) {
        message.warning(
          "The selected object is invalid.",
        );

        return;
      }

      let found = null;

      for (
        const group of sequenceObjects
      ) {
        const objects =
          group?.objects || [];

        const obj = objects.find(
          (item) => {
            const objRuntimeId =
              item.id ??
              item.runtimeId ??
              item.objectRuntimeId;

            const objModelId =
              item.modelId ??
              group.modelId;

            return (
              String(objModelId) ===
                String(modelId) &&
              String(objRuntimeId) ===
                String(runtimeId)
            );
          },
        );

        if (obj) {
          found = {
            planId:
              group.planId ??
              group.id ??
              obj.planId,

            subPlanId:
              group.subPlanId ??
              obj.subPlanId,

            modelId,
            runtimeId,
          };

          break;
        }
      }

      if (!found) {
        message.warning(
          "The selected object was not found in sequencing.",
        );

        return;
      }

      dispatch(
        SetActiveSimulationItem({
          planId: String(
            found.planId,
          ),

          subPlanId: String(
            found.subPlanId,
          ),

          modelId:
            found.modelId,

          id: String(
            found.runtimeId,
          ),

          runtimeId:
            found.runtimeId,
        }),
      );
    } catch (error) {
      console.error(
        "Highlight object error:",
        error,
      );

      message.error(
        "Unable to highlight the selected object.",
      );
    }
  };

  /* =======================================================
   * EXCEL HELPERS
   * ===================================================== */

  const getCellText = (cell) => {
    if (!cell?.value) {
      return "";
    }

    if (
      typeof cell.value === "string"
    ) {
      return cell.value;
    }

    if (cell.value.richText) {
      return cell.value.richText
        .map((item) => item.text)
        .join("");
    }

    if (cell.value.text) {
      return cell.value.text;
    }

    if (
      cell.value.result != null
    ) {
      return String(
        cell.value.result,
      );
    }

    return "";
  };

  const clone = (value) => {
    if (value == null) {
      return value;
    }

    if (
      typeof value !== "object"
    ) {
      return value;
    }

    return JSON.parse(
      JSON.stringify(value),
    );
  };

  const fillText = (
    value,
    data,
    keepMissing = true,
  ) => {
    if (
      typeof value !== "string"
    ) {
      return value;
    }

    return value.replace(
      /\{\{\s*(.*?)\s*\}\}/g,
      (match, key) => {
        const field = key.trim();

        if (
          Object.prototype.hasOwnProperty.call(
            data,
            field,
          )
        ) {
          return data[field] ?? "";
        }

        return keepMissing
          ? match
          : "";
      },
    );
  };

  const fillRow = (
    row,
    data,
    keepMissing = false,
  ) => {
    row.eachCell(
      { includeEmpty: true },
      (cell) => {
        const text =
          getCellText(cell);

        if (text) {
          cell.value = fillText(
            text,
            data,
            keepMissing,
          );
        }
      },
    );

    row.commit();
  };

  const fillHeader = (
    worksheet,
    data,
  ) => {
    worksheet.eachRow((row) => {
      row.eachCell(
        { includeEmpty: true },
        (cell) => {
          const text =
            getCellText(cell);

          if (text) {
            cell.value = fillText(
              text,
              data,
              true,
            );
          }
        },
      );

      row.commit();
    });
  };

  const findTemplateRows = (
    worksheet,
  ) => {
    let planRowIndex = null;
    let groupRowIndex = null;
    let itemRowIndex = null;

    worksheet.eachRow(
      (row, rowNumber) => {
        row.eachCell(
          { includeEmpty: true },
          (cell) => {
            const text =
              getCellText(cell);

            if (!text) {
              return;
            }

            if (
              text.includes(
                "{{PlanName}}",
              )
            ) {
              planRowIndex =
                rowNumber;
            }

            if (
              text.includes(
                "{{GroupDate}}",
              ) ||
              text.includes(
                "{{Qty}}",
              )
            ) {
              groupRowIndex =
                rowNumber;
            }

            if (
              text.includes(
                "{{Index}}",
              ) ||
              text.includes(
                "{{AsmName}}",
              ) ||
              text.includes(
                "{{AsmPos}}",
              )
            ) {
              itemRowIndex =
                rowNumber;
            }
          },
        );
      },
    );

    if (!planRowIndex) {
      throw new Error(
        "Missing {{PlanName}} in Excel template.",
      );
    }

    if (!groupRowIndex) {
      throw new Error(
        "Missing {{GroupDate}} or {{Qty}} in Excel template.",
      );
    }

    if (!itemRowIndex) {
      throw new Error(
        "Missing {{Index}}, {{AsmName}} or {{AsmPos}} in Excel template.",
      );
    }

    if (
      !(
        planRowIndex <
          groupRowIndex &&
        groupRowIndex <
          itemRowIndex
      )
    ) {
      throw new Error(
        "Template row order must be {{PlanName}} → {{GroupDate}} → {{Index}}.",
      );
    }

    return {
      planRowIndex,
      groupRowIndex,
      itemRowIndex,
    };
  };

  const copyRowTo = (
    worksheet,
    sourceRowNumber,
    targetRowNumber,
  ) => {
    worksheet.spliceRows(
      targetRowNumber,
      0,
      [],
    );

    const sourceRow =
      worksheet.getRow(
        sourceRowNumber,
      );

    const targetRow =
      worksheet.getRow(
        targetRowNumber,
      );

    targetRow.height =
      sourceRow.height;

    targetRow.hidden =
      sourceRow.hidden;

    targetRow.outlineLevel =
      sourceRow.outlineLevel;

    sourceRow.eachCell(
      { includeEmpty: true },
      (
        sourceCell,
        columnNumber,
      ) => {
        const targetCell =
          targetRow.getCell(
            columnNumber,
          );

        targetCell.value = clone(
          sourceCell.value,
        );

        targetCell.style = clone(
          sourceCell.style,
        );

        targetCell.numFmt =
          sourceCell.numFmt;

        targetCell.alignment =
          clone(
            sourceCell.alignment,
          );

        targetCell.border =
          clone(
            sourceCell.border,
          );

        targetCell.fill =
          clone(
            sourceCell.fill,
          );

        targetCell.font =
          clone(
            sourceCell.font,
          );

        targetCell.protection =
          clone(
            sourceCell.protection,
          );
      },
    );

    targetRow.commit();

    return targetRow;
  };

  /* =======================================================
   * FILL EXCEL: PLAN -> DATE -> ITEM
   * ===================================================== */

  const fillGroups = (
    worksheet,
    planGroups,
  ) => {
    const {
      planRowIndex,
      groupRowIndex,
      itemRowIndex,
    } = findTemplateRows(
      worksheet,
    );

    const planTemplateRow =
      planRowIndex;

    const groupTemplateRow =
      groupRowIndex;

    const itemTemplateRow =
      itemRowIndex;

    let insertAt =
      itemRowIndex + 1;

    planGroups.forEach(
      (plan, planIndex) => {
        if (
          !plan?.groups?.length
        ) {
          return;
        }

        const planRow =
          copyRowTo(
            worksheet,
            planTemplateRow,
            insertAt,
          );

        fillRow(planRow, {
          PlanName:
            plan.planName || "",
        });

        insertAt += 1;

        plan.groups.forEach(
          (group) => {
            const items =
              group.items || [];

            const groupRow =
              copyRowTo(
                worksheet,
                groupTemplateRow,
                insertAt,
              );

            fillRow(groupRow, {
              GroupDate:
                group.date || "",

              Qty: items.length,
            });

            insertAt += 1;

            items.forEach(
              (
                item,
                itemIndex,
              ) => {
                const itemRow =
                  copyRowTo(
                    worksheet,
                    itemTemplateRow,
                    insertAt,
                  );

                fillRow(itemRow, {
                  Index:
                    itemIndex + 1,

                  AsmName:
                    item.AsmName ||
                    "",

                  AsmPos:
                    item.AsmPos ||
                    "",

                  MainProfile:
                    item.MainProfile ||
                    "",

                  GridPos:
                    item.GridPos ||
                    "",

                  Length:
                    item.Length ?? "",

                  Weight:
                    item.Weight ?? "",

                  Cog:
                    item.Cog || "",

                  CogX:
                    item.CogX ?? "",

                  CogY:
                    item.CogY ?? "",

                  CogZ:
                    item.CogZ ?? "",

                  Comment:
                    item.Comment ||
                    "",
                });

                insertAt += 1;
              },
            );
          },
        );

        if (
          planIndex <
          planGroups.length - 1
        ) {
          worksheet.spliceRows(
            insertAt,
            0,
            [],
          );

          insertAt += 1;
        }
      },
    );

    worksheet.spliceRows(
      planRowIndex,
      itemRowIndex -
        planRowIndex +
        1,
    );
  };

  /* =======================================================
   * DATE PARSER
   * ===================================================== */

  const parseObjectDate = (
    value,
  ) => {
    if (!value) {
      return null;
    }

    if (dayjs.isDayjs(value)) {
      return value.isValid()
        ? value
        : null;
    }

    const strictDate = dayjs(
      value,
      DATE_FORMATS,
      true,
    );

    if (strictDate.isValid()) {
      return strictDate;
    }

    const normalDate =
      dayjs(value);

    return normalDate.isValid()
      ? normalDate
      : null;
  };

  /* =======================================================
   * BUILD GROUPS
   * ===================================================== */

  const buildGroups = ({
    selectedPlanIds = [],
    startDateValue = null,
    endDateValue = null,
    formatting = DEFAULT_FORMATTING,
  }) => {
    const planGroups =
      new Map();

    const selectedPlanIdSet =
      new Set(
        selectedPlanIds.map(
          (id) => String(id),
        ),
      );

    const start =
      startDateValue
        ? dayjs(
            startDateValue,
          ).startOf("day")
        : null;

    const end =
      endDateValue
        ? dayjs(
            endDateValue,
          ).endOf("day")
        : null;

    sequenceObjects.forEach(
      (group) => {
        if (!group) {
          return;
        }

        const groupPlanId =
          String(
            group.planId || "",
          );

        if (
          !selectedPlanIdSet.has(
            groupPlanId,
          )
        ) {
          return;
        }

        const plan = plans.find(
          (item) =>
            String(item.id) ===
            groupPlanId,
        );

        const planId = String(
          group.planId ||
            plan?.id ||
            "no-plan",
        );

        const planNameValue =
          plan?.name ||
          group.planName ||
          "No Plan";

        (
          group.objects || []
        ).forEach((obj) => {
          const rawDate =
            obj.date ||
            obj.assignedDate;

          const objDate =
            parseObjectDate(
              rawDate,
            );

          if (!objDate) {
            return;
          }

          if (
            start &&
            objDate.isBefore(
              start,
              "day",
            )
          ) {
            return;
          }

          if (
            end &&
            objDate.isAfter(
              end,
              "day",
            )
          ) {
            return;
          }

          if (
            !planGroups.has(
              planId,
            )
          ) {
            planGroups.set(
              planId,
              {
                planId,

                planName:
                  planNameValue,

                planOrder:
                  plans.findIndex(
                    (item) =>
                      String(
                        item.id,
                      ) ===
                      planId,
                  ),

                dates:
                  new Map(),
              },
            );
          }

          const currentPlan =
            planGroups.get(
              planId,
            );

          const dateKey =
            objDate.format(
              "DD-MM-YYYY",
            );

          if (
            !currentPlan.dates.has(
              dateKey,
            )
          ) {
            currentPlan.dates.set(
              dateKey,
              [],
            );
          }

          const convertedLength =
            obj.length != null &&
            Number.isFinite(
              Number(obj.length),
            )
              ? convertLengthFromMm(
                  obj.length,
                  formatting,
                )
              : "";

          const convertedWeight =
            obj.weight != null &&
            Number.isFinite(
              Number(obj.weight),
            )
              ? convertMassFromKg(
                  obj.weight,
                  formatting,
                )
              : "";

          const convertedCog =
            formatCog(
              obj.cog,
              formatting,
            );

          const cogX =
            Array.isArray(
              obj.cog,
            ) &&
            obj.cog.length >= 3
              ? convertLengthFromMm(
                  obj.cog[0],
                  formatting,
                )
              : "";

          const cogY =
            Array.isArray(
              obj.cog,
            ) &&
            obj.cog.length >= 3
              ? convertLengthFromMm(
                  obj.cog[1],
                  formatting,
                )
              : "";

          const cogZ =
            Array.isArray(
              obj.cog,
            ) &&
            obj.cog.length >= 3
              ? convertLengthFromMm(
                  obj.cog[2],
                  formatting,
                )
              : "";

          currentPlan.dates
            .get(dateKey)
            .push({
              AsmName:
                obj.name ||
                obj.asmName ||
                "",

              AsmPos:
                obj.asmPos ||
                "",

              MainProfile:
                obj.profile ||
                obj.mainProfile ||
                "",

              GridPos:
                obj.positionCode ||
                obj.gridPos ||
                obj.location ||
                "",

              Length:
                convertedLength,

              Weight:
                convertedWeight,

              Cog:
                convertedCog,

              CogX:
                cogX,

              CogY:
                cogY,

              CogZ:
                cogZ,

              Comment:
                obj.comment ||
                "",
            });
        });
      },
    );

    return Array.from(
      planGroups.values(),
    )
      .map((plan) => ({
        planId:
          plan.planId,

        planName:
          plan.planName,

        planOrder:
          plan.planOrder,

        groups: Array.from(
          plan.dates.entries(),
        )
          .sort(
            (
              [dateA],
              [dateB],
            ) =>
              dayjs(
                dateA,
                "DD-MM-YYYY",
                true,
              ).valueOf() -
              dayjs(
                dateB,
                "DD-MM-YYYY",
                true,
              ).valueOf(),
          )
          .map(
            ([date, items]) => ({
              date,
              items,
            }),
          ),
      }))
      .filter(
        (plan) =>
          plan.groups.length > 0,
      )
      .sort((a, b) => {
        const orderA =
          a.planOrder >= 0
            ? a.planOrder
            : Number.MAX_SAFE_INTEGER;

        const orderB =
          b.planOrder >= 0
            ? b.planOrder
            : Number.MAX_SAFE_INTEGER;

        return orderA - orderB;
      });
  };

  /* =======================================================
   * OPEN EXPORT MODAL
   * ===================================================== */

  const handleOpenExportModal =
    () => {
      exportForm.resetFields();

      exportForm.setFieldsValue({
        startDate: null,
        endDate: null,

        planIds: plans.map(
          (plan) =>
            String(plan.id),
        ),
      });

      setExportModalOpen(true);
    };

  const handleCloseExportModal =
    () => {
      if (exporting) {
        return;
      }

      exportForm.resetFields();
      setExportModalOpen(false);
    };

  /* =======================================================
   * EXPORT EXCEL
   * ===================================================== */

  const handleExportExcel =
    async ({
      fileNameInput,
      selectedPlanIds,
      startDateValue,
      endDateValue,
    }) => {
      try {
        setExporting(true);

        const tcapi =
          await WorkspaceAPI.connect(
            window.parent,
          );

        const projectSettings =
          await tcapi.project.getSettings();

        console.log(
          "Project settings:",
          projectSettings,
        );

        const formatting =
          normalizeProjectFormatting(
            projectSettings?.formatting ||
              {},
          );

        console.log(
          "Project formatting used for Excel:",
          formatting,
        );

        const lengthUnit =
          getDisplayLengthUnit(
            formatting,
          );

        const weightUnit =
          getDisplayMassUnit(
            formatting,
          );

        const groups =
          buildGroups({
            selectedPlanIds,
            startDateValue,
            endDateValue,
            formatting,
          });

        if (!groups.length) {
          message.warning(
            "No data matches the selected conditions.",
          );

          return;
        }

        const response =
          await fetch(
            `${process.env.PUBLIC_URL}/Erection_Template.xlsx`,
          );

        if (!response.ok) {
          throw new Error(
            `Unable to download Excel template: ${response.status}`,
          );
        }

        const arrayBuffer =
          await response.arrayBuffer();

        const workbook =
          new ExcelJS.Workbook();

        await workbook.xlsx.load(
          arrayBuffer,
        );

        const worksheet =
          workbook.worksheets[0];

        if (!worksheet) {
          throw new Error(
            "No worksheet was found in the Excel template.",
          );
        }

        fillHeader(worksheet, {
          ProjectName:
            projectName || "",

          ReportDate:
            dayjs().format(
              "DD-MM-YYYY",
            ),

          StartDate:
            startDateValue
              ? dayjs(
                  startDateValue,
                ).format(
                  "DD-MM-YYYY",
                )
              : "",

          EndDate:
            endDateValue
              ? dayjs(
                  endDateValue,
                ).format(
                  "DD-MM-YYYY",
                )
              : "",

          LengthTitle:
            lengthUnit
              ? `Length (${lengthUnit})`
              : "Length",

          WeightTitle:
            weightUnit
              ? `Weight (${weightUnit})`
              : "Weight",

          CogTitle:
            lengthUnit
              ? `COG (${lengthUnit})`
              : "COG",

          CogXTitle:
            lengthUnit
              ? `COG X (${lengthUnit})`
              : "COG X",

          CogYTitle:
            lengthUnit
              ? `COG Y (${lengthUnit})`
              : "COG Y",

          CogZTitle:
            lengthUnit
              ? `COG Z (${lengthUnit})`
              : "COG Z",
        });

        fillGroups(
          worksheet,
          groups,
        );

        const buffer =
          await workbook.xlsx.writeBuffer();

        const safeFileName =
          String(
            fileNameInput ||
              "Sequencing Report",
          )
            .trim()
            .replace(
              /[<>:"/\\|?*]/g,
              "_",
            );

        const fileName =
          `${safeFileName}.xlsx`;

        saveAs(
          new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          fileName,
        );

        message.success(
          "Excel exported successfully.",
        );

        exportForm.resetFields();
        setExportModalOpen(false);
      } catch (error) {
        console.error(
          "Export Excel error:",
          error,
        );

        message.error(
          error?.message ||
            "Unable to export Excel.",
        );
      } finally {
        setExporting(false);
      }
    };

  const handleConfirmExport =
    async () => {
      try {
        const values =
          await exportForm.validateFields();

        await handleExportExcel({
          fileNameInput:
            values.fileName?.trim() ||
            "Sequencing Report",

          selectedPlanIds:
            values.planIds || [],

          startDateValue:
            values.startDate ||
            null,

          endDateValue:
            values.endDate ||
            null,
        });
      } catch (error) {
        if (error?.errorFields) {
          return;
        }

        console.error(
          "Validate export form error:",
          error,
        );
      }
    };

  /* =======================================================
   * JSX
   * ===================================================== */

  return (
    <>
      <Modal
        title="Create New Plan"
        open={isModalOpen}
        onCancel={handleCancel}
        footer={null}
        destroyOnHidden
        styles={{
          header: {
            padding: 0,
            marginBottom: 12,
          },

          body: {
            padding: 0,
          },
        }}
      >
        <Form
          form={form}
          autoComplete="off"
          layout="vertical"
        >
          <Form.Item
            name="planName"
            style={{
              marginBottom: 12,
            }}
            rules={[
              {
                required: true,
                whitespace: true,
                message:
                  "Please enter plan name.",
              },
            ]}
          >
            <Input
              placeholder="Plan Name"
              onPressEnter={
                handleCreate
              }
            />
          </Form.Item>

          <Form.Item
            style={{
              marginBottom: 0,
            }}
          >
            <Button
              type="primary"
              disabled={
                !planName?.trim()
              }
              onClick={
                handleCreate
              }
            >
              Create
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Export Excel"
        open={exportModalOpen}
        onCancel={
          handleCloseExportModal
        }
        onOk={
          handleConfirmExport
        }
        okText="Export"
        cancelText="Cancel"
        confirmLoading={exporting}
        destroyOnHidden
        maskClosable={!exporting}
        closable={!exporting}
      >
        <Form
          form={exportForm}
          layout="vertical"
          initialValues={{
            fileName:
              "Sequencing Report",

            startDate: null,
            endDate: null,
            planIds: [],
          }}
        >
          <Form.Item
            label="File Name"
            name="fileName"
            rules={[
              {
                required: true,
                whitespace: true,
                message:
                  "Please enter file name.",
              },
            ]}
          >
            <Input
              placeholder="Enter file name"
              maxLength={100}
            />
          </Form.Item>

          <Space
            style={{
              width: "100%",
            }}
            size={16}
            align="start"
          >
            <Form.Item
              label="Start Date"
              name="startDate"
              style={{
                flex: 1,
              }}
            >
              <DatePicker
                style={{
                  width: "100%",
                }}
                format="DD-MM-YYYY"
                allowClear
              />
            </Form.Item>

            <Form.Item
              label="End Date"
              name="endDate"
              style={{
                flex: 1,
              }}
              dependencies={[
                "startDate",
              ]}
              rules={[
                ({
                  getFieldValue,
                }) => ({
                  validator(
                    _,
                    value,
                  ) {
                    const start =
                      getFieldValue(
                        "startDate",
                      );

                    if (
                      !start ||
                      !value
                    ) {
                      return Promise.resolve();
                    }

                    if (
                      value.isBefore(
                        start,
                        "day",
                      )
                    ) {
                      return Promise.reject(
                        new Error(
                          "End Date must be greater than or equal to Start Date.",
                        ),
                      );
                    }

                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker
                style={{
                  width: "100%",
                }}
                format="DD-MM-YYYY"
                allowClear
              />
            </Form.Item>
          </Space>

          <Form.Item
            label="Plans"
            name="planIds"
            rules={[
              {
                required: true,
                type: "array",
                min: 1,
                message:
                  "Please select at least one plan.",
              },
            ]}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              maxTagCount="responsive"
              placeholder="Select plans"
              optionFilterProp="label"
              options={plans.map(
                (plan) => ({
                  value: String(
                    plan.id,
                  ),

                  label:
                    plan.name ||
                    "Unnamed Plan",
                }),
              )}
            />
          </Form.Item>

          <Space
            style={{
              marginTop: -12,
              marginBottom: 8,
            }}
          >
            <Button
              type="link"
              size="small"
              onClick={() => {
                exportForm.setFieldValue(
                  "planIds",
                  plans.map(
                    (plan) =>
                      String(
                        plan.id,
                      ),
                  ),
                );

                exportForm.validateFields(
                  ["planIds"],
                );
              }}
            >
              Select all
            </Button>

            <Button
              type="link"
              size="small"
              onClick={() => {
                exportForm.setFieldValue(
                  "planIds",
                  [],
                );
              }}
            >
              Clear all
            </Button>
          </Space>
        </Form>
      </Modal>

      <Flex
        vertical
        gap={8}
        style={{
          padding: "0 16px",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 24,
          }}
        >
          Sequencing
        </h1>

        <Flex justify="flex-end">
          <Space size={4}>
            <Tooltip title="Create new plan">
              <Button
                size="large"
                type="text"
                icon={
                  <FolderAddOutlined
                    style={{
                      fontSize: 22,
                    }}
                  />
                }
                onClick={() =>
                  setIsModalOpen(
                    true,
                  )
                }
              />
            </Tooltip>

            <Tooltip title="Export to Excel">
              <Button
                size="large"
                type="text"
                icon={
                  <DownloadOutlined
                    style={{
                      fontSize: 22,
                    }}
                  />
                }
                onClick={
                  handleOpenExportModal
                }
              />
            </Tooltip>

            <Tooltip title="Highlight row from selected object">
              <Button
                size="large"
                type="text"
                icon={
                  <FileSearchOutlined
                    style={{
                      fontSize: 22,
                    }}
                  />
                }
                onClick={
                  handleHighlight
                }
              />
            </Tooltip>
          </Space>
        </Flex>
      </Flex>
    </>
  );
};

export default TopMenu;