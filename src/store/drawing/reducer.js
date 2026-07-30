import * as type from "./actionTypes";
const initialState = {
  payload: [],
  trbModels: [],
  annIds: [],
  showAnn: false,
  pending: false,
  error: null,
};
const reducers = (state = initialState, action) => {
  switch (action.type) {
    case type.GET_DRAWING_REQUEST:
      return {
        ...state,
        pending: true,
      };
    case type.GET_DRAWING_SUCCESS:
      return {
        ...state,
        pending: false,
        payload: [...action.payload.views],
      };
    case type.GET_DRAWING_FAILURE:
      return {
        ...state,
        pending: false,
        error: action.error,
      };
    case type.UPDATE_VIEW_VISIBILITY_REQUEST:
      return {
        ...state,
        pending: true,
      };
    case type.UPDATE_VIEW_VISIBILITY_SUCCESS:
      const updatedViews = state.payload.map((view) => {
        if (view.key === action.payload.name) {
          return {
            ...view,
            show: action.payload.show,
          };
        } else {
          return view;
        }
      });
      const viewsTobeHidden = updatedViews.filter((x) => x.show === false);
      const viewsTobeShown = updatedViews.filter((x) => x.show === true);
      var showAnnStatus = state.showAnn;
      if(viewsTobeHidden.length == updatedViews.length){
        showAnnStatus = false;
      }
      if(viewsTobeShown.length == updatedViews.length){
        showAnnStatus = true;
      }

      return {
        ...state,
        showAnn: showAnnStatus,
        pending: false,
        payload: updatedViews,
      };
    case type.UPDATE_VIEW_VISIBILITY_FAILURE:
      return {
        ...state,
        pending: false,
        error: action.error,
      };
    case type.GET_TRB_MODEL_REQUEST:
      return {
        ...state,
        pending: false,
      };
    case type.GET_TRB_MODEL_SUCCESS:
      return {
        ...state,
        pending: false,
        trbModels: action.payload,
      };
    case type.GET_ANN_ID_REQUEST:
      return {
        ...state,
        pending: true,
      };
    case type.GET_ANN_ID_SUCCESS:
      return {
        ...state,
        pending: false,
        annIds: [...state.annIds, action.payload],
      };
    case type.SHOW_ANN_REQUEST:
      return {
        ...state,
        pending: true,
      };
    case type.SHOW_ANN_SUCCESS:
      console.log("From reducer", action.payload);
      const updatedPayload = state.payload.map((view) => {
        return {
          ...view,
          show: !action.payload,
        };
      });
      return {
        ...state,
        showAnn: !action.payload,
        payload: updatedPayload,
        pending: false,
      };
    default:
      return { ...state };
  }
};
export default reducers;
