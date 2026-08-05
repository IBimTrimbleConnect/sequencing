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
} from "./action";

import * as actionType from "./actionTypes";

import {
  getPlansByProject,
  createPlan,
  updatePlan,
  deletePlan,
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

    const tcapi = yield call(WorkspaceAPI.connect, window.parent);

    const [plans, subPlans, sequenceObjectRows] = yield all([
      call(getPlansByProject, projectId),
      call(getSubPlansByProject, projectId),
      call(getSequenceObjectsByProject, projectId),
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
        projectId: String(projectId),

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
      GetPlanFailure(error?.message || "Failed to load sequencing data."),
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

function getCellText(cell) {
  if (typeof cell.value === "string") {
    return cell.value;
  }

  if (cell.value && Array.isArray(cell.value.richText)) {
    return cell.value.richText.map((item) => item.text || "").join("");
  }

  if (cell.value?.text) {
    return String(cell.value.text);
  }

  if (cell.value?.result !== undefined) {
    return String(cell.value.result ?? "");
  }

  return "";
}

function fillText(value, data) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, key) => data[key] ?? "");
}

function copyRowStyle(fromRow, toRow) {
  fromRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const target = toRow.getCell(columnNumber);

    target.style = JSON.parse(JSON.stringify(cell.style || {}));

    target.numFmt = cell.numFmt;
    target.alignment = cell.alignment ? { ...cell.alignment } : undefined;
    target.border = cell.border
      ? JSON.parse(JSON.stringify(cell.border))
      : undefined;
    target.fill = cell.fill ? JSON.parse(JSON.stringify(cell.fill)) : undefined;
    target.font = cell.font ? { ...cell.font } : undefined;
  });

  toRow.height = fromRow.height;
}

function fillHeader(worksheet, data) {
  worksheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (typeof cell.value === "string") {
        cell.value = fillText(cell.value, data);
      }
    });
  });
}

function findTemplateRows(worksheet) {
  let groupRowIndex = null;
  let itemRowIndex = null;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
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
    });
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

function fillGroups(worksheet, groups) {
  const { groupRowIndex, itemRowIndex } = findTemplateRows(worksheet);

  const groupTemplateRow = worksheet.getRow(groupRowIndex);

  const itemTemplateRow = worksheet.getRow(itemRowIndex);

  const groupTemplateValues = [...groupTemplateRow.values];

  const itemTemplateValues = [...itemTemplateRow.values];

  const groupTemplateStyle = worksheet.getRow(groupRowIndex);

  const itemTemplateStyle = worksheet.getRow(itemRowIndex);

  worksheet.spliceRows(groupRowIndex, itemRowIndex - groupRowIndex + 1);

  let insertAt = groupRowIndex;

  for (const group of groups) {
    const currentGroupRowIndex = insertAt;

    worksheet.spliceRows(currentGroupRowIndex, 0, groupTemplateValues);

    const groupRow = worksheet.getRow(currentGroupRowIndex);

    copyRowStyle(groupTemplateStyle, groupRow);

    const groupData = {
      GroupDate: group.date || "",
      Qty: group.items?.length || 0,
    };

    groupRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = fillText(cell.value, groupData);
    });

    insertAt += 1;

    const items = group.items || [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const currentItemRowIndex = insertAt;

      worksheet.spliceRows(currentItemRowIndex, 0, itemTemplateValues);

      const itemRow = worksheet.getRow(currentItemRowIndex);

      copyRowStyle(itemTemplateStyle, itemRow);

      const itemData = {
        Index: index + 1,
        AsmName: item.AsmName || "",
        AsmPos: item.AsmPos || "",
        MainProfile: item.MainProfile || "",
        GridPos: item.GridPos || "",
        Length: item.Length ?? "",
        Weight: item.Weight ?? "",
        Comment: item.Comment || "",
      };

      itemRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.value = fillText(cell.value, itemData);
      });

      insertAt += 1;
    }
  }
}

function buildGroupsFromSequenceObjects(plans = [], sequenceObjects = []) {
  return sequenceObjects
    .filter((group) => group && Array.isArray(group.objects))
    .map((group) => {
      const plan = plans.find(
        (item) => String(item.id) === String(group.planId),
      );

      return {
        name: plan?.name || "",
        date: group.objects[0]?.date || group.objects[0]?.assignedDate || "",
        items: group.objects.map((object) => ({
          AsmName: object.name || object.asmName || "",
          AsmPos: object.asmPos || "",
          MainProfile: object.profile || object.mainProfile || "",
          GridPos:
            object.positionCode || object.gridPos || object.location || "",
          Length: object.length ?? "",
          Weight: Math.round(Number(object.weight || 0) * 100) / 100,
          Comment: object.comment || "",
        })),
      };
    });
}

function* downloadPublicTemplateBuffer(templatePath = DEFAULT_TEMPLATE_PATH) {
  const response = yield call(fetch, templatePath);

  if (!response.ok) {
    throw new Error(`Unable to load Excel template: ${response.status}`);
  }

  return yield call([response, response.arrayBuffer]);
}

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

    fillHeader(worksheet, {
      ProjectName: projectName || "",
      ReportDate: new Date().toLocaleDateString("en-AU"),
    });

    fillGroups(worksheet, groups);

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
}

export default sequenceSaga;
