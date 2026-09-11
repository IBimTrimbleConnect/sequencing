import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Tooltip,
} from "antd";
import {
  DownloadOutlined,
  FileSearchOutlined,
  FolderAddOutlined,
  MoreOutlined,
  SyncOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
  TableOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useDispatch, useSelector } from "react-redux";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import {
  getSimulationFrames,
  subscribeSimulationFrames,
} from "../services/simulationVideoService";

import {
  CreateMultiplePlansRequest,
  SetActiveSimulationItem,
} from "../store/sequence/action";

import CreatePlanModal from "./CreatePlanModal";
import ExportExcelModal from "./ExportExcelModal";

import {
  DEFAULT_FORMATTING,
  getDisplayLengthUnit,
  getDisplayMassUnit,
  normalizeProjectFormatting,
} from "../utils/projectFormatting";
import { buildGroups } from "./buildExcelGroups";
import {
  fillGroups,
  fillHeader,
} from "./excelTemplate";
import {
  useSequenceColumnConfig,
} from "../context/SequenceColumnConfigContext";

const DEFAULT_FILE_NAME = "Sequencing Report";

const EXCEL_PROPERTY_BATCH_SIZE = 300;

const buildExcelDataTableValues = (objectProperties) => {
  const values = {
    name: objectProperties?.name ?? "",
    entity_class: objectProperties?.class ?? "",
  };

  for (const propertySet of objectProperties?.properties || []) {
    const propertySetName = String(propertySet?.name || "").trim();
    if (!propertySetName) continue;

    for (const property of propertySet?.properties || []) {
      const propertyName = String(property?.name || "").trim();
      if (!propertyName) continue;

      values[`${propertySetName}+${propertyName}`] = property?.value ?? "";
    }
  }

  return values;
};

const getExcelObjectRuntimeId = (object) =>
  object?.runtimeId ?? object?.runtime_id ?? object?.objectRuntimeId ?? null;

const getExcelObjectModelId = (object) =>
  object?.modelId ?? object?.model_id ?? null;

const hydrateExcelDataTableValues = async (tcapi, sequenceGroups) => {
  const objectsByModel = new Map();

  for (const group of sequenceGroups || []) {
    for (const object of group?.objects || []) {
      const modelId = getExcelObjectModelId(object);
      const runtimeId = getExcelObjectRuntimeId(object);
      if (modelId == null || runtimeId == null) continue;

      const modelKey = String(modelId);
      if (!objectsByModel.has(modelKey)) {
        objectsByModel.set(modelKey, { modelId, runtimeIds: [] });
      }
      objectsByModel.get(modelKey).runtimeIds.push(runtimeId);
    }
  }

  const valuesByObject = new Map();

  for (const modelGroup of objectsByModel.values()) {
    const runtimeIds = [...new Set(modelGroup.runtimeIds)];

    for (
      let index = 0;
      index < runtimeIds.length;
      index += EXCEL_PROPERTY_BATCH_SIZE
    ) {
      const batch = runtimeIds.slice(index, index + EXCEL_PROPERTY_BATCH_SIZE);
      const properties = await tcapi.viewer.getObjectProperties(
        modelGroup.modelId,
        batch,
      );

      for (const objectProperties of properties || []) {
        if (objectProperties?.id == null) continue;
        valuesByObject.set(
          `${String(modelGroup.modelId)}:${String(objectProperties.id)}`,
          buildExcelDataTableValues(objectProperties),
        );
      }
    }
  }

  return (sequenceGroups || []).map((group) => ({
    ...group,
    objects: (group?.objects || []).map((object) => {
      const key = `${String(getExcelObjectModelId(object))}:${String(
        getExcelObjectRuntimeId(object),
      )}`;

      return {
        ...object,
        dataTableValues: {
          name: object?.name ?? object?.asmName ?? "",
          entity_class:
            object?.entityClass ?? object?.entity_class ?? object?.class ?? "",
          ...(object?.dataTableValues || {}),
          ...(valuesByObject.get(key) || {}),
        },
      };
    }),
  }));
};

const FFMPEG_CORE_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

const TopMenu = ({
  projectId: projectIdProp = "",
  projectName: projectNameProp = "",
  userRole: userRoleProp = "",
  isFree = false,
  onRefreshModels,
  refreshingModels = false,
  refreshModelsError = "",
  sequenceDataOverride = null,
  nodeMode = false,
}) => {
  const dispatch = useDispatch();

  const [compactMenu, setCompactMenu] = useState(false);

  useEffect(() => {
    const updateCompactMenu = () => {
      /*
       * The extension can become very narrow inside Trimble Connect.
       * Collapse toolbar actions into a 3-dot menu before they wrap.
       */
      setCompactMenu(window.innerWidth < 300);
    };

    updateCompactMenu();
    window.addEventListener("resize", updateCompactMenu);

    return () => {
      window.removeEventListener("resize", updateCompactMenu);
    };
  }, []);

  const [form] = Form.useForm();
  const [exportForm] = Form.useForm();

  const reduxPlans = useSelector((state) => state.sequence.plans || []);

  const plans = sequenceDataOverride?.plans || reduxPlans;

  const creatingPlans = useSelector((state) => state.sequence.pending === true);

  const reduxSequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

  const sequenceObjects = sequenceDataOverride?.sequenceObjects || reduxSequenceObjects;

  const projectIdFromRedux = useSelector(
    (state) => state.sequence.projectId || "",
  );

  const projectNameFromRedux = useSelector(
    (state) => state.sequence.projectName || "",
  );

  /*
   * Adjust these fallback paths to match your Redux structure.
   * Passing userRole directly to TopMenu has the highest priority.
   */
  const userRoleFromRedux = useSelector(
    (state) =>
      state.auth?.user?.role ||
      state.auth?.profile?.role ||
      state.user?.currentUser?.role ||
      state.sequence?.userRole ||
      "",
  );

  const projectId = projectIdProp || projectIdFromRedux || "";

  const projectName = projectNameProp || projectNameFromRedux || "";

  const userRole = userRoleProp || userRoleFromRedux || "";

  const isOwner = String(userRole).trim().toLowerCase() === "owner";

  const [isModalOpen, setIsModalOpen] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);

  const [exporting, setExporting] = useState(false);


  const [
    columnConfigOpen,
    setColumnConfigOpen,
  ] = useState(false);

  const {
    columnSets,
    selectedPresetName,
    loadingColumns,
    columnsError,
    setSelectedPresetName,
    refreshColumns,
    reloadPsetValues,
    selectedFields,
    psetApiUrl,
  } =
    useSequenceColumnConfig();

  const hasPsetColumns =
    Array.isArray(selectedFields) &&
    selectedFields.some((field) =>
      /(?:^|\+)prop_[a-z0-9_]+$/i.test(
        String(field || "").trim(),
      ),
    );

  const columnSetOptions =
    React.useMemo(
      () =>
        (
          Array.isArray(
            columnSets,
          )
            ? columnSets
            : []
        ).map(
          (columnSet) => ({
            label:
              columnSet.name,

            value:
              columnSet.name,
          }),
        ),
      [
        columnSets,
      ],
    );

  /*
   * Simulation video export is kept here, separate from the Simulation
   * playback engine.
   */
  const ffmpegRef = useRef(null);

  const [simulationFrameCount, setSimulationFrameCount] = useState(0);

  const [exportingVideo, setExportingVideo] = useState(false);

  const [videoExportProgress, setVideoExportProgress] = useState(0);

  useEffect(() => {
    return subscribeSimulationFrames((count) => {
      setSimulationFrameCount(count);
    });
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      if (nodeMode && sequenceDataOverride?.publishState?.publishing) {
        message.warning("Please wait for the current publish to finish.");
        return;
      }

      if (!isOwner) {
        message.error(
          `Only the project owner can create ${nodeMode ? "Categories" : "Plans"}.`,
        );

        return;
      }

      if (!projectId) {
        message.error("Unable to retrieve the current Trimble project ID.");

        return;
      }

      const values = await form.validateFields();

      const baseName = String(values.planName || "").trim();

      const createMultiple = nodeMode
        ? values.createMultiple === true
        : true;

      const startIndex = Number(values.startIndex);

      const quantity = createMultiple ? Number(values.quantity) : 1;

      if (!baseName) {
        message.warning(
          `Please enter the ${nodeMode ? "Category" : "Plan"} name.`,
        );

        return;
      }

      if (createMultiple && (!Number.isInteger(startIndex) || startIndex < 0)) {
        message.warning(
          "Start index must be a whole number greater than or equal to 0.",
        );

        return;
      }

      if (
        createMultiple &&
        (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      ) {
        message.warning("Quantity must be between 1 and 100.");

        return;
      }

      const existingPlanNames = new Set(
        plans.map((plan) =>
          String(plan?.name || "")
            .trim()
            .toLowerCase(),
        ),
      );

      const newPlans = createMultiple
        ? Array.from(
            { length: quantity },
            (_, index) => ({
              name: `${baseName} ${startIndex + index}`,
              color: values.color || null,
            }),
          )
        : [
            {
              name: baseName,
              color: values.color || null,
            },
          ];

      const duplicatePlans = newPlans.filter((plan) =>
        existingPlanNames.has(plan.name.trim().toLowerCase()),
      );

      if (duplicatePlans.length) {
        message.error(
          `The following ${nodeMode ? "Category" : "Plan"} names already exist: ${duplicatePlans
            .map((plan) => plan.name)
            .join(", ")}`,
        );

        return;
      }

      /*
       * Node mode: Plan ở cấp root chính là Node root.
       * Không ghi vào bảng `plans`; ghi trực tiếp vào `nodes`.
       *
       * Legacy mode: giữ nguyên flow V1 và dispatch Redux như trước.
       */
      if (nodeMode) {
        if (typeof sequenceDataOverride?.createRootNodesInDraft !== "function") {
          throw new Error("The draft editor is not ready yet.");
        }

        await sequenceDataOverride.createRootNodesInDraft(
          newPlans.map((plan) => ({
            name: plan.name,
            color: plan.color,
            parentId: null,
          })),
        );

        message.success(
          `${newPlans.length} ${newPlans.length === 1 ? "Category" : "Categories"} added to the draft. Publish to save changes.`,
        );
      } else {
        dispatch(
          CreateMultiplePlansRequest({
            projectId,
            plans: newPlans,
          }),
        );
      }

      form.resetFields();

      form.setFieldsValue({
        planName: baseName,

        createMultiple,

        startIndex: createMultiple ? startIndex + quantity : plans.length + 1,

        quantity: 1,
      });

      setIsModalOpen(false);
    } catch (error) {
      if (!error?.errorFields) {
        console.error("Failed to create root nodes/plans:", error);

        message.error(
          error?.message ||
            `Unable to create the ${nodeMode ? "Categories" : "Plans"}.`,
        );
      }
    }
  }, [dispatch, form, isOwner, plans, projectId, nodeMode, sequenceDataOverride, message]);

  const handleCancel = useCallback(() => {
    form.resetFields();

    form.setFieldsValue({
      planName: "Phase",
      createMultiple: nodeMode ? false : true,
      startIndex: plans.length + 1,
      quantity: 1,
    });

    setIsModalOpen(false);
  }, [form, plans.length, nodeMode]);

  const handleOpenCreateModal = useCallback(() => {
    form.resetFields();

    form.setFieldsValue({
      planName: "Phase",
      createMultiple: nodeMode ? false : true,
      startIndex: plans.length + 1,
      quantity: 1,
    });

    setIsModalOpen(true);
  }, [form, plans.length, nodeMode]);

  const handleHighlight = useCallback(async () => {
    try {
      const tcapi = await WorkspaceAPI.connect(window.parent);

      const selections = await tcapi.viewer.getSelection();

      if (!Array.isArray(selections) || selections.length === 0) {
        message.warning("Please select an object in Trimble Connect.");

        return;
      }

      const firstSelection = selections[0];

      const modelId = firstSelection?.modelId;

      const runtimeId = firstSelection?.objectRuntimeIds?.[0];

      if (modelId == null || runtimeId == null) {
        message.warning("Please select a valid object in Trimble Connect.");

        return;
      }

      /*
       * sequenceObjects:
       *
       * [
       *   {
       *     planId,
       *     subPlanId,
       *     objects: [...]
       *   }
       * ]
       */
      let found = null;

      for (const group of sequenceObjects) {
        const object = (group?.objects || []).find(
          (item) =>
            String(item?.modelId) === String(modelId) &&
            String(item?.runtimeId) === String(runtimeId),
        );

        if (object) {
          found = {
            ...object,

            planId: object?.planId ?? group?.planId,

            subPlanId: object?.subPlanId ?? group?.subPlanId,
          };

          break;
        }
      }

      if (!found) {
        message.warning("The selected object was not found in sequencing.");

        return;
      }

      const externalId = found?.externalId ?? found?.external_id ?? null;

      dispatch(
        SetActiveSimulationItem({
          planId: String(found.planId),

          subPlanId: String(found.subPlanId),

          modelId: found.modelId,

          runtimeId: found.runtimeId,

          /*
           * Stable identity in Redux.
           */
          id: externalId != null ? String(externalId) : String(found.runtimeId),

          objectId: externalId,
        }),
      );
    } catch (error) {
      console.error("Highlight object error:", error);

      message.error(
        error?.message || "Unable to highlight the selected object.",
      );
    }
  }, [dispatch, sequenceObjects]);

  const handleOpenExportModal = useCallback(() => {
    if (isFree) {
      message.warning(
        "Excel export is not available with the Free License.",
      );

      return;
    }

    exportForm.resetFields();

    exportForm.setFieldsValue({
      fileName: DEFAULT_FILE_NAME,
      startDate: null,
      endDate: null,
      planIds: plans.map((plan) => String(plan.id)),
      columnSetName:
        selectedPresetName ||
        (Array.isArray(columnSets) ? columnSets[0]?.name : null) ||
        null,
    });

    setExportModalOpen(true);
  }, [exportForm, plans, isFree, selectedPresetName, columnSets]);

  const handleCloseExportModal = useCallback(() => {
    if (exporting) {
      return;
    }

    exportForm.resetFields();
    setExportModalOpen(false);
  }, [exportForm, exporting]);

  const exportWorkbook = useCallback(
    async ({
      fileNameInput,
      selectedPlanIds,
      startDateValue,
      endDateValue,
      selectedColumnSet,
    }) => {
      if (isFree) {
        message.warning(
          "Excel export is not available with the Free License.",
        );

        return;
      }

      setExporting(true);

      try {
        const tcapi = await WorkspaceAPI.connect(window.parent);

        const projectSettings = await tcapi.project.getSettings();

        const formatting = normalizeProjectFormatting(
          projectSettings?.formatting || DEFAULT_FORMATTING,
        );

        const hydratedSequenceObjects = await hydrateExcelDataTableValues(
          tcapi,
          sequenceObjects,
        );

        const groups = buildGroups({
          plans,
          sequenceObjects: hydratedSequenceObjects,
          selectedPlanIds,
          startDateValue,
          endDateValue,
          formatting,
          selectedColumns: selectedColumnSet?.columns || [],
        });

        if (!groups.length) {
          message.warning("No data matches the selected conditions.");
          return;
        }

        const workbook = new ExcelJS.Workbook();

        const response = await fetch(
          `${process.env.PUBLIC_URL}/Erection_Template.xlsx`,
        );

        if (!response.ok) {
          throw new Error(
            `Unable to download Excel template: ${response.status}`,
          );
        }

        const templateBuffer = await response.arrayBuffer();

        await workbook.xlsx.load(templateBuffer);

        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
          throw new Error("No worksheet was found in the Excel template.");
        }

        const lengthUnit = getDisplayLengthUnit(formatting);

        const weightUnit = getDisplayMassUnit(formatting);

        fillHeader(worksheet, {
          ProjectName: projectName,
          ReportDate: dayjs().format("DD-MM-YYYY"),
          StartDate: startDateValue
            ? dayjs(startDateValue).format("DD-MM-YYYY")
            : "",
          EndDate: endDateValue ? dayjs(endDateValue).format("DD-MM-YYYY") : "",
          LengthTitle: `Length (${lengthUnit})`,
          WeightTitle: `Weight (${weightUnit})`,
          CogTitle: `COG (${lengthUnit})`,
          CogXTitle: `COG X (${lengthUnit})`,
          CogYTitle: `COG Y (${lengthUnit})`,
          CogZTitle: `COG Z (${lengthUnit})`,
        });

        fillGroups(worksheet, groups, selectedColumnSet?.columns || []);

        const buffer = await workbook.xlsx.writeBuffer();

        const safeFileName = String(fileNameInput || DEFAULT_FILE_NAME)
          .trim()
          .replace(/[<>:"/\\|?*]/g, "_");

        saveAs(
          new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          `${safeFileName}.xlsx`,
        );

        message.success("Excel exported successfully.");

        exportForm.resetFields();
        setExportModalOpen(false);
      } catch (error) {
        console.error("Export Excel error:", error);

        message.error(error?.message || "Unable to export Excel.");
      } finally {
        setExporting(false);
      }
    },
    [exportForm, isFree, plans, projectName, sequenceObjects],
  );

  const handleConfirmExport = useCallback(async () => {
    try {
      const values = await exportForm.validateFields();

      const selectedColumnSet = (columnSets || []).find(
        (columnSet) => columnSet?.name === values.columnSetName,
      );

      if (!selectedColumnSet) {
        message.error("Unable to retrieve the selected DataTable ColumnSet.");
        return;
      }

      if (!Array.isArray(selectedColumnSet.columns) || !selectedColumnSet.columns.length) {
        message.warning("The selected DataTable ColumnSet contains no columns.");
        return;
      }

      console.log("[ExcelExport] Selected ColumnSet", {
        name: selectedColumnSet.name,
        fields: selectedColumnSet.columns.map((column) => column?.field),
      });

      await exportWorkbook({
        fileNameInput: values.fileName?.trim() || DEFAULT_FILE_NAME,
        selectedPlanIds: values.planIds || [],
        startDateValue: values.startDate || null,
        endDateValue: values.endDate || null,
        selectedColumnSet,
      });
    } catch (error) {
      if (!error?.errorFields) {
        console.error("Validate export form error:", error);
      }
    }
  }, [exportForm, exportWorkbook, columnSets]);

  const getFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message: logMessage }) => {
      console.log("FFmpeg:", logMessage);
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(
        `${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`,
        "text/javascript",
      ),

      wasmURL: await toBlobURL(
        `${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`,
        "application/wasm",
      ),
    });

    ffmpegRef.current = ffmpeg;

    return ffmpeg;
  }, []);

  useEffect(() => {
    return () => {
      const ffmpeg = ffmpegRef.current;

      if (!ffmpeg) {
        return;
      }

      try {
        ffmpeg.terminate();
      } catch (error) {
        console.error("Terminate FFmpeg failed:", error);
      }

      ffmpegRef.current = null;
    };
  }, []);

  const handleExportSimulationMp4 = useCallback(async () => {
    if (exportingVideo) {
      return;
    }

    /*
     * Keep the same license behavior as the other export operation.
     * The button remains visible but disabled for Free.
     */
    if (isFree) {
      message.warning(
        "MP4 export is not available with the Free License.",
      );

      return;
    }

    const frames = getSimulationFrames();

    if (!frames.length) {
      message.warning(
        "Run the simulation first to capture video frames.",
      );

      return;
    }

    setExportingVideo(true);
    setVideoExportProgress(0);

    const temporaryFiles = [];

    try {
      const ffmpeg = await getFFmpeg();

      const exportId = Date.now();

      const frameNames = [];

      /*
       * Write all captured snapshots to FFmpeg's virtual file system.
       */
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];

        const frameName =
          `simulation_${exportId}_frame_${String(index).padStart(6, "0")}.png`;

        await ffmpeg.writeFile(
          frameName,
          await fetchFile(frame.snapshot),
        );

        frameNames.push(frameName);
        temporaryFiles.push(frameName);

        setVideoExportProgress(
          Math.round(((index + 1) / frames.length) * 70),
        );
      }

      /*
       * Use the actual delay captured for every simulation frame.
       */
      const concatLines = [];

      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];

        const durationSeconds =
          Math.max(50, Number(frame.duration) || 200) / 1000;

        concatLines.push(`file '${frameNames[index]}'`);

        concatLines.push(
          `duration ${durationSeconds.toFixed(6)}`,
        );
      }

      /*
       * Repeat the final frame because FFmpeg's concat demuxer otherwise
       * ignores the duration line belonging to the last image.
       */
      concatLines.push(
        `file '${frameNames[frameNames.length - 1]}'`,
      );

      const concatFileName =
        `simulation_${exportId}_frames.txt`;

      await ffmpeg.writeFile(
        concatFileName,
        new TextEncoder().encode(concatLines.join("\n")),
      );

      temporaryFiles.push(concatFileName);

      const outputName =
        `SequencePlanner_Simulation_${exportId}.mp4`;

      temporaryFiles.push(outputName);

      setVideoExportProgress(75);

      /*
       * Prefer H.264. Fall back to MPEG-4 if this particular FFmpeg core
       * does not include libx264.
       */
      try {
        await ffmpeg.exec([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatFileName,
          "-vsync",
          "vfr",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outputName,
        ]);
      } catch (h264Error) {
        console.warn(
          "H.264 encode failed. Falling back to MPEG-4:",
          h264Error,
        );

        await ffmpeg.exec([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatFileName,
          "-vsync",
          "vfr",
          "-c:v",
          "mpeg4",
          "-q:v",
          "3",
          "-pix_fmt",
          "yuv420p",
          outputName,
        ]);
      }

      setVideoExportProgress(95);

      const videoData = await ffmpeg.readFile(outputName);

      /*
       * Copy the Uint8Array into a fresh ArrayBuffer for Blob compatibility
       * across browsers.
       */
      const videoBytes = new Uint8Array(videoData);

      const videoBlob = new Blob(
        [videoBytes],
        {
          type: "video/mp4",
        },
      );

      const videoUrl = URL.createObjectURL(videoBlob);

      const anchor = document.createElement("a");

      anchor.href = videoUrl;
      anchor.download = outputName;

      document.body.appendChild(anchor);

      anchor.click();

      anchor.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(videoUrl);
      }, 1000);

      setVideoExportProgress(100);

      message.success("MP4 exported successfully.");
    } catch (error) {
      console.error("Export simulation MP4 failed:", error);

      message.error(
        error?.message || "Unable to export the simulation MP4.",
      );
    } finally {
      /*
       * Clean FFmpeg's in-memory filesystem where possible.
       */
      const ffmpeg = ffmpegRef.current;

      if (ffmpeg) {
        for (const fileName of temporaryFiles) {
          try {
            await ffmpeg.deleteFile(fileName);
          } catch {
            // Ignore cleanup errors.
          }
        }
      }

      setExportingVideo(false);
    }
  }, [
    exportingVideo,
    getFFmpeg,
    isFree,
  ]);

  const handleRefreshModels = useCallback(async () => {
    if (typeof onRefreshModels !== "function") {
      return;
    }

    try {
      const loadedModelCount = await onRefreshModels();

      if (Number.isFinite(Number(loadedModelCount))) {
        message.success(
          `${loadedModelCount} loaded model(s) found. Runtime objects are refreshing.`,
        );
      }
    } catch (error) {
      console.error("Refresh loaded models failed:", error);

      message.error(error?.message || "Unable to refresh loaded models.");
    }
  }, [onRefreshModels]);

  const compactMenuItems = [
    {
      key: "refresh-models",
      icon: <SyncOutlined />,
      label: "Load Models",
      disabled:
        refreshingModels ||
        typeof onRefreshModels !== "function",
      onClick: handleRefreshModels,
    },
    {
      key: "reload-pset",
      icon: <ReloadOutlined />,
      label: "Reload PSet",
      disabled:
        !hasPsetColumns ||
        !psetApiUrl,
      onClick: reloadPsetValues,
    },
    {
      key: "create-plans",
      icon: <FolderAddOutlined />,
      label: nodeMode ? "Create multiple categories" : "Create multiple plans",
      disabled:
        !isOwner ||
        Boolean(nodeMode && sequenceDataOverride?.publishState?.publishing),
      onClick: handleOpenCreateModal,
    },
    {
      key: "export-excel",
      icon: <DownloadOutlined />,
      label: "Export to Excel",
      disabled: isFree,
      onClick: handleOpenExportModal,
    },
    {
      key: "export-mp4",
      icon: <VideoCameraOutlined />,
      label: exportingVideo
        ? `Exporting MP4 ${videoExportProgress}%`
        : "Export MP4",
      disabled:
        isFree ||
        exportingVideo ||
        simulationFrameCount === 0,
      onClick: handleExportSimulationMp4,
    },
    {
      key: "datatable-preset",
      icon: <TableOutlined />,
      label: "DataTable preset",
      onClick: () => setColumnConfigOpen(true),
    },
    {
      key: "highlight",
      icon: <FileSearchOutlined />,
      label: "Highlight selected object",
      onClick: handleHighlight,
    },
  ];

  return (
    <>
      {isOwner && (
        <CreatePlanModal
          open={isModalOpen}
          form={form}
          loading={creatingPlans}
          entityLabel={nodeMode ? "Category" : "Plan"}
          entityPluralLabel={nodeMode ? "Categories" : "Plans"}
          allowSingle={nodeMode}
          onCreate={handleCreate}
          onCancel={handleCancel}
        />
      )}

      <ExportExcelModal
        open={exportModalOpen}
        exporting={exporting}
        form={exportForm}
        plans={plans}
        columnSets={columnSets}
        onCancel={handleCloseExportModal}
        onConfirm={handleConfirmExport}
      />

      <Modal
        title="Sequence Object DataTable Preset"
        open={
          columnConfigOpen
        }
        onCancel={() =>
          setColumnConfigOpen(
            false,
          )
        }
        footer={[
          <Button
            key="refresh"
            loading={
              loadingColumns
            }
            onClick={
              refreshColumns
            }
          >
            Refresh Presets
          </Button>,

          <Button
            key="done"
            type="primary"
            onClick={() =>
              setColumnConfigOpen(
                false,
              )
            }
          >
            Done
          </Button>,
        ]}
        width={
          420
        }
        destroyOnHidden
      >
        <div
          style={{
            marginBottom:
              12,

            color:
              "#666",

            fontSize:
              12,

            lineHeight:
              1.5,
          }}
        >
          Select one saved Trimble Connect DataTable preset.
          The selected preset is applied to all Sequence Object tables.
        </div>

        {columnsError && (
          <div
            style={{
              marginBottom:
                12,

              padding:
                "8px 10px",

              border:
                "1px solid #ffccc7",

              borderRadius:
                6,

              background:
                "#fff2f0",

              color:
                "#cf1322",

              fontSize:
                12,
            }}
          >
            {
              columnsError
            }
          </div>
        )}

        <div
          style={{
            marginBottom:
              12,
          }}
        >
          <div
            style={{
              marginBottom:
                6,

              fontWeight:
                600,
            }}
          >
            DataTable Preset
          </div>

          <Select
            value={
              selectedPresetName ||
              undefined
            }
            options={
              columnSetOptions
            }
            placeholder="Select saved DataTable preset"
            showSearch
            allowClear
            optionFilterProp="label"
            loading={
              loadingColumns
            }
            style={{
              width:
                "100%",
            }}
            onChange={(
              value,
            ) =>
              setSelectedPresetName(
                value ||
                  "",
              )
            }
          />
        </div>

        <div
          style={{
            marginTop:
              10,

            color:
              "#8c8c8c",

            fontSize:
              11,

            lineHeight:
              1.5,
          }}
        >
          Create or update presets in Trimble Connect DataTable using
          <strong> Save as config</strong>, then click
          <strong> Refresh Presets</strong>.
        </div>
      </Modal>

      <Flex
        vertical
        gap={8}
        style={{
          padding: "0 16px",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 24,
          }}
        >
          Sequencing
        </h1>

        <Flex justify="flex-end">
          {compactMenu ? (
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: compactMenuItems,
              }}
            >
              <Button
                size="large"
                type="text"
                aria-label="More actions"
                icon={
                  <MoreOutlined
                    style={{
                      fontSize: 24,
                    }}
                  />
                }
              />
            </Dropdown>
          ) : (
            <Space size={4}>
              <Tooltip title={refreshModelsError || "Load / refresh models"}>
                <Button
                  size="large"
                  type="text"
                  loading={refreshingModels}
                  disabled={
                    refreshingModels ||
                    typeof onRefreshModels !== "function"
                  }
                  icon={
                    !refreshingModels ? (
                      <SyncOutlined
                        style={{
                          fontSize: 22,
                        }}
                      />
                    ) : null
                  }
                  onClick={handleRefreshModels}
                />
              </Tooltip>

              <Tooltip title="Reload Property Set values">
                <Button
                  size="large"
                  type="text"
                  disabled={!hasPsetColumns || !psetApiUrl}
                  icon={
                    <ReloadOutlined
                      style={{
                        fontSize: 22,
                      }}
                    />
                  }
                  onClick={reloadPsetValues}
                />
              </Tooltip>

              <Tooltip
                title={
                  nodeMode
                    ? "Create multiple categories"
                    : "Create multiple plans"
                }
              >
                <Button
                  size="large"
                  type="text"
                  disabled={
                    !isOwner ||
                    Boolean(
                      nodeMode && sequenceDataOverride?.publishState?.publishing,
                    )
                  }
                  icon={
                    <FolderAddOutlined
                      style={{
                        fontSize: 22,
                      }}
                    />
                  }
                  onClick={handleOpenCreateModal}
                />
              </Tooltip>

              <Tooltip
                title={
                  isFree
                    ? "Excel export is not available with the Free License."
                    : "Export to Excel"
                }
              >
                <Button
                  size="large"
                  type="text"
                  disabled={isFree}
                  icon={
                    <DownloadOutlined
                      style={{
                        fontSize: 22,
                      }}
                    />
                  }
                  onClick={handleOpenExportModal}
                />
              </Tooltip>

              <Tooltip
                title={
                  isFree
                    ? "MP4 export is not available with the Free License."
                    : exportingVideo
                      ? `Exporting MP4 ${videoExportProgress}%`
                      : simulationFrameCount === 0
                        ? "Run the simulation first to capture video frames."
                        : `Export MP4 (${simulationFrameCount} frames)`
                }
              >
                <Button
                  size="large"
                  type="text"
                  loading={exportingVideo}
                  disabled={
                    isFree ||
                    exportingVideo ||
                    simulationFrameCount === 0
                  }
                  icon={
                    !exportingVideo ? (
                      <VideoCameraOutlined
                        style={{
                          fontSize: 22,
                        }}
                      />
                    ) : null
                  }
                  onClick={handleExportSimulationMp4}
                />
              </Tooltip>

              <Tooltip title="Select Sequence Object DataTable preset">
                <Button
                  size="large"
                  type="text"
                  icon={
                    <TableOutlined
                      style={{
                        fontSize: 22,
                      }}
                    />
                  }
                  onClick={() => setColumnConfigOpen(true)}
                />
              </Tooltip>

              <Tooltip title="Highlight row from selected object">
                <Button
                  size="large"
                  type="text"
                  icon={
                    <FileSearchOutlined
                      style={{
                        fontSize: 22,
                      }}
                    />
                  }
                  onClick={handleHighlight}
                />
              </Tooltip>
            </Space>
          )}
        </Flex>
      </Flex>
    </>
  );
};

export default React.memo(TopMenu);
