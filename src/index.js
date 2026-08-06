import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import { Provider } from "react-redux";
import "./index.css";
import store from "./store";
import RootRouter from "./RootRouter";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <Provider store={store}>
    <ConfigProvider>
      <RootRouter />
    </ConfigProvider>
  </Provider>,
);
