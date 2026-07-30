import { combineReducers } from "redux";
import sequenceReducer from "./sequence/reducer";
const rootReducer = combineReducers({
  sequence: sequenceReducer,
});
export default rootReducer;
