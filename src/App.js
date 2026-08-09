import { Alert, Layout, Result, Spin, Button } from "antd";

import TopMenu from "./components/TopMenu";
import {
  GetPlanRequest,
  RefreshLoadedModelsRequest,
} from "./store/sequence/action";
import * as WorkspaceAPI from "trimble-connect-workspace-api";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dayjs from "dayjs";

import { useDispatch, useSelector } from "react-redux";

import Main from "./components/Main";
import Simulation from "./components/Simulation";
import { checkTrimbleUser } from "./services/userService";

import { ShoppingCartOutlined } from "@ant-design/icons";

const { Content, Footer } = Layout;

const MODEL_CHECK_INTERVAL_MS = 500;
const MODEL_LOAD_TIMEOUT_MS = 60000;

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

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * Wait until at least one model has been loaded
 * into the current Trimble Connect viewer.
 */
async function waitForLoadedModels(
  tcapi,
  {
    timeout = MODEL_LOAD_TIMEOUT_MS,

    interval = MODEL_CHECK_INTERVAL_MS,

    isCancelled = () => false,
  } = {},
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (isCancelled()) {
      return [];
    }

    try {
      const loadedModels = await tcapi.viewer.getModels("loaded");

      if (Array.isArray(loadedModels) && loadedModels.length > 0) {
        return loadedModels;
      }
    } catch (error) {
      console.warn("Unable to check loaded models:", error);
    }

    await sleep(interval);
  }

  return [];
}

export default function App() {
  const dispatch = useDispatch();

  const tcapiRef = useRef(null);

  const refreshingModels = useSelector(
    (state) => state.sequence?.refreshingModels === true,
  );

  const refreshModelsError = useSelector(
    (state) => state.sequence?.refreshModelsError || "",
  );

  const sequenceError = useSelector(
    (state) => state.sequence?.error || null,
  );

  const [projectId, setProjectId] = useState("");

  const [projectName, setProjectName] = useState("");

  const [trimbleUser, setTrimbleUser] = useState(null);

  const [loadedModels, setLoadedModels] = useState([]);

  /*
   * One-shot command sent from the Plan menu to the existing
   * Simulation component.
   *
   * requestId makes repeated clicks on the same Plan trigger again.
   */
  const [
    simulationRequest,
    setSimulationRequest,
  ] = useState(null);

  const [loading, setLoading] = useState(true);

  const [loadingMessage, setLoadingMessage] = useState(
    "Checking access rights...",
  );

  const [accessError, setAccessError] = useState("");

  const userRole = useMemo(
    () => normalizeRole(trimbleUser?.role),
    [trimbleUser?.role],
  );

  const isOwner = userRole === "owner";

  const isViewer = userRole === "viewer";

  const isFree = trimbleUser?.isFree === true || userRole === "free";

  const isTrial =
    String(trimbleUser?.licenseType || "")
      .trim()
      .toLowerCase() === "trial";

  const trialDaysRemaining = useMemo(() => {
    if (!isTrial || !trimbleUser?.endDate) {
      return null;
    }

    const today = dayjs().startOf("day");

    const endDate = dayjs(trimbleUser.endDate).startOf("day");

    if (!endDate.isValid()) {
      return null;
    }

    return Math.max(0, endDate.diff(today, "day") + 1);
  }, [isTrial, trimbleUser?.endDate]);

  const modelLoaded = loadedModels.length > 0;

  /*
   * Normalize all loaded model IDs to strings.
   * Child components use this list to hide objects
   * whose model is not currently loaded.
   */
  const loadedModelIds = useMemo(
    () =>
      loadedModels
        .map((model) => model?.id ?? model?.modelId)
        .filter((modelId) => modelId != null && modelId !== "")
        .map(String),
    [loadedModels],
  );

  useEffect(() => {
    let cancelled = false;

    async function initializeApp() {
      setLoading(true);
      setAccessError("");
      setLoadedModels([]);

      try {
        if (window.parent === window) {
          throw new Error(
            "The application must be opened inside Trimble Connect.",
          );
        }

        setLoadingMessage("Connecting to Trimble Connect...");

        const tcapi = await WorkspaceAPI.connect(window.parent);

        tcapiRef.current = tcapi;

        setLoadingMessage("Checking access rights...");

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

        const normalizedRole = normalizeRole(accessResult.user?.role);

        const normalizedUser = {
          ...accessResult.user,

          trimbleEmail,

          role: normalizedRole,

          isOwner: normalizedRole === "owner",

          isViewer: normalizedRole === "viewer",

          isFree:
            accessResult.user?.isFree === true || normalizedRole === "free",
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

        const currentProjectId = String(project.id);

        const currentProjectName = project.name || "";

        if (cancelled) {
          return;
        }

        setProjectId(currentProjectId);

        setProjectName(currentProjectName);

        /*
         * Do not load sequencing data until a model
         * is available in the viewer.
         */
        setLoadingMessage("Waiting for the model to load...");

        const currentLoadedModels = await waitForLoadedModels(tcapi, {
          isCancelled: () => cancelled,
        });

        if (cancelled) {
          return;
        }

        if (!currentLoadedModels.length) {
          throw new Error(
            "No model has been loaded. Please load a model in Trimble Connect and reopen the extension.",
          );
        }

        setLoadedModels(currentLoadedModels);

        setLoadingMessage("Loading sequencing data...");

        /*
         * Hydration in getPlansSaga now runs only after
         * at least one model has been loaded.
         */
        dispatch(
          GetPlanRequest({
            projectId: currentProjectId,

            projectName: currentProjectName,

            currentUser: normalizedUser,

            userRole: normalizedUser.role,

            isOwner: normalizedUser.isOwner,

            trimbleEmail,

            loadedModelIds: currentLoadedModels
              .map((model) => model?.id ?? model?.modelId)
              .filter((modelId) => modelId != null && modelId !== "")
              .map(String),
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

  const handleRefreshModels = useCallback(async () => {
    if (refreshingModels) {
      return 0;
    }

    const tcapi =
      tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

    tcapiRef.current = tcapi;

    const currentLoadedModels = await tcapi.viewer.getModels("loaded");

    if (
      !Array.isArray(currentLoadedModels) ||
      currentLoadedModels.length === 0
    ) {
      throw new Error("No model is currently loaded in Trimble Connect.");
    }

    const currentLoadedModelIds = currentLoadedModels
      .map((model) => model?.id ?? model?.modelId)
      .filter((modelId) => modelId != null && modelId !== "")
      .map(String);

    setLoadedModels(currentLoadedModels);

    /*
     * Only hydrate current Redux objects again.
     * Plans, SubPlans and Supabase rows are not reloaded.
     */
    dispatch(
      RefreshLoadedModelsRequest({
        loadedModelIds: currentLoadedModelIds,
      }),
    );

    return currentLoadedModels.length;
  }, [dispatch, refreshingModels]);

  const handleSimulationRequest = useCallback(
    (value) => {
      if (isFree || !value) {
        return;
      }

      const planId =
        value?.planId ??
        value?.id ??
        null;

      const subPlanId =
        value?.subPlanId ??
        null;

      if (!planId) {
        return;
      }

      setSimulationRequest({
        planId: String(planId),

        subPlanId:
          subPlanId != null
            ? String(subPlanId)
            : null,

        requestId: Date.now(),
      });
    },
    [isFree],
  );

  const handleSimulationRequestApplied =
    useCallback(() => {
      setSimulationRequest(null);
    }, []);

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
        <Spin size="small" tip={loadingMessage} />
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
          title="Unable to start"
          subTitle={accessError}
          extra={
            <Button
              type="primary"
              icon={<ShoppingCartOutlined />}
              onClick={() => {
                window.open(
                  "https://shop.ibimconsulting.com.au/tools/sequnece-planner",
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
  if (sequenceError?.code === "TRIAL_PROJECT_LIMIT") {
    return (
      <Result
        status="403"
        title="Trial Project Limit"
        subTitle={sequenceError.message}
        extra={
          <Button
            type="primary"
            icon={<ShoppingCartOutlined />}
            onClick={() => {
              window.open(
                "https://shop.ibimconsulting.com.au/tools/sequnece-planner",
                "_blank",
                "noopener,noreferrer",
              );
            }}
          >
            Purchase License
          </Button>
        }
      />
    );
  }
  /*
   * Additional render protection.
   */
  if (!modelLoaded) {
    return null;
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
        isViewer={isViewer}
        isFree={isFree}
        readOnly={!isOwner}
        onRefreshModels={handleRefreshModels}
        refreshingModels={refreshingModels}
        refreshModelsError={refreshModelsError}
      />
      {isTrial && !isFree && (
        <Alert
          type="warning"
          showIcon
          banner
          message={
            <span>
              You are using a <strong>Trial License</strong>.
              {trialDaysRemaining != null && (
                <>
                  {" "}
                  You have{" "}
                  <strong>
                    {trialDaysRemaining}{" "}
                    {trialDaysRemaining === 1 ? "day" : "days"}
                  </strong>{" "}
                  remaining.
                </>
              )}{" "}
              <a
                href="https://shop.ibimconsulting.com.au/tools/sequnece-planner"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontWeight: 600,
                }}
              >
                Purchase License
              </a>
            </span>
          }
        />
      )}
      {isFree && (
        <Alert
          type="warning"
          showIcon
          banner
          closable
          message={
            <span>
              You are using the <strong>Free License</strong>. Some features are
              limited.{" "}
              <a
                href="https://shop.ibimconsulting.com.au/tools/sequnece-planner"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontWeight: 600,
                }}
              >
                Upgrade License
              </a>
            </span>
          }
        />
      )}

      {isViewer && !isFree && !isTrial && (
        <Alert
          type="info"
          showIcon
          banner
          message={
            <span>
              You are using <strong>Viewer permissions</strong>. Editing
              features are available to project Owners only.
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
        <Main
          isOwner={isOwner}
          isViewer={isViewer}
          isFree={isFree}
          readOnly={!isOwner}
          loadedModelIds={loadedModelIds}
          onSimulation={
            handleSimulationRequest
          }
        />
      </Content>

      <Footer
        style={{
          padding: "8px 16px",
          background: "#fff",
          borderTop: "1px solid #f0f0f0",
          flexShrink: 0,
        }}
      >
        {!isFree && (
          <Simulation
            loadedModelIds={
              loadedModelIds
            }
            simulationRequest={
              simulationRequest
            }
            onSimulationPlanApplied={
              handleSimulationRequestApplied
            }
          />
        )}
      </Footer>
    </Layout>
  );
}
