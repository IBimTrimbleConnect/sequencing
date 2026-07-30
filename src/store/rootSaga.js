import { all, fork } from "redux-saga/effects";
import sequenceSaga from "./sequence/saga";
function* rootSaga() {
  yield all([
    fork(sequenceSaga),
  ]);
}
export default rootSaga;
