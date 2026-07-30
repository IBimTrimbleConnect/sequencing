import { Layout, Menu } from "antd";
import { DashboardOutlined, UserOutlined } from "@ant-design/icons";
import TopMenu from "./components/TopMenu";
import { GetPlanRequest } from "./store/sequence/action";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Main from "./components/Main";
import Simulation from "./components/Simulation";

const { Header, Sider, Content, Footer } = Layout;

export default function App() {
  const dispatch = useDispatch();
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  useEffect(() => {
    async function fetchStatus() {
      const tcapi = await WorkspaceAPI.connect(window.parent);
      const token = await tcapi.extension.requestPermission("accesstoken");
      window.localStorage.setItem("trimbleToken", token);
      const project = await tcapi.project.getProject();
      const location = project.location.toUpperCase();
      let apiurl = "https://app.connect.trimble.com/tc/api/2.0";
      if (location.includes("AUSTRALIA")) {
        apiurl = "https://app32.connect.trimble.com/tc/api/2.0";
      } else if (location.includes("EUROPE") || location.includes("EU")) {
        apiurl = "https://app21.connect.trimble.com/tc/api/2.0";
      } else if (location.includes("ASIA")) {
        apiurl = "https://app31.connect.trimble.com/tc/api/2.0";
      } else if (
        location.includes("UK") ||
        location.includes("UNITED") ||
        location.includes("KINGDOM")
      ) {
        apiurl = "https://app22.connect.trimble.com/tc/api/2.0";
      }
      window.localStorage.setItem("apiurl", apiurl);
      setProjectId(project.id);
      setProjectName(project.name);
      dispatch(
        GetPlanRequest({
          projectId: project.id,
          projectName: project.name,
        }),
      );
    }
    fetchStatus();
  }, []);
  return (
    <Layout
      style={{
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <TopMenu  projectName={projectName}/>

      <Content
        style={{
          flex: 1,
          overflow: "auto",
          margin: 5,
        }}
      >
        <Main />
      </Content>

      <Footer
        style={{
          padding: "8px 16px",
          background: "#fff",
          borderTop: "1px solid #f0f0f0",
          flexShrink: 0,
        }}
      >
        <Simulation />
      </Footer>
    </Layout>
  );
}
