import axios from "axios";
import {
  all,
  call,
  put,
  takeLatest,
  takeEvery,
  fork,
} from "redux-saga/effects";
import {
  GetSubPlansSuccess,
  GetSubPlansFailure,
  CreateSubPlanSuccess,
  CreateSubPlanFailure,
  DeleteSubPlanFailure,
  DeleteSubPlanSuccess,
  UpdateSubPlanSuccess,
  UpdateSubPlanFailure,
  UpdateCommentSuccess,
  UpdateCommentFailure,
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
  UploadTemplateSuccess,
  UploadTemplateFailure,
  ExportTemplateSuccess,
  ExportTemplateFailure,
} from "./action";
import instance from "../../interceptors/axios";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const TEMPLATE_FOLDER_NAME = "SequencingTemplate";
//Backup
function safeParseJson(value, fallback = []) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch (error) {
    console.error("JSON parse error:", error, value);
    return fallback;
  }
}
function parseSequenceObjects(comments) {
  if (!comments || comments.length === 0) return [];

  const contents = comments
    .map((x) => {
      const [id, content = ""] = x.description.split("tuan");

      return {
        id,
        content,
      };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));

  const content = contents.map((x) => x.content).join("");

  const parsed = safeParseJson(content, []);

  if (Array.isArray(parsed)) return parsed;

  if (Array.isArray(parsed.objects)) return parsed.objects;

  return [];
}
function* getPlansSaga(action) {
  try {
    const { projectId, projectName } = action.payload;
    const templateFolderId = yield call(getOrCreateTemplateFolder, {
      projectId,
      projectName,
    });
    const getFolderUrl = `/folders/by_path?path=${encodeURIComponent(action.payload.projectName)}&projectId=${action.payload.projectId}`;

    const response = yield call(instance.get, getFolderUrl);

    const folders = response.data.filter((x) => x.name === "Sequence");

    console.log(folders);

    if (folders.length === 0) {
      const insertFolderUrl = `/folders`;

      const insertFolderResponse = yield call(instance.post, insertFolderUrl, {
        name: "Sequence",
        parentId: response.data[0].parentId,
      });

      yield put(
        GetPlanSuccess({
          rootCommentId: null,
          folderId: insertFolderResponse.data.id,
          plans: [],
          subPlans: [],
          sequenceObjects: [],
        }),
      );

      return;
    }

    const sequenceFolderId = folders[0].id;

    const getRootCommentUrl = `/comments?objectId=${sequenceFolderId}&objectType=FOLDER`;
    const rootCommentResponse = yield call(instance.get, getRootCommentUrl);

    const rootCommentId =
      rootCommentResponse.data.length > 0
        ? rootCommentResponse.data[0].id
        : null;

    const plans = safeParseJson(
      rootCommentResponse.data.length > 0
        ? rootCommentResponse.data[0].description
        : "[]",
      [],
    );

    const allSubPlans = [];
    const allSequenceObjects = [];

    for (const plan of plans) {
      const getSubPlanCommentUrl = `/comments?objectId=${plan.id}&objectType=FOLDER`;

      const subPlanCommentResponse = yield call(
        instance.get,
        getSubPlanCommentUrl,
      );

      const phaseCommentId =
        subPlanCommentResponse.data.length > 0
          ? subPlanCommentResponse.data[0].id
          : null;

      const subPlansInPlan = safeParseJson(
        subPlanCommentResponse.data.length > 0
          ? subPlanCommentResponse.data[0].description
          : "[]",
        [],
      );

      const normalizedSubPlans = subPlansInPlan.map((subPlan) => ({
        ...subPlan,
        planId: plan.id,
        phaseCommentId,
      }));

      allSubPlans.push(...normalizedSubPlans);

      for (const subPlan of normalizedSubPlans) {
        const getSequenceCommentUrl = `/comments?objectId=${subPlan.id}&objectType=FOLDER`;

        const sequenceCommentResponse = yield call(
          instance.get,
          getSequenceCommentUrl,
        );

        const objects = parseSequenceObjects(sequenceCommentResponse.data);

        const normalizedObjects = objects.map((obj) => ({
          ...obj,
          planId: plan.id,
          subPlanId: subPlan.id,
        }));

        allSequenceObjects.push({
          planId: plan.id,
          subPlanId: subPlan.id,
          objects: normalizedObjects,
        });
      }
    }

    yield put(
      GetPlanSuccess({
        rootCommentId,
        folderId: sequenceFolderId,
        plans,
        subPlans: allSubPlans,
        sequenceObjects: allSequenceObjects,
      }),
    );
  } catch (error) {
    console.error("Error fetching sequence data:", error);
    yield put(GetPlanFailure(error.message));
  }
}
function* getSubPlansSaga(action) {
  try {
    //Get comment in the sequence folder
    const getCommentUrl = `/comments?objectId=${action.payload.folderId}&objectType=FOLDER`;
    const commentResponse = yield call(instance.get, getCommentUrl);

    const subPlans = JSON.parse(
      commentResponse.data.length > 0
        ? commentResponse.data[0].description
        : "[]",
    );
    console.log("subPlans", subPlans);
    const sequenceObjects = [];
    for (const subPlan of subPlans) {
      const getSequenceCommentUrl = `/comments?objectId=${subPlan.id}&objectType=FOLDER`;
      const sequenceCommentResponse = yield call(
        instance.get,
        getSequenceCommentUrl,
      );
      console.log("sequenceCommentResponse", sequenceCommentResponse);
      const contents = sequenceCommentResponse.data.map((x) => {
        return {
          id: x.description.split("tuan")[0],
          content: x.description.split("tuan")[1],
        };
      });
      contents.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      const content = contents.map((x) => x.content).join("");
      const objects = JSON.parse(content.length > 0 ? content : null);
      sequenceObjects.push(objects);
    }
    console.log("sequenceObjects", sequenceObjects);
    yield put(
      GetSubPlansSuccess({
        phaseCommentId:
          commentResponse.data.length > 0 ? commentResponse.data[0].id : null,
        phaseFolderId: action.payload.folderId,
        subPlans: subPlans,
        sequenceObjects: sequenceObjects,
      }),
    );
  } catch (error) {
    console.error("Error fetching folder:", error);
    yield put(GetSubPlansFailure(error.message));
  }
}
function* createPlanSaga(action) {
  const insertFolderUrl = `/folders`;
  console.log(action.payload);
  const insertFolderBody = {
    name: action.payload.name,
    parentId: action.payload.rootFolderId,
  };
  const insertFolderResponse = yield call(
    instance.post,
    insertFolderUrl,
    insertFolderBody,
  );
  try {
    const newPlan = {
      id: insertFolderResponse.data.id,
      name: action.payload.name,
    };
    const newPlans = [...action.payload.plans, newPlan];
    console.log(newPlans);
    if (action.payload.rootCommentId) {
      //Update comment with new phase list
      const updateCommentUrl = `/comments/${action.payload.rootCommentId}`;
      yield call(instance.patch, updateCommentUrl, {
        description: JSON.stringify(newPlans),
      });
      yield put(
        CreatePlanSuccess({
          rootCommentId: action.payload.rootCommentId,
          plans: [...action.payload.plans, newPlan],
        }),
      );
    } else {
      //Create comment with phase list
      const createCommentUrl = `/comments`;
      const createCommentBody = {
        objectId: action.payload.rootFolderId,
        objectType: "FOLDER",
        description: JSON.stringify(newPlans),
      };
      console.log(createCommentBody);
      const responseInsertComment = yield call(
        instance.post,
        createCommentUrl,
        createCommentBody,
      );
      yield put(
        CreatePlanSuccess({
          rootCommentId: responseInsertComment.data.id,
          plans: [...action.payload.plans, newPlan],
        }),
      );
    }
  } catch (error) {
    console.error("Error creating folder:", error);
    yield put(CreatePlanFailure(error.message));
  }
}
function* updatePlanSaga(action) {
  try {
    //Update comment with new sequence list
    const updateCommentUrl = `/comments/${action.payload.commentId}`;
    yield call(instance.patch, updateCommentUrl, {
      description: JSON.stringify(action.payload.plans),
    });
    yield put(
      UpdatePlanSuccess({
        plans: [...action.payload.plans],
      }),
    );
  } catch (error) {
    console.error("Error updating comment:", error);
    yield put(UpdatePlanFailure(error.message));
  }
}
function* deletePlanSaga(action) {
  try {
    //Delete folder
    const deleteFolderUrl = `/folders/${action.payload.folderId}`;
    var deleteStatus = false;
    try {
      const deleteFolderResponse = yield call(instance.delete, deleteFolderUrl);
      console.log("deleteFolderResponse", deleteFolderResponse.status);
      deleteStatus = deleteFolderResponse.status === 204;
    } catch (error) {
      deleteStatus = error.message.includes("404");
    }
    if (deleteStatus) {
      const newPlans = action.payload.plans.filter(
        (x) => x.id !== action.payload.folderId,
      );

      //Update comment with new sequence list
      const updateCommentUrl = `/comments/${action.payload.rootCommentId}`;
      yield call(instance.patch, updateCommentUrl, {
        description: JSON.stringify(newPlans),
      });
      yield put(
        DeletePlanSuccess({
          plans: [...newPlans],
          deletedPlanId: action.payload.folderId,
        }),
      );
    } else {
      yield put(DeletePlanFailure("Failed to delete plan"));
    }
  } catch (error) {
    console.error("Error updating comment:", error);
    yield put(DeletePlanFailure(error.message));
  }
}
function* createSubPlanSaga(action) {
  const insertFolderUrl = `/folders`;
  console.log(action.payload);
  const insertFolderBody = {
    name: action.payload.name,
    parentId: action.payload.phaseFolderId,
  };
  const insertFolderResponse = yield call(
    instance.post,
    insertFolderUrl,
    insertFolderBody,
  );
  try {
    const newSubPlan = {
      id: insertFolderResponse.data.id,
      planId: action.payload.phaseFolderId,
      name: action.payload.name,
      color: action.payload.color,
      check: action.payload.check,
    };
    const prevSubPlans = action.payload.subPlans.filter(
      (x) => x && x.planId === newSubPlan.planId,
    );
    const newSubPlans = [...prevSubPlans, newSubPlan];
    console.log(newSubPlans);
    if (action.payload.phaseCommentId) {
      //Update comment with new sequence list
      const updateCommentUrl = `/comments/${action.payload.phaseCommentId}`;
      yield call(instance.patch, updateCommentUrl, {
        description: JSON.stringify(newSubPlans),
      });
      yield put(
        CreateSubPlanSuccess({
          phaseCommentId: action.payload.phaseCommentId,
          subPlans: [...action.payload.subPlans, newSubPlan],
          sequenceObjects: [
            ...action.payload.sequenceObjects,
            {
              planId: newSubPlan.planId,
              subPlanId: newSubPlan.id,
              objects: [],
            },
          ],
        }),
      );
    } else {
      //Create comment with sequence list
      const createCommentUrl = `/comments`;
      const createCommentBody = {
        objectId: action.payload.phaseFolderId,
        objectType: "FOLDER",
        description: JSON.stringify(newSubPlans),
      };
      const responseInsertComment = yield call(
        instance.post,
        createCommentUrl,
        createCommentBody,
      );
      yield put(
        CreateSubPlanSuccess({
          phaseCommentId: responseInsertComment.data.id,
          subPlans: [...action.payload.subPlans, newSubPlan],
          sequenceObjects: [
            ...action.payload.sequenceObjects,
            {
              planId: newSubPlan.planId,
              subPlanId: newSubPlan.id,
              objects: [],
            },
          ],
        }),
      );
    }
  } catch (error) {
    console.error("Error creating folder:", error);
    yield put(CreateSubPlanFailure(error.message));
  }
}
function* updateSubPlanSaga(action) {
  try {
    //Get comment in the folder
    const getCommentUrl = `/comments?objectId=${action.payload.subPlans[0].planId}&objectType=FOLDER`;
    const commentResponse = yield call(instance.get, getCommentUrl);
    const comments = commentResponse.data;
    //Update comment with new sequence list
    const updateCommentUrl = `/comments/${comments[0].id}`;
    yield call(instance.patch, updateCommentUrl, {
      description: JSON.stringify(action.payload.subPlans),
    });
    yield put(
      UpdateSubPlanSuccess({
        subPlans: [...action.payload.subPlans],
      }),
    );
  } catch (error) {
    console.error("Error updating comment:", error);
    yield put(UpdateSubPlanFailure(error.message));
  }
}
function* deleteSubPlanSaga(action) {
  try {
    console.log("deleteSubPlanSaga", action.payload);
    //Delete folder
    const deleteFolderUrl = `/folders/${action.payload.subPlanId}`;
    var deleteStatus = false;
    try {
      const deleteFolderResponse = yield call(instance.delete, deleteFolderUrl);
      console.log("deleteFolderResponse", deleteFolderResponse.status);
      deleteStatus = deleteFolderResponse.status === 204;
    } catch (error) {
      deleteStatus = error.message.includes("404");
    }
    if (deleteStatus) {
      const newSubPlans = action.payload.subPlans.filter(
        (x) => x && x.id !== action.payload.subPlanId,
      );
      const newSequenceObjects = action.payload.sequenceObjects.filter(
        (x) => x && x.subPlanId !== action.payload.subPlanId,
      );
      //Get comment in the folder
      const getCommentUrl = `/comments?objectId=${action.payload.planId}&objectType=FOLDER`;
      const commentResponse = yield call(instance.get, getCommentUrl);
      const comments = commentResponse.data;

      //Update comment with new sequence list
      const updateCommentUrl = `/comments/${comments[0].id}`;
      yield call(instance.patch, updateCommentUrl, {
        description: JSON.stringify(newSubPlans),
      });
      yield put(
        DeleteSubPlanSuccess({
          subPlans: [...newSubPlans],
          sequenceObjects: [...newSequenceObjects],
        }),
      );
    } else {
      yield put(DeleteSubPlanFailure("Failed to delete sub plan"));
    }
  } catch (error) {
    console.error("Error updating comment:", error);
    yield put(DeleteSubPlanFailure(error.message));
  }
}
function* getSourceSequenceSaga(action) {
  try {
    //Get comment in the sequence folder
    const getCommentUrl = `/comments?objectId=${action.payload.folderId}&objectType=FOLDER`;
    const commentResponse = yield call(instance.get, getCommentUrl);

    const sequences = JSON.parse(
      commentResponse.data.length > 0
        ? commentResponse.data[0].description
        : "[]",
    );

    yield put(
      GetSourceSequenceSuccess({
        sequences: sequences,
      }),
    );
  } catch (error) {
    console.error("Error fetching folder:", error);
    yield put(GetSourceSequenceFailure(error.message));
  }
}
function* copySequenceSaga(action) {
  try {
    const newSubPlans = [];

    for (const subPlan of action.payload.newSubPlans) {
      const insertFolderUrl = "/folders";
      const insertFolderBody = {
        name: subPlan.name,
        parentId: action.payload.planId,
      };

      const insertFolderResponse = yield call(
        instance.post,
        insertFolderUrl,
        insertFolderBody,
      );

      newSubPlans.push({
        id: insertFolderResponse.data.id,
        planId: action.payload.planId,
        name: subPlan.name,
        color: subPlan.color,
        check: false,
      });
    }
    //Get comment in the folder
    const getCommentUrl = `/comments?objectId=${action.payload.planId}&objectType=FOLDER`;
    const commentResponse = yield call(instance.get, getCommentUrl);
    const comments = commentResponse.data;
    console.log("comments", comments);
    if (comments.length === 0) {
      //Create comment with sequence list
      const createCommentUrl = `/comments`;
      const createCommentBody = {
        objectId: action.payload.planId,
        objectType: "FOLDER",
        description: JSON.stringify(newSubPlans),
      };
      const responseInsertComment = yield call(
        instance.post,
        createCommentUrl,
        createCommentBody,
      );
    } else {
      //Update comment with new sequence list
      const updateCommentUrl = `/comments/${comments[0].id}`;
      yield call(instance.patch, updateCommentUrl, {
        description: JSON.stringify(newSubPlans),
      });
    }
    yield put(
      UpdateSubPlanSuccess({
        subPlans: [...action.payload.subPlans, ...newSubPlans],
      }),
    );
  } catch (error) {
    console.error("Error updating comment:", error);
    const message = error?.message ?? "Something went wrong";
    yield put(UpdateSubPlanFailure(error.message));
  }
}
function* updateCommentSaga(action) {
  try {
    //Get comment in the folder
    const getCommentUrl = `/comments?objectId=${action.payload.folderId}&objectType=FOLDER`;
    const commentResponse = yield call(instance.get, getCommentUrl);
    const comments = commentResponse.data;
    //Update comment with new sequence list
    const updateCommentUrl = `/comments/${comments[0].id}`;
    yield call(instance.patch, updateCommentUrl, {
      description: JSON.stringify(action.payload.subPlans),
    });
    yield put(
      UpdateCommentSuccess({
        subPlans: [...action.payload.subPlans],
      }),
    );
  } catch (error) {
    console.error("Error updating comment:", error);
    yield put(UpdateCommentFailure(error.message));
  }
}
function* setObjectsSaga(action) {
  try {
    console.log("Set objects saga", action.payload);
    const subPlanId = action.payload.subPlanId;
    console.log(subPlanId);
    //Get all comments
    const getCommentUrl = `/comments?objectId=${subPlanId}&objectType=FOLDER`;
    const commentResponse = yield call(instance.get, getCommentUrl);

    for (const comment of commentResponse.data) {
      const deleteCommentUrl = `/comments/${comment.id}`;
      console.log("Deleting comment with id", comment.id);
      yield call(instance.delete, deleteCommentUrl);
    }

    //Create comment with sequence list
    const stringContent = JSON.stringify(action.payload);
    var startIndex = 0;
    var step = 800;
    var chunkIndex = 0;
    const createCommentUrl = `/comments`;
    while (startIndex < stringContent.length) {
      const chunk = stringContent.substring(startIndex, startIndex + step);
      startIndex += step;
      chunkIndex++;
      const createCommentBody = {
        objectId: subPlanId,
        objectType: "FOLDER",
        description: chunkIndex + "tuan" + chunk,
      };
      const responseInsertComment = yield call(
        instance.post,
        createCommentUrl,
        createCommentBody,
      );
    }
    yield put(SetObjectsSuccess(action.payload));
  } catch (error) {
    console.error("Error creating folder:", error);
    yield put(SetObjectsFailure(error.message));
  }
}

function* getOrCreateTemplateFolder({ projectId, projectName }) {
  const getFolderUrl = `/folders/by_path?path=${encodeURIComponent(projectName)}&projectId=${projectId}`;
  const response = yield call(instance.get, getFolderUrl);

  const templateFolder = response.data.find(
    (x) => x.name === TEMPLATE_FOLDER_NAME,
  );

  if (templateFolder) {
    return templateFolder.id;
  }

  const createResponse = yield call(instance.post, "/folders", {
    name: TEMPLATE_FOLDER_NAME,
    parentId: response.data[0].parentId,
  });

  return createResponse.data.id;
}

function* uploadTemplateSaga(action) {
  try {
    const { projectId, projectName, file } = action.payload;

    const templateFolderId = yield call(getOrCreateTemplateFolder, {
      projectId,
      projectName,
    });

    const initRes = yield call(instance.post, "/trimble/files/uploads", {
      parentId: templateFolderId,
      name: file.name,
      size: file.size,
      contentType:
        file.type ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const uploadUrl =
      initRes.data.uploadUrl || initRes.data.upload_url || initRes.data.url;

    const fileId =
      initRes.data.fileId || initRes.data.file_id || initRes.data.id;

    if (!uploadUrl) {
      throw new Error("Failed to get uploadUrl");
    }

    const uploadRes = yield call(fetch, uploadUrl, {
      method: "PUT",
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.status}`);
    }

    const detailsRes = yield call(
      instance.get,
      `/trimble/files/uploads/${fileId}`,
    );

    yield put(
      UploadTemplateSuccess({
        templateFolderId,
        templateFile: detailsRes.data,
      }),
    );
  } catch (error) {
    yield put(
      UploadTemplateFailure(error.response?.data?.message || error.message),
    );
  }
}

const PLACEHOLDERS = {
  ProjectName: "",
  ReportDate: "",
  GroupDate: "",
  Qty: "",
  Index: "",
  AsmName: "",
  AsmPos: "",
  MainProfile: "",
  GridPos: "",
  Length: "",
  Weight: "",
  Comment: "",
};

function getCellText(cell) {
  return typeof cell.value === "string" ? cell.value : "";
}

function fillText(value, data) {
  if (typeof value !== "string") return value;

  return value.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    return data[key.trim()] ?? "";
  });
}

function copyRowStyle(fromRow, toRow) {
  fromRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const target = toRow.getCell(col);

    target.style = JSON.parse(JSON.stringify(cell.style || {}));
    target.numFmt = cell.numFmt;
    target.alignment = cell.alignment;
    target.border = cell.border;
    target.fill = cell.fill;
    target.font = cell.font;
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
  let groupDateRowIndex = null;
  let itemRowIndex = null;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const text = getCellText(cell);

      if (text.includes("{{GroupDate}}") || text.includes("{{Qty}}")) {
        groupDateRowIndex = rowNumber;
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

  if (!groupDateRowIndex || !itemRowIndex) {
    throw new Error(
      "Template thiếu {{GroupDate}}/{{Qty}} hoặc dòng item {{Index}}",
    );
  }

  return {
    groupDateRowIndex,
    itemRowIndex,
  };
}

function fillGroups(worksheet, groups) {
  const { groupDateRowIndex, itemRowIndex } = findTemplateRows(worksheet);

  const dateTemplateRow = worksheet.getRow(groupDateRowIndex);
  const itemTemplateRow = worksheet.getRow(itemRowIndex);

  const dateTemplateValues = [...dateTemplateRow.values];
  const itemTemplateValues = [...itemTemplateRow.values];

  worksheet.spliceRows(groupDateRowIndex, itemRowIndex - groupDateRowIndex + 1);

  let insertAt = groupDateRowIndex;

  groups.forEach((group) => {
    worksheet.spliceRows(insertAt, 0, dateTemplateValues);

    const dateRow = worksheet.getRow(insertAt);
    copyRowStyle(dateTemplateRow, dateRow);

    dateRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = fillText(cell.value, {
        GroupDate: group.date || "",
        Qty: group.items.length,
      });
    });

    dateRow.commit();
    insertAt++;

    group.items.forEach((item, index) => {
      worksheet.spliceRows(insertAt, 0, itemTemplateValues);

      const itemRow = worksheet.getRow(insertAt);
      copyRowStyle(itemTemplateRow, itemRow);

      itemRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.value = fillText(cell.value, {
          Index: index + 1,
          AsmName: item.AsmName || "",
          AsmPos: item.AsmPos || "",
          MainProfile: item.MainProfile || "",
          GridPos: item.GridPos || "",
          Length: item.Length || "",
          Weight: item.Weight || "",
          Comment: item.Comment || "",
        });
      });

      itemRow.commit();
      insertAt++;
    });
  });
}

function buildGroupsFromSequenceObjects(plans = [], sequenceObjects = []) {
  return sequenceObjects
    .filter((group) => group && Array.isArray(group.objects))
    .map((group) => {
      const plan = plans.find((x) => String(x.id) === String(group.planId));

      return {
        name: plan?.name || "",
        date: group.objects[0]?.date || group.objects[0]?.assignedDate || "",
        items: group.objects.map((obj) => ({
          AsmName: obj.name || obj.asmName || "",
          AsmPos: obj.asmPos || "",
          MainProfile: obj.profile || obj.mainProfile || "",
          GridPos: obj.positionCode || obj.gridPos || obj.location || "",
          Length: obj.length || "",
          Weight: Math.round(Number(obj.weight || 0) * 100) / 100,
          Comment: obj.comment || "",
        })),
      };
    });
}

function* getTemplateFile(templateFolderId) {
  const res = yield call(instance.get, `/folders/${templateFolderId}/contents`);

  const file = res.data.find(
    (x) =>
      (x.type === "FILE" || x.objectType === "FILE" || x.fileType) &&
      (x.name?.endsWith(".xlsx") || x.name?.endsWith(".xlsm")),
  );

  if (!file) {
    throw new Error(`Không tìm thấy file Excel trong ${TEMPLATE_FOLDER_NAME}`);
  }

  return file;
}

// function* downloadTemplateBuffer(fileId) {
//   const res = yield call(instance.get, `/files/${fileId}/downloadurl`);

//   const downloadUrl =
//     res.data.url || res.data.downloadUrl || res.data.download_url;

//   if (!downloadUrl) {
//     throw new Error("Không lấy được downloadUrl");
//   }

//   const response = yield call(fetch, downloadUrl);

//   if (!response.ok) {
//     throw new Error(`Download template failed: ${response.status}`);
//   }

//   return yield call([response, response.arrayBuffer]);
// }

function* downloadPublicTemplateBuffer() {
  const response = yield call(fetch, "/templates/SequencingTemplate.xlsx");

  if (!response.ok) {
    throw new Error(`Không tìm thấy template: ${response.status}`);
  }

  return yield call([response, response.arrayBuffer]);
}

function* exportTemplateSaga(action) {
  try {
    const { projectName, plans, sequenceObjects } = action.payload;

    const groups = buildGroupsFromSequenceObjects(plans, sequenceObjects);

    const buffer = yield call(downloadPublicTemplateBuffer);

    const workbook = new ExcelJS.Workbook();
    yield call([workbook.xlsx, workbook.xlsx.load], buffer);

    const worksheet = workbook.getWorksheet(1);

    fillHeader(worksheet, {
      ProjectName: projectName,
      ReportDate: new Date().toLocaleDateString("vi-VN"),
    });

    fillGroups(worksheet, groups);

    const output = yield call([workbook.xlsx, workbook.xlsx.writeBuffer]);

    saveAs(
      new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "Sequencing.xlsx",
    );
  } catch (error) {
    console.error(error);
  }
}

function* sequenceSaga() {
  yield takeEvery("GET_PLAN_REQUEST", getPlansSaga);
  yield takeEvery("CREATE_PLAN_REQUEST", createPlanSaga);
  yield takeEvery("UPDATE_PLAN_REQUEST", updatePlanSaga);
  yield takeEvery("DELETE_PLAN_REQUEST", deletePlanSaga);
  yield takeEvery("GET_SUBPLAN_REQUEST", getSubPlansSaga);
  yield takeEvery("UPDATE_SUBPLAN_REQUEST", updateSubPlanSaga);
  yield takeEvery("CREATE_SUBPLAN_REQUEST", createSubPlanSaga);
  yield takeEvery("DELETE_SUBPLAN_REQUEST", deleteSubPlanSaga);
  yield takeEvery("UPDATE_COMMENT_REQUEST", updateCommentSaga);
  yield takeEvery("GET_SOURCE_SEQUENCE_REQUEST", getSourceSequenceSaga);
  yield takeEvery("COPY_SEQUENCE_REQUEST", copySequenceSaga);
  yield takeEvery("SET_OBJECTS_REQUEST", setObjectsSaga);
  yield takeEvery("EXPORT_TEMPLATE_REQUEST", exportTemplateSaga);
}
export default sequenceSaga;
