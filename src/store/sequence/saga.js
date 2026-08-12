import {
  all,
  select,
  call,
  put,
  takeEvery,
  takeLatest,
} from "redux-saga/effects";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

import {
  GetSubPlansSuccess,
  GetSubPlansFailure,
  CreateSubPlanSuccess,
  CreateSubPlanFailure,
  DeleteSubPlanFailure,
  DeleteSubPlanSuccess,
  UpdateSubPlanSuccess,
  UpdateSubPlanFailure,
  SetObjectsSuccess,
  SetObjectsFailure,
  GetSourceSequenceSuccess,
  GetSourceSequenceFailure,
  GetPlanSuccess,
  GetPlanFailure,
  CreatePlanSuccess,
  CreatePlanFailure,
  UpdatePlanSuccess,
  UpdatePlanFailure,
  DeletePlanSuccess,
  DeletePlanFailure,
  ExportTemplateSuccess,
  ExportTemplateFailure,
  UpdateSequenceObjectSortDatesSuccess,
  UpdateSequenceObjectSortDatesFailure,
  UpdateSequenceObjectFieldsSuccess,
  UpdateSequenceObjectFieldsFailure,
  CopySubPlansSuccess,
  CopySubPlansFailure,
  RefreshLoadedModelsSuccess,
  RefreshLoadedModelsFailure,
  CreateMultiplePlansSuccess,
  CreateMultiplePlansFailure,
  UpdatePlansOrderSuccess,
  UpdatePlansOrderFailure,
} from "./action";

import * as actionType from "./actionTypes";

import {
  getPlansByProject,
  createPlan,
  updatePlan,
  deletePlan,
  createPlansBulk,
  updatePlansOrder,
  hasPlansInAnotherProject,
} from "../../services/planService";

import {
  getSubPlansByProject,
  getSubPlansByPlan,
  createSubPlan,
  updateSubPlan,
  deleteSubPlan,
  createSubPlans,
} from "../../services/subPlanService";

import {
  getSequenceObjectsByProject,
  replaceSequenceObjectsForSubPlan,
  copySequenceObjectsToSubPlans,
  updateSequenceObjectSortDates,
  updateSequenceObjectFields,
} from "../../services/sequenceObjectService";
import { copySubPlans } from "../../services/copySubPlanService";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import { hydrateSequenceObjects } from "../../services/trimbleRuntimeService";

function getErrorMessage(error, fallback) {
  return error?.message || error?.details || error?.hint || fallback;
}

/* -------------------------------------------------------------------------- */
/*                                   PLANS                                    */
/* -------------------------------------------------------------------------- */

function* getPlansSaga(action) {
  try {
    const payload = action.payload || {};

    const projectId = payload.projectId;

    const projectName = payload.projectName || "";

    const currentUser = payload.currentUser || null;

    if (!projectId) {
      throw new Error("Trimble project ID is required.");
    }

    const currentProjectId = String(projectId);

    /*
     * =========================================
     * TRIAL PROJECT LIMIT
     * =========================================
     */
    // if (currentUser?.isTrial === true) {
    //   const hasAnotherProject = yield call(
    //     hasPlansInAnotherProject,
    //     currentProjectId,
    //   );

    //   if (hasAnotherProject) {
    //     yield put(
    //       GetPlanFailure({
    //         code: "TRIAL_PROJECT_LIMIT",
    //         message:
    //           "The Trial License is limited to one Trimble Connect project. " +
    //           "Please purchase a license to use Sequence Planner on another project.",
    //       }),
    //     );

    //     return;
    //   }
    // }

    /*
     * =========================================
     * LOAD DATA
     * =========================================
     */

    const tcapi = yield call(WorkspaceAPI.connect, window.parent);

    const [plans, subPlans, sequenceObjectRows] = yield all([
      call(getPlansByProject, currentProjectId),

      call(getSubPlansByProject, currentProjectId),

      call(getSequenceObjectsByProject, currentProjectId),
    ]);

    const hydratedObjects = yield call(hydrateSequenceObjects, {
      tcapi,

      objects: sequenceObjectRows || [],
    });

    const objectsBySubPlan = new Map();

    for (const object of hydratedObjects) {
      const subPlanId = object?.subPlanId;

      if (subPlanId == null) {
        continue;
      }

      const key = String(subPlanId);

      if (!objectsBySubPlan.has(key)) {
        objectsBySubPlan.set(key, []);
      }

      objectsBySubPlan.get(key).push(object);
    }

    const sequenceObjects = (subPlans || []).map((subPlan) => ({
      planId: subPlan.planId,

      subPlanId: subPlan.id,

      objects: (objectsBySubPlan.get(String(subPlan.id)) || []).map(
        (object) => ({
          ...object,

          planId: subPlan.planId,

          subPlanId: subPlan.id,
        }),
      ),
    }));

    yield put(
      GetPlanSuccess({
        projectId: currentProjectId,

        projectName,

        currentUser,

        plans: plans || [],

        subPlans: subPlans || [],

        sequenceObjects,
      }),
    );
  } catch (error) {
    console.error("Failed to load sequencing data:", error);

    yield put(
      GetPlanFailure({
        code: "TRIAL_PROJECT_LIMIT",

        message:
          "The Trial License is limited to one Trimble Connect project. " +
          "Please purchase a license to use Sequence Planner on another project.",
      }),
    );
  }
}

function* updateSequenceObjectSortDatesSaga(action) {
  try {
    const payload = action.payload || {};

    const updatedObjects = yield call(
      updateSequenceObjectSortDates,
      payload.objects || [],
    );

    yield put(
      UpdateSequenceObjectSortDatesSuccess({
        subPlanId: payload.subPlanId,
        objects: updatedObjects,
      }),
    );
  } catch (error) {
    console.error("Failed to update sequence object order:", error);

    yield put(
      UpdateSequenceObjectSortDatesFailure(
        error?.message || "Failed to update sequence object order.",
      ),
    );
  }
}
export function* updatePlansOrderSaga(action) {
  try {
    const plans = Array.isArray(action.payload?.plans)
      ? action.payload.plans
      : [];

    if (!plans.length) {
      throw new Error("At least one Plan is required.");
    }

    const updatedPlans = yield call(updatePlansOrder, plans);

    yield put(
      UpdatePlansOrderSuccess({
        plans: updatedPlans,
      }),
    );
  } catch (error) {
    console.error("Failed to update Plan order:", error);

    yield put(
      UpdatePlansOrderFailure(error?.message || "Unable to reorder Plans."),
    );
  }
}
function* createMultiplePlansSaga(action) {
  try {
    const payload = action.payload || {};

    const projectId = payload.projectId ?? payload.trimbleProjectId;

    const plans = Array.isArray(payload.plans) ? payload.plans : [];

    if (!projectId) {
      throw new Error("Trimble project ID is required.");
    }

    if (!plans.length) {
      throw new Error("At least one Plan is required.");
    }

    const createdPlans = yield call(createPlansBulk, {
      trimbleProjectId: projectId,

      plans,
    });

    yield put(
      CreateMultiplePlansSuccess({
        plans: createdPlans,
      }),
    );
  } catch (error) {
    console.error("Failed to create multiple Plans:", error);

    yield put(
      CreateMultiplePlansFailure(error?.message || "Unable to create Plans."),
    );
  }
}

function* createPlanSaga(action) {
  try {
    const { projectId, name, color } = action.payload || {};

    const newPlan = yield call(createPlan, {
      trimbleProjectId: projectId,
      name,
      color,
    });

    yield put(
      CreatePlanSuccess({
        newPlan,
      }),
    );
  } catch (error) {
    console.error("Failed to create plan:", error);

    yield put(
      CreatePlanFailure(getErrorMessage(error, "Failed to create plan.")),
    );
  }
}

function* updatePlanSaga(action) {
  try {
    const payload = action.payload || {};

    const planId = payload.id || payload.planId;

    if (!planId) {
      throw new Error("Plan ID is required.");
    }

    const updatedPlan = yield call(updatePlan, {
      id: planId,
      name: payload.name,
      color: payload.color,
      sortDatetime: payload.sortDatetime ?? payload.sort_datetime,
    });

    yield put(
      UpdatePlanSuccess({
        updatedPlan,
      }),
    );
  } catch (error) {
    console.error("Failed to update Plan:", error);

    yield put(
      UpdatePlanFailure(getErrorMessage(error, "Failed to update Plan.")),
    );
  }
}

function* deletePlanSaga(action) {
  try {
    const planId =
      action.payload?.planId || action.payload?.folderId || action.payload?.id;

    if (!planId) {
      throw new Error("Plan ID is required.");
    }

    yield call(deletePlan, planId);

    yield put(
      DeletePlanSuccess({
        deletedPlanId: planId,
      }),
    );
  } catch (error) {
    console.error("Failed to delete plan:", error);

    yield put(
      DeletePlanFailure(getErrorMessage(error, "Failed to delete plan.")),
    );
  }
}

const selectSequenceObjects = (state) => state.sequence.sequenceObjects || [];

function flattenSequenceObjects(sequenceObjects) {
  const flatObjects = [];
  const groupRanges = [];

  for (const group of sequenceObjects || []) {
    const groupObjects = Array.isArray(group?.objects) ? group.objects : [];

    const start = flatObjects.length;

    flatObjects.push(...groupObjects);

    groupRanges.push({
      group,
      start,
      count: groupObjects.length,
    });
  }

  return {
    flatObjects,
    groupRanges,
  };
}

function rebuildSequenceObjectGroups({ hydratedObjects, groupRanges }) {
  return groupRanges.map(({ group, start, count }) => ({
    ...group,

    objects: hydratedObjects.slice(start, start + count),
  }));
}

export function* refreshLoadedModelsSaga(action) {
  try {
    const payload = action.payload || {};

    const sequenceObjects = yield select(selectSequenceObjects);

    const { flatObjects, groupRanges } =
      flattenSequenceObjects(sequenceObjects);

    const tcapi = yield call(WorkspaceAPI.connect, window.parent);

    /*
     * hydrateSequenceObjects() calls:
     * viewer.getModels("loaded")
     * convertToObjectRuntimeIds(...)
     * getObjectProperties(...)
     *
     * It only refreshes runtime fields.
     * Supabase data is not reloaded.
     */
    const hydratedObjects = yield call(hydrateSequenceObjects, {
      tcapi,
      objects: flatObjects,
    });

    const hydratedGroups = rebuildSequenceObjectGroups({
      hydratedObjects,
      groupRanges,
    });

    yield put(
      RefreshLoadedModelsSuccess({
        sequenceObjects: hydratedGroups,

        loadedModelIds: payload.loadedModelIds || [],
      }),
    );

    /*
     * Return value can be useful when testing the saga,
     * but UI notifications should normally be handled
     * in App or TopMenu.
     */
  } catch (error) {
    console.error("Failed to refresh loaded models:", error);

    yield put(
      RefreshLoadedModelsFailure(
        error?.message || "Failed to refresh loaded models.",
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                                 SUB PLANS                                  */
/* -------------------------------------------------------------------------- */

function* getSubPlansSaga(action) {
  try {
    const { projectId, planId } = action.payload || {};

    let subPlans;

    if (planId) {
      subPlans = yield call(getSubPlansByPlan, planId);
    } else if (projectId) {
      subPlans = yield call(getSubPlansByProject, projectId);
    } else {
      throw new Error("Project ID or Plan ID is required.");
    }

    yield put(
      GetSubPlansSuccess({
        subPlans,
        sequenceObjects: [],
      }),
    );
  } catch (error) {
    console.error("Failed to load sub plans:", error);

    yield put(
      GetSubPlansFailure(getErrorMessage(error, "Failed to load sub plans.")),
    );
  }
}

function* createSubPlanSaga(action) {
  try {
    const payload = action.payload || {};

    const projectId = payload.projectId || payload.trimbleProjectId;

    const planId = payload.planId || payload.phaseFolderId;

    if (!projectId) {
      throw new Error("Trimble project ID is required.");
    }

    if (!planId) {
      throw new Error("Plan ID is required.");
    }

    if (!payload.name?.trim()) {
      throw new Error("SubPlan name is required.");
    }

    const newSubPlan = yield call(createSubPlan, {
      trimbleProjectId: projectId,
      planId,
      name: payload.name.trim(),
      color: payload.color || null,
      sortDatetime: payload.sortDatetime ?? payload.sort_datetime ?? null,
    });

    yield put(
      CreateSubPlanSuccess({
        newSubPlan,
      }),
    );
  } catch (error) {
    console.error("Failed to create sub plan:", error);

    yield put(
      CreateSubPlanFailure(
        getErrorMessage(error, "Failed to create sub plan."),
      ),
    );
  }
}

function* copySubPlansSaga(action) {
  try {
    const payload = action.payload || {};

    const projectId = payload.projectId ?? payload.trimbleProjectId;

    const targetPlanId = payload.targetPlanId ?? payload.planId;

    const sourceSubPlans =
      payload.sourceSubPlans ?? payload.subPlansToCopy ?? [];

    if (!projectId) {
      throw new Error("Trimble project ID is required.");
    }

    if (!targetPlanId) {
      throw new Error("Target Plan ID is required.");
    }

    if (!Array.isArray(sourceSubPlans) || sourceSubPlans.length === 0) {
      throw new Error("No SubPlans were provided for copying.");
    }

    const createdSubPlans = yield call(copySubPlans, {
      trimbleProjectId: projectId,

      targetPlanId,

      sourceSubPlans,
    });

    yield put(
      CopySubPlansSuccess({
        projectId: String(projectId),

        targetPlanId,

        subPlans: createdSubPlans,
      }),
    );
  } catch (error) {
    console.error("Failed to copy SubPlans:", error);

    yield put(
      CopySubPlansFailure(getErrorMessage(error, "Failed to copy SubPlans.")),
    );
  }
}

function* updateSubPlanSaga(action) {
  try {
    const payload = action.payload || {};

    const subPlanId = payload.id || payload.subPlanId;

    if (!subPlanId) {
      throw new Error("SubPlan ID is required.");
    }

    const updatedSubPlan = yield call(updateSubPlan, {
      id: subPlanId,
      name: payload.name,
      color: payload.color,
      sortDatetime: payload.sortDatetime ?? payload.sort_datetime,
    });

    yield put(
      UpdateSubPlanSuccess({
        updatedSubPlan,
      }),
    );
  } catch (error) {
    console.error("Failed to update SubPlan:", error);

    yield put(
      UpdateSubPlanFailure(getErrorMessage(error, "Failed to update SubPlan.")),
    );
  }
}

function* deleteSubPlanSaga(action) {
  try {
    const subPlanId = action.payload?.subPlanId || action.payload?.id;

    if (!subPlanId) {
      throw new Error("SubPlan ID is required.");
    }

    yield call(deleteSubPlan, subPlanId);

    yield put(
      DeleteSubPlanSuccess({
        deletedSubPlanId: subPlanId,
      }),
    );
  } catch (error) {
    console.error("Failed to delete sub plan:", error);

    yield put(
      DeleteSubPlanFailure(
        getErrorMessage(error, "Failed to delete sub plan."),
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                            COPY / SOURCE SEQUENCE                           */
/* -------------------------------------------------------------------------- */

function* getSourceSequenceSaga(action) {
  try {
    const { planId } = action.payload || {};

    if (!planId) {
      throw new Error("Source Plan ID is required.");
    }

    const sequences = yield call(getSubPlansByPlan, planId);

    yield put(
      GetSourceSequenceSuccess({
        sequences,
      }),
    );
  } catch (error) {
    console.error("Failed to load source sequence:", error);

    yield put(
      GetSourceSequenceFailure(
        getErrorMessage(error, "Failed to load source sequence."),
      ),
    );
  }
}

function* copySequenceSaga(action) {
  try {
    const payload = action.payload || {};
    const targetPlanId = payload.planId;

    if (!targetPlanId) {
      throw new Error("Target Plan ID is required.");
    }

    const sourceSubPlans = payload.newSubPlans || payload.subPlansToCopy || [];

    const createdSubPlans = yield call(createSubPlans, {
      trimbleProjectId: payload.projectId,
      planId: targetPlanId,
      subPlans: sourceSubPlans,
    });

    /*
     * Optional object copy.
     *
     * Source subplan ID must be available as:
     * sourceSubPlanId, sourceId, or id.
     */
    if (payload.copyObjects !== false) {
      const mappings = createdSubPlans.map((createdSubPlan, index) => ({
        sourceSubPlanId:
          sourceSubPlans[index]?.sourceSubPlanId ||
          sourceSubPlans[index]?.sourceId ||
          sourceSubPlans[index]?.id,
        targetSubPlanId: createdSubPlan.id,
        targetPlanId,
      }));

      const validMappings = mappings.filter(
        (mapping) => mapping.sourceSubPlanId,
      );

      if (validMappings.length > 0) {
        yield call(copySequenceObjectsToSubPlans, {
          trimbleProjectId: payload.projectId,
          mappings: validMappings,
        });
      }
    }

    yield put(
      UpdateSubPlanSuccess({
        subPlans: [...(payload.subPlans || []), ...createdSubPlans],
      }),
    );
  } catch (error) {
    console.error("Failed to copy sequence:", error);

    yield put(
      UpdateSubPlanFailure(getErrorMessage(error, "Failed to copy sequence.")),
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                              SEQUENCE OBJECTS                              */
/* -------------------------------------------------------------------------- */

const getSequenceObjectKey = (object) =>
  String(object?.externalId ?? object?.external_id ?? object?.objectId ?? "");

function* setObjectsSaga(action) {
  try {
    const payload = action.payload || {};

    const projectId = payload.projectId ?? payload.trimbleProjectId;

    const planId = payload.planId;

    const subPlanId = payload.subPlanId;

    const runtimeObjects = Array.isArray(payload.objects)
      ? payload.objects
      : [];

    if (!projectId) {
      throw new Error("Trimble project ID is required.");
    }

    if (!subPlanId) {
      throw new Error("SubPlan ID is required.");
    }

    const savedObjects = yield call(replaceSequenceObjectsForSubPlan, {
      trimbleProjectId: projectId,

      subPlanId,

      objects: runtimeObjects,
    });

    /*
     * Runtime object lookup uses external_id only.
     */
    const runtimeMap = new Map(
      runtimeObjects
        .map((object) => [getSequenceObjectKey(object), object])
        .filter(([key]) => key !== ""),
    );

    const mergedObjects = savedObjects.map((savedObject) => {
      const runtimeObject = runtimeMap.get(getSequenceObjectKey(savedObject));

      return {
        ...savedObject,
        ...runtimeObject,

        dbId: savedObject.dbId,

        externalId:
          savedObject.externalId ??
          savedObject.external_id ??
          runtimeObject?.externalId ??
          runtimeObject?.external_id ??
          runtimeObject?.objectId ??
          null,

        /*
         * Runtime-only values.
         * These fields are not persisted to Supabase.
         */
        modelId: runtimeObject?.modelId ?? null,

        runtimeId: runtimeObject?.runtimeId ?? null,

        id: runtimeObject?.runtimeId ?? runtimeObject?.id ?? null,

        planId: runtimeObject?.planId ?? planId,

        subPlanId,

        asmPos: runtimeObject?.asmPos ?? "",

        asmName: runtimeObject?.asmName ?? runtimeObject?.name ?? "",

        name: runtimeObject?.name ?? runtimeObject?.asmName ?? "",

        positionCode: runtimeObject?.positionCode ?? "",

        rawWeight: runtimeObject?.rawWeight ?? runtimeObject?.weight ?? null,

        weight: runtimeObject?.weight ?? runtimeObject?.rawWeight ?? null,

        rawLength: runtimeObject?.rawLength ?? runtimeObject?.length ?? null,

        length: runtimeObject?.length ?? runtimeObject?.rawLength ?? null,

        rawCog: runtimeObject?.rawCog ?? runtimeObject?.cog ?? null,

        cog: runtimeObject?.cog ?? runtimeObject?.rawCog ?? null,

        distance: runtimeObject?.distance ?? 0,

        center: runtimeObject?.center ?? [0, 0, 0],

        camera: runtimeObject?.camera ?? savedObject?.camera ?? null,

        objectAvailable: runtimeObject?.objectAvailable ?? true,
      };
    });

    yield put(
      SetObjectsSuccess({
        projectId,
        planId,
        subPlanId,
        objects: mergedObjects,
      }),
    );
  } catch (error) {
    console.error("Failed to save sequence objects:", error);

    yield put(
      SetObjectsFailure(
        getErrorMessage(error, "Failed to save sequence objects."),
      ),
    );
  }
}

function* updateSequenceObjectFieldsSaga(action) {
  try {
    const payload = action.payload || {};

    const updatedObjects = yield call(
      updateSequenceObjectFields,
      payload.objects || [],
    );

    yield put(
      UpdateSequenceObjectFieldsSuccess({
        subPlanId: payload.subPlanId,
        objects: updatedObjects,
      }),
    );
  } catch (error) {
    console.error("Failed to update sequence object fields:", error);

    yield put(
      UpdateSequenceObjectFieldsFailure(
        error?.message || "Failed to update sequence object fields.",
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                                EXCEL EXPORT                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_TEMPLATE_PATH = "/templates/SequencingTemplate.xlsx";

/*
 * ============================================================
 * GET CELL TEXT
 * ============================================================
 */
function getCellText(cell) {
  const value = cell?.value;

  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && Array.isArray(value.richText)) {
    return value.richText.map((item) => item?.text || "").join("");
  }

  if (value?.text != null) {
    return String(value.text);
  }

  if (value?.result !== undefined) {
    return String(value.result ?? "");
  }

  return "";
}

/*
 * ============================================================
 * FILL TEXT
 * ============================================================
 *
 * Function này CHỈ dùng cho text.
 * Không dùng cho Index / Qty / Length / Weight.
 */
function fillText(value, data) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/{{\s*(.*?)\s*}}/g, (_, key) => {
    const result = data[key.trim()];

    return result == null ? "" : String(result);
  });
}

/*
 * ============================================================
 * CLONE
 * ============================================================
 */
function cloneObject(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

/*
 * ============================================================
 * SNAPSHOT TEMPLATE ROW
 * ============================================================
 *
 * Lưu placeholder + style TRƯỚC khi xóa template row.
 */
function snapshotTemplateRow(row) {
  const cells = {};

  row.eachCell(
    {
      includeEmpty: true,
    },
    (cell, columnNumber) => {
      cells[columnNumber] = {
        templateText: getCellText(cell).trim(),

        style: cloneObject(cell.style || {}),

        font: cloneObject(cell.font),

        fill: cloneObject(cell.fill),

        border: cloneObject(cell.border),

        alignment: cloneObject(cell.alignment),

        protection: cloneObject(cell.protection),

        numFmt: cell.numFmt,
      };
    },
  );

  return {
    height: row.height,

    cells,
  };
}

/*
 * ============================================================
 * COPY TEMPLATE STYLE
 * ============================================================
 */
function applyTemplateStyle(row, template) {
  if (!template) {
    return;
  }

  row.height = template.height;

  Object.entries(template.cells || {}).forEach(([columnNumber, source]) => {
    const cell = row.getCell(Number(columnNumber));

    if (source.style) {
      cell.style = cloneObject(source.style);
    }

    if (source.font) {
      cell.font = cloneObject(source.font);
    }

    if (source.fill) {
      cell.fill = cloneObject(source.fill);
    }

    if (source.border) {
      cell.border = cloneObject(source.border);
    }

    if (source.alignment) {
      cell.alignment = cloneObject(source.alignment);
    }

    if (source.protection) {
      cell.protection = cloneObject(source.protection);
    }

    if (source.numFmt) {
      cell.numFmt = source.numFmt;
    }
  });
}

/*
 * ============================================================
 * FIND TEMPLATE ROWS
 * ============================================================
 */
function findTemplateRows(worksheet) {
  let groupRowIndex = null;

  let itemRowIndex = null;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(
      {
        includeEmpty: true,
      },
      (cell) => {
        const text = getCellText(cell);

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
      },
    );
  });

  if (!groupRowIndex || !itemRowIndex) {
    throw new Error(
      "The template is missing the group or item placeholder row.",
    );
  }

  return {
    groupRowIndex,
    itemRowIndex,
  };
}

/*
 * ============================================================
 * HEADER
 * ============================================================
 */
function fillHeader(worksheet, data) {
  worksheet.eachRow((row) => {
    row.eachCell(
      {
        includeEmpty: true,
      },
      (cell) => {
        const text = getCellText(cell);

        if (!text || !text.includes("{{")) {
          return;
        }

        cell.value = fillText(text, data);
      },
    );
  });
}

/*
 * ============================================================
 * NUMBER CELL
 * ============================================================
 */
function setNumberCell(cell, value, numFmt) {
  const numberValue = Number(value);

  /*
   * QUAN TRỌNG:
   *
   * cell.value nhận JavaScript Number trực tiếp.
   *
   * Không:
   *
   * String(...)
   * toFixed(...)
   * fillText(...)
   * replace(...)
   */
  cell.value = Number.isFinite(numberValue) ? numberValue : 0;

  if (numFmt) {
    cell.numFmt = numFmt;
  }
}

/*
 * ============================================================
 * FILL GROUPS
 * ============================================================
 */
function fillGroups(worksheet, groups) {
  const { groupRowIndex, itemRowIndex } = findTemplateRows(worksheet);

  /*
   * =========================================
   * SAVE GROUP TEMPLATE
   * =========================================
   */

  const groupTemplateRow = worksheet.getRow(groupRowIndex);

  const groupTemplate = {};

  groupTemplateRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    groupTemplate[columnNumber] = {
      text: getCellText(cell).trim(),

      style: JSON.parse(JSON.stringify(cell.style || {})),
    };
  });

  /*
   * =========================================
   * SAVE ITEM TEMPLATE
   * =========================================
   */

  const itemTemplateRow = worksheet.getRow(itemRowIndex);

  const itemTemplate = {};

  itemTemplateRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    itemTemplate[columnNumber] = {
      text: getCellText(cell).trim(),

      style: JSON.parse(JSON.stringify(cell.style || {})),
    };
  });

  /*
   * Remove template rows.
   */
  worksheet.spliceRows(groupRowIndex, itemRowIndex - groupRowIndex + 1);

  let insertAt = groupRowIndex;

  /*
   * =========================================
   * GROUPS
   * =========================================
   */

  for (const group of groups) {
    /*
     * QUAN TRỌNG:
     *
     * Insert row trống.
     *
     * KHÔNG:
     * groupTemplateValues
     */
    worksheet.spliceRows(insertAt, 0, []);

    const groupRow = worksheet.getRow(insertAt);

    const groupData = {
      GroupDate: String(group.date ?? ""),

      Qty: Number(group.items?.length ?? 0),
    };

    Object.entries(groupTemplate).forEach(([columnNumber, templateCell]) => {
      const cell = groupRow.getCell(Number(columnNumber));

      /*
       * Copy style.
       */
      cell.style = JSON.parse(JSON.stringify(templateCell.style || {}));

      const templateText = templateCell.text;

      /*
       * Qty = NUMBER
       */
      if (templateText === "{{Qty}}") {
        cell.value = Number(groupData.Qty);

        return;
      }

      /*
       * Group text.
       */
      cell.value = fillText(templateText, groupData);
    });

    insertAt += 1;

    /*
     * =========================================
     * ITEMS
     * =========================================
     */

    const items = Array.isArray(group.items) ? group.items : [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      /*
       * =======================================
       * INSERT EMPTY ROW
       * =======================================
       *
       * RẤT QUAN TRỌNG:
       *
       * Không dùng:
       *
       * worksheet.spliceRows(
       *   insertAt,
       *   0,
       *   itemTemplateValues
       * )
       */
      worksheet.spliceRows(insertAt, 0, []);

      const itemRow = worksheet.getRow(insertAt);

      /*
       * Values giữ đúng datatype.
       */
      const itemData = {
        /*
         * NUMBER
         */
        Index: index + 1,

        Length: Number(item.Length ?? 0),

        Weight: Number(item.Weight ?? 0),

        /*
         * TEXT
         */
        AsmName: String(item.AsmName ?? ""),

        AsmPos: String(item.AsmPos ?? ""),

        MainProfile: String(item.MainProfile ?? ""),

        GridPos: String(item.GridPos ?? ""),

        Comment: String(item.Comment ?? ""),
      };

      /*
       * =======================================
       * WRITE CELLS
       * =======================================
       */

      Object.entries(itemTemplate).forEach(([columnNumber, templateCell]) => {
        const cell = itemRow.getCell(Number(columnNumber));

        /*
         * Copy style ONLY.
         */
        cell.style = JSON.parse(JSON.stringify(templateCell.style || {}));

        const templateText = templateCell.text;

        /*
         * ===================================
         * INDEX = NUMBER
         * ===================================
         */

        if (templateText === "{{Index}}") {
          cell.value = Number(itemData.Index);

          return;
        }

        /*
         * ===================================
         * LENGTH = NUMBER
         * ===================================
         */

        if (templateText === "{{Length}}") {
          const value = Number(itemData.Length);

          cell.value = Number.isFinite(value) ? value : 0;

          return;
        }

        /*
         * ===================================
         * WEIGHT = NUMBER
         * ===================================
         */

        if (templateText === "{{Weight}}") {
          const value = Number(itemData.Weight);

          cell.value = Number.isFinite(value) ? value : 0;

          return;
        }

        /*
         * ===================================
         * TEXT
         * ===================================
         */

        cell.value = fillText(templateText, itemData);
      });

      /*
       * DEBUG
       */
      Object.entries(itemTemplate).forEach(([columnNumber, templateCell]) => {
        if (templateCell.text !== "{{Weight}}") {
          return;
        }

        const weightCell = itemRow.getCell(Number(columnNumber));

        console.log(
          "WEIGHT CELL",
          weightCell.address,
          weightCell.value,
          typeof weightCell.value,
          weightCell.type,
        );
      });

      insertAt += 1;
    }
  }
}

/*
 * ============================================================
 * BUILD GROUPS
 * ============================================================
 */
function buildGroupsFromSequenceObjects(plans = [], sequenceObjects = []) {
  return (sequenceObjects || [])
    .filter((group) => group && Array.isArray(group.objects))
    .map((group) => {
      const plan = (plans || []).find(
        (item) => String(item.id) === String(group.planId),
      );

      return {
        name: String(plan?.name ?? ""),

        date: group.objects[0]?.date || group.objects[0]?.assignedDate || "",

        items: group.objects.map((object) => {
          /*
           * Convert Number NGAY TỪ ĐÂY.
           */
          const length = Number(object.length ?? object.rawLength ?? 0);

          const weight = Number(object.weight ?? object.rawWeight ?? 0);

          return {
            AsmName: String(object.name ?? object.asmName ?? ""),

            AsmPos: String(object.asmPos ?? ""),

            MainProfile: String(object.profile ?? object.mainProfile ?? ""),

            GridPos: String(
              object.positionCode ?? object.gridPos ?? object.location ?? "",
            ),

            /*
             * NUMBER
             */
            Length: Number.isFinite(length) ? length : 0,

            /*
             * NUMBER
             *
             * Không Math.round()
             * Không toFixed()
             */
            Weight: Number.isFinite(weight) ? weight : 0,

            Comment: String(object.comment ?? ""),
          };
        }),
      };
    });
}

/*
 * ============================================================
 * DOWNLOAD TEMPLATE
 * ============================================================
 */
function* downloadPublicTemplateBuffer(templatePath = DEFAULT_TEMPLATE_PATH) {
  const response = yield call(fetch, templatePath);

  if (!response.ok) {
    throw new Error(`Unable to load Excel template: ${response.status}`);
  }

  return yield call([response, response.arrayBuffer]);
}

/*
 * ============================================================
 * EXPORT
 * ============================================================
 */
function* exportTemplateSaga(action) {
  try {
    const { projectName, plans, sequenceObjects, templatePath, fileName } =
      action.payload || {};

    const groups = buildGroupsFromSequenceObjects(plans, sequenceObjects);

    if (groups.length === 0) {
      throw new Error("No sequencing data is available for export.");
    }

    const buffer = yield call(
      downloadPublicTemplateBuffer,

      templatePath || DEFAULT_TEMPLATE_PATH,
    );

    const workbook = new ExcelJS.Workbook();

    yield call([workbook.xlsx, workbook.xlsx.load], buffer);

    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      throw new Error("No worksheet was found in the Excel template.");
    }

    /*
     * HEADER
     */
    fillHeader(worksheet, {
      ProjectName: String(projectName ?? ""),

      ReportDate: new Date().toLocaleDateString("en-AU"),
    });

    /*
     * GROUP + ITEMS
     */
    fillGroups(worksheet, groups);

    /*
     * ========================================================
     * DEBUG
     * ========================================================
     *
     * Numeric cells phải:
     *
     * typeof === "number"
     * cell.type === 2
     */
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "number") {
          console.log("EXCEL NUMBER:", {
            row: rowNumber,

            address: cell.address,

            value: cell.value,

            jsType: typeof cell.value,

            excelType: cell.type,

            numFmt: cell.numFmt,
          });
        }
      });
    });

    /*
     * WRITE XLSX
     */
    const output = yield call([workbook.xlsx, workbook.xlsx.writeBuffer]);

    const safeFileName = String(fileName || "Sequencing")
      .trim()
      .replace(/[<>:"/\\|?*]/g, "_");

    saveAs(
      new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),

      `${safeFileName}.xlsx`,
    );

    yield put(
      ExportTemplateSuccess?.({
        fileName: `${safeFileName}.xlsx`,
      }) || {
        type: "EXPORT_TEMPLATE_SUCCESS",
      },
    );
  } catch (error) {
    console.error("Failed to export Excel template:", error);

    if (ExportTemplateFailure) {
      yield put(
        ExportTemplateFailure(
          getErrorMessage(error, "Failed to export Excel template."),
        ),
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                  WATCHER                                   */
/* -------------------------------------------------------------------------- */

function* sequenceSaga() {
  yield takeEvery(actionType.GET_PLAN_REQUEST, getPlansSaga);
  yield takeEvery(actionType.CREATE_PLAN_REQUEST, createPlanSaga);
  yield takeEvery(actionType.UPDATE_PLAN_REQUEST, updatePlanSaga);
  yield takeEvery(actionType.DELETE_PLAN_REQUEST, deletePlanSaga);

  yield takeEvery(actionType.GET_SUBPLAN_REQUEST, getSubPlansSaga);
  yield takeEvery(actionType.CREATE_SUBPLAN_REQUEST, createSubPlanSaga);
  yield takeEvery(actionType.UPDATE_SUBPLAN_REQUEST, updateSubPlanSaga);
  yield takeEvery(actionType.DELETE_SUBPLAN_REQUEST, deleteSubPlanSaga);

  yield takeEvery(
    actionType.GET_SOURCE_SEQUENCE_REQUEST,
    getSourceSequenceSaga,
  );
  yield takeEvery(actionType.COPY_SEQUENCE_REQUEST, copySequenceSaga);

  yield takeEvery(actionType.SET_OBJECTS_REQUEST, setObjectsSaga);

  yield takeEvery(actionType.EXPORT_TEMPLATE_REQUEST, exportTemplateSaga);
  yield takeLatest(
    actionType.UPDATE_SEQUENCE_OBJECT_SORT_DATES_REQUEST,
    updateSequenceObjectSortDatesSaga,
  );
  yield takeLatest(
    actionType.UPDATE_SEQUENCE_OBJECT_FIELDS_REQUEST,
    updateSequenceObjectFieldsSaga,
  );
  yield takeLatest(actionType.COPY_SUBPLANS_REQUEST, copySubPlansSaga);
  yield takeLatest(
    actionType.REFRESH_LOADED_MODELS_REQUEST,
    refreshLoadedModelsSaga,
  );
  yield takeLatest(
    actionType.CREATE_MULTIPLE_PLANS_REQUEST,
    createMultiplePlansSaga,
  );
  yield takeLatest(actionType.UPDATE_PLANS_ORDER_REQUEST, updatePlansOrderSaga);
}

export default sequenceSaga;
