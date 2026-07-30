import * as type from "./actionTypes";

const initialState = {
  rootFolderId: null,
  rootCommentId: null,
  phaseFolderId: null,
  phaseCommentId: null,
  activeSimulationItem: null,
  plans: [],
  subPlans: [],
  templateFile: null,
  sequencesToBeCopied: [],
  sequenceObjects: [],
  selectedObjects: [],
  selectedGroup: null,
  startDate: null,
  endDate: null,
  pending: false,
  error: null,
};

const reducers = (state = initialState, action) => {
  switch (action.type) {
    case type.CREATE_PLAN_REQUEST:
    case type.UPDATE_PLAN_REQUEST:
    case type.GET_PLAN_REQUEST:
    case type.DELETE_PLAN_REQUEST:
    case type.CREATE_SUBPLAN_REQUEST:
    case type.UPDATE_SUBPLAN_REQUEST:
    case type.GET_SUBPLAN_REQUEST:
    case type.DELETE_SUBPLAN_REQUEST:
    case type.GET_SOURCE_SEQUENCE_REQUEST:
    case type.UPDATE_COMMENT_REQUEST:
    case type.SET_OBJECTS_REQUEST:
    case type.UPLOAD_TEMPLATE_REQUEST:
    case type.SELECT_OBJECTS_REQUEST:
      return {
        ...state,
        pending: true,
        error: null,
      };

    case type.CREATE_PLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        rootCommentId: action.payload.rootCommentId,
        plans: Array.isArray(action.payload.plans)
          ? [...action.payload.plans]
          : [],
      };
    case type.SET_SIMULATION_DATE_RANGE:
      console.log(action.payload)
      return {
        ...state,
        startDate: action.payload.startDate,
        endDate: action.payload.endDate,
      };

    case type.UPDATE_PLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        plans: Array.isArray(action.payload.plans)
          ? [...action.payload.plans]
          : state.plans,
      };

    case type.GET_PLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        rootFolderId: action.payload.folderId,
        rootCommentId: action.payload.rootCommentId,
        plans: action.payload.plans || [],
        subPlans: action.payload.subPlans || [],
        sequenceObjects: action.payload.sequenceObjects || [],
      };

    case type.DELETE_PLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        plans: Array.isArray(action.payload.plans) ? action.payload.plans : [],
        subPlans: state.subPlans.filter(
          (x) => String(x.planId) !== String(action.payload.deletedPlanId),
        ),
        sequenceObjects: state.sequenceObjects.filter(
          (x) => String(x.planId) !== String(action.payload.deletedPlanId),
        ),
      };

    case type.CREATE_SUBPLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        phaseCommentId: action.payload.phaseCommentId,
        subPlans: Array.isArray(action.payload.subPlans)
          ? [...action.payload.subPlans]
          : state.subPlans,
        sequenceObjects: Array.isArray(action.payload.sequenceObjects)
          ? [...action.payload.sequenceObjects]
          : [],
      };

    case type.UPDATE_SUBPLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        subPlans: Array.isArray(action.payload.subPlans)
          ? [...action.payload.subPlans]
          : state.subPlans,
      };

    case type.GET_SUBPLAN_SUCCESS:
      const updatedSubPlans = [
        ...new Map(
          [...state.subPlans, ...action.payload.subPlans].map(
            (x) => x && [x.id, x],
          ),
        ).values(),
      ];

      const updatedObjects = [
        ...new Map(
          [...state.sequenceObjects, ...action.payload.sequenceObjects]
            .filter(Boolean)
            .map((x) => [x.subPlanId, x]),
        ).values(),
      ];

      return {
        ...state,
        pending: false,
        phaseFolderId: action.payload.phaseFolderId,
        phaseCommentId: action.payload.phaseCommentId,
        subPlans: Array.isArray(updatedSubPlans)
          ? updatedSubPlans
          : state.subPlans,
        sequenceObjects: Array.isArray(updatedObjects) ? updatedObjects : [],
        selectedObjects: [],
        selectedGroup: null,
      };

    case type.SET_ACTIVE_SIMULATION_ITEM:
      return {
        ...state,
        activeSimulationItem: action.payload,
      };

    case type.GET_SOURCE_SEQUENCE_SUCCESS:
      return {
        ...state,
        pending: false,
        sequencesToBeCopied: Array.isArray(action.payload.sequences)
          ? [...action.payload.sequences]
          : [],
      };

    case type.DELETE_SUBPLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        subPlans: Array.isArray(action.payload.subPlans)
          ? [...action.payload.subPlans]
          : state.subPlans,
        sequenceObjects: Array.isArray(action.payload.sequenceObjects)
          ? [...action.payload.sequenceObjects]
          : [],
        selectedObjects: [],
        selectedGroup: null,
      };

    case type.UPDATE_COMMENT_SUCCESS:
      return {
        ...state,
        pending: false,
        rootCommentId: action.payload.rootCommentId ?? state.rootCommentId,
        phaseCommentId: action.payload.phaseCommentId ?? state.phaseCommentId,
        plans: Array.isArray(action.payload.plans)
          ? [...action.payload.plans]
          : state.plans,
        subPlans: Array.isArray(action.payload.subPlans)
          ? [...action.payload.subPlans]
          : state.subPlans,
        sequenceObjects: Array.isArray(action.payload.sequenceObjects)
          ? [...action.payload.sequenceObjects]
          : state.sequenceObjects,
      };

    // case type.SET_OBJECTS_SUCCESS: {
    //   const subPlanId = action.payload?.subPlanId;
    //   const newObjects = action.payload?.objects ?? [];

    //   const otherSequenceObjects = state.sequenceObjects.filter(
    //     (x) => x?.subPlanId !== subPlanId,
    //   );

    //   console.log("otherSequenceObjects", otherSequenceObjects);
    //   console.log("newObjects", newObjects);

    //   return {
    //     ...state,
    //     pending: false,
    //     sequenceObjects: [
    //       ...otherSequenceObjects,
    //       {
    //         subPlanId,
    //         objects: newObjects,
    //       },
    //     ],
    //   };
    // }

    case type.SET_OBJECTS_SUCCESS: {
      const subPlanId = action.payload?.subPlanId;
      const newObjects = action.payload?.objects ?? [];

      return {
        ...state,
        pending: false,
        sequenceObjects: state.sequenceObjects.map((group) =>
          group?.subPlanId === subPlanId
            ? {
                ...group,
                objects: newObjects,
              }
            : group,
        ),
      };
    }

    case type.SELECT_OBJECTS_SUCCESS: {
      const objects = action.payload?.objects ?? [];
      const selectedGroup = action.payload?.folderId ?? null;

      return {
        ...state,
        pending: false,
        selectedObjects: objects,
        selectedGroup,
      };
    }

    case type.UPLOAD_TEMPLATE_SUCCESS:
      return {
        ...state,
        pending: false,
        templateFile: action.payload.templateFile,
      };

    case type.CREATE_PLAN_FAILURE:
    case type.UPDATE_PLAN_FAILURE:
    case type.GET_PLAN_FAILURE:
    case type.DELETE_PLAN_FAILURE:
    case type.CREATE_SUBPLAN_FAILURE:
    case type.UPDATE_SUBPLAN_FAILURE:
    case type.GET_SUBPLAN_FAILURE:
    case type.DELETE_SUBPLAN_FAILURE:
    case type.GET_SOURCE_SEQUENCE_FAILURE:
    case type.UPDATE_COMMENT_FAILURE:
    case type.SET_OBJECTS_FAILURE:
    case type.UPLOAD_TEMPLATE_FAILURE:
    case type.SELECT_OBJECTS_FAILURE:
      return {
        ...state,
        pending: false,
        error: action.payload || action.error,
      };

    default:
      return state;
  }
};

export default reducers;
