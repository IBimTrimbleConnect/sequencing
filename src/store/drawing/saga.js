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
  GetDrawingSuccess,
  UpdateViewVisibilitySuccess,
  GetTrbModelSuccess,
  GetAnnIdSuccess,
  ShowAnnSuccess,
} from "./action";
import instance from "../../interceptors/axios";

function* getDrawingSaga(action) {
  const getCommentUrl = `/comments?objectId=${action.payload.id}&objectType=FOLDER`;
  const commentResponse = yield call(instance.get, getCommentUrl);
  console.log(commentResponse);
  const comments = commentResponse.data.map((x) => {
    const comment = JSON.parse(x.description);
    return comment;
  });
  const grouped = comments.reduce((acc, comment) => {
    const key = comment.name;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(comment);
    acc[key].sort((a, b) => a.index - b.index);
    return acc;
  }, {});
  const views = Object.values(grouped).map((group) => {
    const bs = group.map((item) => item.comment);
    console.log(bs.join(""))
    const viewObjs = JSON.parse(bs.join(""));
    return {
      show: false,
      key: viewObjs.name,
      ...viewObjs,
    };
  });

  yield put(
    GetDrawingSuccess({
      views: views,
    }),
  );
}

function* getAnnIdSaga(action) {
  const getCommentUrl = `https://model-api32.connect.trimble.com/models/${action.payload.modelId}/entities?offset=0&include=psets&fields=psets`;
  const response = yield call(instance.get, getCommentUrl);
  const annIds = response.data.items.map((x) => {
    if (x.psets.length > 0) {
      const id = x.id;
      const annValue = Number(x.psets[0].values[0]);
      return { id: id, annId: annValue };
    } else {
      return { id: x.id, annId: -1 };
    }
  });
  console.log(annIds);
  yield put(
    GetAnnIdSuccess({
      name: action.payload.name,
      modelId: action.payload.modelId,
      annIds: annIds,
    }),
  );
}

function* updateViewVisibilitySaga(action) {
  yield put(
    UpdateViewVisibilitySuccess({
      ...action.payload,
    }),
  );
}
function* getTrbModelSaga(action) {
  yield put(GetTrbModelSuccess(action.payload));
}
function* showAnnSaga(action) {
  console.log(action.payload);
  yield put(ShowAnnSuccess(action.payload));
}

function* drawingSaga() {
  yield takeEvery("GET_DRAWING_REQUEST", getDrawingSaga);
  yield takeEvery("UPDATE_VIEW_VISIBILITY_REQUEST", updateViewVisibilitySaga);
  yield takeEvery("GET_TRB_MODEL_REQUEST", getTrbModelSaga);
  yield takeEvery("GET_ANN_ID_REQUEST", getAnnIdSaga);
  yield takeEvery("SHOW_ANN_REQUEST", showAnnSaga);
}
export default drawingSaga;
