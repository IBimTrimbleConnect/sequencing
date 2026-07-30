import * as actionType from "./actionTypes";

export function CreatePlanRequest(payload) {
  return {
    type: actionType.CREATE_PLAN_REQUEST,
    payload: payload,
  };
}
export function CreatePlanSuccess(payload) {
  return {
    type: actionType.CREATE_PLAN_SUCCESS,
    payload: payload,
  };
}
export function CreatePlanFailure(payload) {
  return {
    type: actionType.CREATE_PLAN_FAILURE,
    payload: payload, 
  };
}

export function UpdatePlanRequest(payload) {
  return {
    type: actionType.UPDATE_PLAN_REQUEST,
    payload: payload,
  };
}
export function UpdatePlanSuccess(payload) {
  return {
    type: actionType.UPDATE_PLAN_SUCCESS,
    payload: payload,
  };
}
export function UpdatePlanFailure(payload) {
  return {
    type: actionType.UPDATE_PLAN_FAILURE,
    payload: payload,
  };
}

export function GetPlanRequest(payload) {
  return {
    type: actionType.GET_PLAN_REQUEST,
    payload: payload,
  };
}
export function GetPlanSuccess(payload) {
  return {
    type: actionType.GET_PLAN_SUCCESS,
    payload: payload,
  };
}
export function GetPlanFailure(payload) {
  return {
    type: actionType.GET_PLAN_FAILURE,
    payload: payload,
  };
}

export function DeletePlanRequest(payload) {
  return {
    type: actionType.DELETE_PLAN_REQUEST,
    payload: payload,
  };
}
export function DeletePlanSuccess(payload) {
  return {
    type: actionType.DELETE_PLAN_SUCCESS,
    payload: payload,
  };
}
export function DeletePlanFailure(payload) {
  return {
    type: actionType.DELETE_PLAN_FAILURE,
    payload: payload,
  };
}

export function CreateSubPlanRequest(payload) {
  return {
    type: actionType.CREATE_SUBPLAN_REQUEST,
    payload: payload,
  };
}
export function CreateSubPlanSuccess(payload) {
  return {
    type: actionType.CREATE_SUBPLAN_SUCCESS,
    payload: payload,
  };
}
export function CreateSubPlanFailure(payload) {
  return {
    type: actionType.CREATE_SUBPLAN_FAILURE,
    payload: payload,
  };
}

export function UpdateSubPlanRequest(payload) {
  return {
    type: actionType.UPDATE_SUBPLAN_REQUEST,
    payload: payload,
  };
}
export function UpdateSubPlanSuccess(payload) {
  return {
    type: actionType.UPDATE_SUBPLAN_SUCCESS,
    payload: payload,
  };
}
export function UpdateSubPlanFailure(payload) {
  return {
    type: actionType.UPDATE_SUBPLAN_FAILURE,
    payload: payload,
  };
}

export function GetSubPlansRequest(payload) {
  return {
    type: actionType.GET_SUBPLAN_REQUEST,
    payload: payload,
  };
}
export function GetSubPlansSuccess(payload) {
  return {
    type: actionType.GET_SUBPLAN_SUCCESS,
    payload: payload,
  };
}
export function GetSubPlansFailure(payload) {
  return {
    type: actionType.GET_SUBPLAN_FAILURE,
    payload: payload,
  };
}
export function DeleteSubPlanRequest(payload) {
  return {
    type: actionType.DELETE_SUBPLAN_REQUEST,
    payload: payload,
  };
}
export function DeleteSubPlanSuccess(payload) {
  return {
    type: actionType.DELETE_SUBPLAN_SUCCESS,
    payload: payload,
  };
}
export function DeleteSubPlanFailure(payload) {
  return {
    type: actionType.DELETE_SUBPLAN_FAILURE,
    payload: payload,
  };
}

export function GetSourceSequenceRequest(payload) {
  return {
    type: actionType.GET_SOURCE_SEQUENCE_REQUEST,
    payload: payload,
  };
}
export function GetSourceSequenceSuccess(payload) {
  return {
    type: actionType.GET_SOURCE_SEQUENCE_SUCCESS,
    payload: payload,
  };
}
export function GetSourceSequenceFailure(payload) {
  return {
    type: actionType.GET_SOURCE_SEQUENCE_FAILURE,
    payload: payload,
  };
}

export function CopySequenceRequest(payload) {
  return {
    type: actionType.COPY_SEQUENCE_REQUEST,
    payload: payload,
  };
}
export function CopySequenceSuccess(payload) {
  return {
    type: actionType.COPY_SEQUENCE_SUCCESS,
    payload: payload,
  };
}
export function CopySequenceFailure(payload) {
  return {
    type: actionType.COPY_SEQUENCE_FAILURE,
    payload: payload,
  };
}

export function CreateCommentRequest(payload) {
  return {
    type: actionType.CREATE_COMMENT_REQUEST,
    payload: payload,
  };
}
export function CreateCommentSuccess(payload) {
  return {
    type: actionType.CREATE_COMMENT_SUCCESS,
    payload: payload,
  };
}
export function CreateCommentFailure(payload) {
  return {
    type: actionType.CREATE_COMMENT_FAILURE,
    payload: payload,
  };
}

export function GetCommentRequest(payload) {
  return {
    type: actionType.GET_COMMENT_REQUEST,
    payload: payload,
  };
}
export function GetCommentSuccess(payload) {
  return {
    type: actionType.GET_COMMENT_SUCCESS,
    payload: payload,
  };
}
export function GetCommentFailure(payload) {
  return {
    type: actionType.GET_COMMENT_FAILURE,
    payload: payload,
  };
}

export function DeleteCommentRequest(payload) {
  return {
    type: actionType.DELETE_COMMENT_REQUEST,
    payload: payload,
  };
}
export function DeleteCommentSuccess(payload) {
  return {
    type: actionType.DELETE_COMMENT_SUCCESS,
    payload: payload,
  };
}
export function DeleteCommentFailure(payload) {
  return {
    type: actionType.DELETE_COMMENT_FAILURE,
    payload: payload,
  };
}

export function UpdateCommentRequest(payload) {
  return {
    type: actionType.UPDATE_COMMENT_REQUEST,
    payload: payload,
  };
}
export function UpdateCommentSuccess(payload) {
  return {
    type: actionType.UPDATE_COMMENT_SUCCESS,
    payload: payload,
  };
}
export function UpdateCommentFailure(payload) {
  return {
    type: actionType.UPDATE_COMMENT_FAILURE,
    payload: payload,
  };
}

export function SetObjectsRequest(payload) {
  return {
    type: actionType.SET_OBJECTS_REQUEST,
    payload: payload,
  };
}
export function SetObjectsSuccess(payload) {
  return {
    type: actionType.SET_OBJECTS_SUCCESS,
    payload: payload,
  };
}
export function SetObjectsFailure(payload) {
  return {
    type: actionType.SET_OBJECTS_FAILURE,
    payload: payload,
  };
}

export function SelectObjectsRequest(payload) {
  return {
    type: actionType.SELECT_OBJECTS_REQUEST,
    payload: payload,
  };
}
export function SelectObjectsSuccess(payload) {
  return {
    type: actionType.SELECT_OBJECTS_SUCCESS,
    payload: payload,
  };
}
export function SelectObjectsFailure(payload) {
  return {
    type: actionType.SELECT_OBJECTS_FAILURE,
    payload: payload,
  };
}
export const SetActiveSimulationItem = (payload) => ({
  type: actionType.SET_ACTIVE_SIMULATION_ITEM,
  payload,
});


export const UploadTemplateRequest = (payload) => ({
  type: actionType.UPLOAD_TEMPLATE_REQUEST,
  payload,
});

export const UploadTemplateSuccess = (payload) => ({
  type: actionType.UPLOAD_TEMPLATE_SUCCESS,
  payload,
});

export const UploadTemplateFailure = (payload) => ({
  type: actionType.UPLOAD_TEMPLATE_FAILURE,
  payload,
});

export const ExportTemplateRequest = (payload) => ({
  type: actionType.EXPORT_TEMPLATE_REQUEST,
  payload,
});

export const ExportTemplateSuccess = (payload) => ({
  type: actionType.EXPORT_TEMPLATE_SUCCESS,
  payload,
});

export const ExportTemplateFailure = (payload) => ({
  type: actionType.EXPORT_TEMPLATE_FAILURE,
  payload,
});

export const SetSimulationDateRange = (payload) => ({
  type: actionType.SET_SIMULATION_DATE_RANGE,
  payload,
});