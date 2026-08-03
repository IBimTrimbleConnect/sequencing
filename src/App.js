import { Alert, Layout, Result, Spin, Button } from "antd";
import TopMenu from "./components/TopMenu";
import { GetPlanRequest } from "./store/sequence/action";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import React, { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import Main from "./components/Main";
import Simulation from "./components/Simulation";
import { checkTrimbleUser } from "./services/userService";
import { ShoppingCartOutlined } from "@ant-design/icons";

const { Content, Footer } = Layout;

function getTrimbleApiUrl(locationValue) {
  const location = String(locationValue || "").toUpperCase();

  if (location.includes("AUSTRALIA")) {
    return "https://app32.connect.trimble.com/tc/api/2.0";
  }

  if (location.includes("EUROPE") || location.includes("EU")) {
    return "https://app21.connect.trimble.com/tc/api/2.0";
  }

  if (location.includes("ASIA")) {
    return "https://app31.connect.trimble.com/tc/api/2.0";
  }

  if (
    location.includes("UK") ||
    location.includes("UNITED") ||
    location.includes("KINGDOM")
  ) {
    return "https://app22.connect.trimble.com/tc/api/2.0";
  }

  return "https://app.connect.trimble.com/tc/api/2.0";
}

function normalizeRole(role) {
  return String(role || "viewer")
    .trim()
    .toLowerCase();
}

export default function App() {
  const dispatch = useDispatch();

  const [projectId, setProjectId] = useState("");

  const [projectName, setProjectName] = useState("");

  const [trimbleUser, setTrimbleUser] = useState(null);

  const [loading, setLoading] = useState(true);

  const [accessError, setAccessError] = useState("");

  const userRole = useMemo(
    () => normalizeRole(trimbleUser?.role),
    [trimbleUser?.role],
  );

  const isOwner = userRole === "owner";

  const isViewer = userRole === "viewer";

  useEffect(() => {
    let cancelled = false;

    async function initializeApp() {
      setLoading(true);
      setAccessError("");

      try {
        if (window.parent === window) {
          throw new Error(
            "The application must be opened inside Trimble Connect.",
          );
        }

        const tcapi = await WorkspaceAPI.connect(window.parent);

        const token = await tcapi.extension.requestPermission("accesstoken");

        if (!token) {
          throw new Error("Failed to obtain the Trimble Connect access token.");
        }

        window.localStorage.setItem("trimbleToken", token);

        const trimbleProfile = await tcapi.user.getUser();

        const trimbleEmail = String(trimbleProfile?.email || "")
          .trim()
          .toLowerCase();

        if (!trimbleEmail) {
          throw new Error("Unable to retrieve the Trimble user email.");
        }

        const accessResult = await checkTrimbleUser(trimbleEmail);

        if (!accessResult.allowed) {
          throw new Error(accessResult.reason);
        }

        if (cancelled) {
          return;
        }

        const normalizedUser = {
          ...accessResult.user,

          trimbleEmail,

          role: normalizeRole(accessResult.user?.role),

          isOwner: normalizeRole(accessResult.user?.role) === "owner",

          isViewer: normalizeRole(accessResult.user?.role) === "viewer",
        };

        setTrimbleUser(normalizedUser);

        window.localStorage.setItem("trimbleEmail", trimbleEmail);

        window.localStorage.setItem("trimbleRole", normalizedUser.role);

        const project = await tcapi.project.getProject();

        if (!project?.id) {
          throw new Error("Failed to retrieve the current project.");
        }

        const apiUrl = getTrimbleApiUrl(project.location);

        window.localStorage.setItem("apiurl", apiUrl);

        if (cancelled) {
          return;
        }

        const currentProjectId = String(project.id);

        const currentProjectName = project.name || "";

        setProjectId(currentProjectId);

        setProjectName(currentProjectName);

        dispatch(
          GetPlanRequest({
            projectId: currentProjectId,

            projectName: currentProjectName,

            currentUser: normalizedUser,

            userRole: normalizedUser.role,

            isOwner: normalizedUser.isOwner,

            trimbleEmail,
          }),
        );
      } catch (error) {
        console.error("Initialize application failed:", error);

        if (!cancelled) {
          setAccessError(error?.message || "Unable to start the application.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initializeApp();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  if (loading) {
    return (
      <Layout
        style={{
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Spin size="small" tip="Checking access rights..." />
      </Layout>
    );
  }

  if (accessError) {
    return (
      <Layout
        style={{
          height: "100vh",
          background: "#fff",
        }}
      >
        <Result
          status="403"
          title="Access Denied"
          subTitle={accessError}
          extra={
            <Button
              type="primary"
              icon={<ShoppingCartOutlined />}
              onClick={() => {
                window.open(
                  "https://shop.ibimconsulting.com.au/tools",
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              Purchase License
            </Button>
          }
        />
      </Layout>
    );
  }

  return (
    <Layout
      style={{
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <TopMenu
        projectId={projectId}
        projectName={projectName}
        trimbleUser={trimbleUser}
        isOwner={isOwner}
        readOnly={isViewer}
      />
      {isViewer && (
        <Alert
          type="info"
          showIcon
          banner
          message={
            <span>
              You are using Viewer permissions.
              <a
                href="https://shop.ibimconsulting.com.au/tools/sequnece-planner"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: 600 }}
              >
                Purchase License
              </a>
            </span>
          }
        />
      )}
      <Content
        style={{
          flex: 1,
          overflow: "auto",
          margin: 5,
        }}
      >
        <Main isOwner={isOwner} readOnly={isViewer} />
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
