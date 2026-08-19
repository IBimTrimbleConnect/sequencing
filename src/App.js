import {
  Alert,
  Layout,
  Result,
  Spin,
  Button,
  message,
  Modal,
  Form,
  Input,
} from "antd";

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
import {
  checkTrimbleUser,
  registerTrimbleTrial,
} from "./services/userService";

import {
  ShoppingCartOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

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

  const tcapiRef = useRef(null);

  const refreshingModels = useSelector(
    (state) => state.sequence?.refreshingModels === true,
  );

  const refreshModelsError = useSelector(
    (state) => state.sequence?.refreshModelsError || "",
  );

  const sequenceError = useSelector((state) => state.sequence?.error || null);

  const [projectId, setProjectId] = useState("");

  const [projectName, setProjectName] = useState("");

  const [trimbleUser, setTrimbleUser] = useState(null);

  const [loadedModels, setLoadedModels] = useState([]);

  /*
   * Tracks whether GetPlanRequest has already been dispatched
   * successfully for this App session.
   *
   * This allows "Check Again" to:
   *
   * - call GetPlanRequest the first time a model becomes available
   * - call RefreshLoadedModelsRequest on later model refreshes
   */
  const [sequencingInitialized, setSequencingInitialized] = useState(false);

  /*
   * One-shot command sent from the Plan menu to the existing
   * Simulation component.
   *
   * requestId makes repeated clicks on the same Plan trigger again.
   */
  const [simulationRequest, setSimulationRequest] = useState(null);

  const [loading, setLoading] = useState(true);

  const [registeringTrial, setRegisteringTrial] = useState(false);

  const [trialModalOpen, setTrialModalOpen] = useState(false);

  const [trialProfile, setTrialProfile] = useState(null);

  const [trialForm] = Form.useForm();

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

  /*
   * A Free user can register a Trial only when this Trimble account
   * has never consumed a Trial before.
   *
   * Expired Trial users are converted to Free at runtime, but
   * trialCount remains 1, so the button will not appear again.
   */
  const canRegisterTrial =
    isFree &&
    Number(trimbleUser?.trialCount || 0) === 0;

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
         * Check loaded 3D models ONCE.
         *
         * Do not wait for 60 seconds here.
         * If there is no loaded model, initialization finishes immediately
         * and the render below shows the "No 3D Model Loaded" warning.
         */
        setLoadingMessage("Checking loaded 3D models...");

        let currentLoadedModels = [];

        try {
          const models =
            await tcapi.viewer.getModels(
              "loaded",
            );

          currentLoadedModels =
            Array.isArray(models)
              ? models
              : [];
        } catch (modelError) {
          console.warn(
            "Unable to check loaded models:",
            modelError,
          );

          currentLoadedModels = [];
        }

        if (cancelled) {
          return;
        }

        if (!currentLoadedModels.length) {
          setLoadedModels([]);
          setSequencingInitialized(false);
          return;
        }

        setLoadedModels(currentLoadedModels);

        setLoadingMessage("Loading sequencing data...");

        const currentLoadedModelIds =
          currentLoadedModels
            .map(
              (model) =>
                model?.id ??
                model?.modelId,
            )
            .filter(
              (modelId) =>
                modelId != null &&
                modelId !== "",
            )
            .map(String);

        /*
         * Initial sequencing hydration.
         */
        dispatch(
          GetPlanRequest({
            projectId:
              currentProjectId,

            projectName:
              currentProjectName,

            currentUser:
              normalizedUser,

            userRole:
              normalizedUser.role,

            isOwner:
              normalizedUser.isOwner,

            trimbleEmail,

            loadedModelIds:
              currentLoadedModelIds,
          }),
        );

        setSequencingInitialized(true);
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
      tcapiRef.current ||
      (await WorkspaceAPI.connect(window.parent));

    tcapiRef.current =
      tcapi;

    const currentLoadedModels =
      await tcapi.viewer.getModels(
        "loaded",
      );

    if (
      !Array.isArray(
        currentLoadedModels,
      ) ||
      currentLoadedModels.length === 0
    ) {
      /*
       * Keep the App on the warning screen.
       *
       * Do not convert this condition into accessError.
       */
      setLoadedModels([]);

      return 0;
    }

    const currentLoadedModelIds =
      currentLoadedModels
        .map(
          (model) =>
            model?.id ??
            model?.modelId,
        )
        .filter(
          (modelId) =>
            modelId != null &&
            modelId !== "",
        )
        .map(String);

    setLoadedModels(
      currentLoadedModels,
    );

    /*
     * The first model may have been loaded AFTER the
     * extension was already opened.
     *
     * In that case GetPlanRequest has never run, so
     * perform the full initial hydration now.
     */
    if (
      !sequencingInitialized
    ) {
      const trimbleEmail =
        String(
          trimbleUser?.trimbleEmail ||
            trimbleUser?.email ||
            window.localStorage.getItem(
              "trimbleEmail",
            ) ||
            "",
        )
          .trim()
          .toLowerCase();

      dispatch(
        GetPlanRequest({
          projectId,

          projectName,

          currentUser:
            trimbleUser,

          userRole,

          isOwner,

          trimbleEmail,

          loadedModelIds:
            currentLoadedModelIds,
        }),
      );

      setSequencingInitialized(
        true,
      );

      return currentLoadedModels.length;
    }

    /*
     * Normal refresh after sequencing data is already loaded.
     *
     * Only hydrate object runtime/model data again.
     */
    dispatch(
      RefreshLoadedModelsRequest({
        loadedModelIds:
          currentLoadedModelIds,
      }),
    );

    return currentLoadedModels.length;
  }, [
    dispatch,
    isOwner,
    projectId,
    projectName,
    refreshingModels,
    sequencingInitialized,
    trimbleUser,
    userRole,
  ]);

  const handleOpenTrialModal = useCallback(async () => {
    if (!canRegisterTrial || registeringTrial) {
      return;
    }

    try {
      const tcapi =
        tcapiRef.current ||
        (await WorkspaceAPI.connect(window.parent));

      tcapiRef.current = tcapi;

      const profile =
        await tcapi.user.getUser();

      const trimbleEmail =
        String(profile?.email || "")
          .trim()
          .toLowerCase();

      if (!trimbleEmail) {
        throw new Error(
          "Unable to retrieve your Trimble Connect email.",
        );
      }

      const userName = [
        profile?.firstName,
        profile?.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (!userName) {
        throw new Error(
          "Unable to retrieve your name from Trimble Connect.",
        );
      }

      setTrialProfile({
        trimbleEmail,
        userName,
      });

      trialForm.setFieldsValue({
        companyName: "",
      });

      setTrialModalOpen(true);
    } catch (error) {
      console.error(
        "Open Trial registration failed:",
        error,
      );

      message.error(
        error?.message ||
          "Unable to retrieve your Trimble Connect account.",
      );
    }
  }, [
    canRegisterTrial,
    registeringTrial,
    trialForm,
  ]);

  const handleCloseTrialModal = useCallback(() => {
    if (registeringTrial) {
      return;
    }

    setTrialModalOpen(false);

    trialForm.resetFields();

    setTrialProfile(null);
  }, [
    registeringTrial,
    trialForm,
  ]);

  const handleRegisterTrial = useCallback(async () => {
    if (!trialProfile || registeringTrial) {
      return;
    }

    try {
      const values =
        await trialForm.validateFields();

      const companyName =
        String(values.companyName || "")
          .trim();

      if (!companyName) {
        return;
      }

      setRegisteringTrial(true);

      const {
        trimbleEmail,
        userName,
      } = trialProfile;

      await registerTrimbleTrial({
        trimbleEmail,
        userName,
        companyName,
        trialDays: 14,
      });

      /*
       * Re-check persisted data so the app uses
       * the exact role/license returned from trimble_users.
       */
      const accessResult =
        await checkTrimbleUser(trimbleEmail);

      if (
        !accessResult.allowed ||
        !accessResult.user
      ) {
        throw new Error(
          accessResult.reason ||
            "Unable to activate the Trial License.",
        );
      }

      const normalizedRole =
        normalizeRole(
          accessResult.user.role,
        );

      const normalizedUser = {
        ...accessResult.user,

        trimbleEmail,

        role:
          normalizedRole,

        isOwner:
          normalizedRole === "owner",

        isViewer:
          normalizedRole === "viewer",

        isFree:
          accessResult.user?.isFree === true ||
          normalizedRole === "free",
      };

      setTrimbleUser(normalizedUser);

      window.localStorage.setItem(
        "trimbleEmail",
        trimbleEmail,
      );

      window.localStorage.setItem(
        "trimbleRole",
        normalizedUser.role,
      );

      setTrialModalOpen(false);

      trialForm.resetFields();

      setTrialProfile(null);

      /*
       * Reload sequencing data/permissions under Trial.
       */
      if (
        projectId &&
        loadedModelIds.length > 0
      ) {
        dispatch(
          GetPlanRequest({
            projectId,
            projectName,

            currentUser:
              normalizedUser,

            userRole:
              normalizedUser.role,

            isOwner:
              normalizedUser.isOwner,

            trimbleEmail,

            loadedModelIds,
          }),
        );

        setSequencingInitialized(
          true,
        );
      }

      message.success(
        "Your Trial License has been activated.",
      );
    } catch (error) {
      if (error?.errorFields) {
        return;
      }

      console.error(
        "Register Trial failed:",
        error,
      );

      const errorText =
        String(error?.message || "");

      if (
        errorText.includes(
          "TRIAL_ALREADY_USED",
        )
      ) {
        message.error(
          "This Trimble Connect account has already used a Trial License.",
        );

        setTrialModalOpen(false);
      } else if (
        errorText.includes(
          "PAID_LICENSE_ALREADY_ACTIVE",
        )
      ) {
        message.info(
          "This account already has an active paid license.",
        );

        setTrialModalOpen(false);
      } else {
        message.error(
          errorText ||
            "Unable to register the Trial License.",
        );
      }
    } finally {
      setRegisteringTrial(false);
    }
  }, [
    dispatch,
    loadedModelIds,
    projectId,
    projectName,
    registeringTrial,
    trialForm,
    trialProfile,
  ]);

  const handleSimulationRequest = useCallback(
    (value) => {
      if (isFree || !value) {
        return;
      }

      const planId = value?.planId ?? value?.id ?? null;

      const subPlanId = value?.subPlanId ?? null;

      if (!planId) {
        return;
      }

      setSimulationRequest({
        planId: String(planId),

        subPlanId: subPlanId != null ? String(subPlanId) : null,

        requestId: Date.now(),
      });
    },
    [isFree],
  );

  const handleSimulationRequestApplied = useCallback(() => {
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
   * No 3D model is currently loaded.
   *
   * This is not a license/access error.
   * Keep the extension open and guide the user to
   * load a model, then re-check without reopening.
   */
  if (!modelLoaded) {
    return (
      <Layout
        style={{
          height: "100vh",
          background: "#fff",
        }}
      >
        <Result
          status="warning"
          title="No Models Loaded"
          subTitle={
            <span>
              Please load at least one model in Trimble Connect
              before using IBim Sequencing.
              <br />
              After the model has finished loading, click{" "}
              <strong>Check Again</strong>.
            </span>
          }
          extra={
            <Button
              type="primary"
              loading={
                refreshingModels
              }
              onClick={
                async () => {
                  try {
                    const count =
                      await handleRefreshModels();

                    if (
                      count > 0
                    ) {
                      message.success(
                        `${count} loaded model${
                          count === 1
                            ? ""
                            : "s"
                        } detected.`,
                      );
                    } else {
                      message.warning(
                        "No model is currently loaded. Please load a model in Trimble Connect and try again.",
                      );
                    }
                  } catch (error) {
                    console.error(
                      "Check loaded models failed:",
                      error,
                    );

                    message.error(
                      error?.message ||
                        "Unable to check loaded models.",
                    );
                  }
                }
              }
            >
              Check Again
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
          message={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
                flexWrap: "wrap",
              }}
            >
              <span>
                You are using the <strong>Free License</strong>. Some features are
                limited.
              </span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  size="small"
                  icon={<ShoppingCartOutlined />}
                  onClick={() => {
                    window.open(
                      "https://shop.ibimconsulting.com.au/tools/sequnece-planner",
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  Upgrade
                </Button>

                {canRegisterTrial && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={registeringTrial}
                    disabled={registeringTrial}
                    onClick={handleOpenTrialModal}
                  >
                    Register Trial
                  </Button>
                )}
              </div>
            </div>
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
          onSimulation={handleSimulationRequest}
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
        <Simulation
          loadedModelIds={loadedModelIds}
          simulationRequest={simulationRequest}
          onSimulationPlanApplied={handleSimulationRequestApplied}
        />
      </Footer>

      <Modal
        title="Register Trial"
        open={trialModalOpen}
        onCancel={handleCloseTrialModal}
        footer={null}
        destroyOnHidden
        closable={!registeringTrial}
        maskClosable={!registeringTrial}
        keyboard={!registeringTrial}
      >
        <Form
          form={trialForm}
          layout="vertical"
          autoComplete="off"
          onFinish={handleRegisterTrial}
        >
          <Form.Item label="Trimble Email">
            <Input
              value={trialProfile?.trimbleEmail || ""}
              disabled
            />
          </Form.Item>

          <Form.Item label="Name">
            <Input
              value={trialProfile?.userName || ""}
              disabled
            />
          </Form.Item>

          <Form.Item
            label="Company Name"
            name="companyName"
            rules={[
              {
                required: true,
                whitespace: true,
                message:
                  "Please enter your company name.",
              },
              {
                max: 255,
                message:
                  "Company Name cannot exceed 255 characters.",
              },
            ]}
          >
            <Input
              placeholder="Enter your company name"
              maxLength={255}
              allowClear
              autoFocus
              disabled={registeringTrial}
            />
          </Form.Item>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <Button
              onClick={handleCloseTrialModal}
              disabled={registeringTrial}
            >
              Cancel
            </Button>

            <Button
              type="primary"
              htmlType="submit"
              icon={<ThunderboltOutlined />}
              loading={registeringTrial}
            >
              Register Trial
            </Button>
          </div>
        </Form>
      </Modal>
    </Layout>
  );
}
