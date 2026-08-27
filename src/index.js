import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import { Provider } from "react-redux";
import "./index.css";
import store from "./store";
import RootRouter from "./RootRouter";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <Provider store={store}>
    <AntdApp>
      <ConfigProvider>
        <RootRouter />
      </ConfigProvider>
    </AntdApp>
  </Provider>,
);
