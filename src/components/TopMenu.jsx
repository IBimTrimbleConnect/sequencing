import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Flex, Form, message, Space, Tooltip } from "antd";
import {
  DownloadOutlined,
  FileSearchOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
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
import { fillGroups, fillHeader } from "./excelTemplate";

const DEFAULT_FILE_NAME = "Sequencing Report";

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
}) => {
  const dispatch = useDispatch();

  const [form] = Form.useForm();
  const [exportForm] = Form.useForm();

  const plans = useSelector((state) => state.sequence.plans || []);

  const creatingPlans = useSelector((state) => state.sequence.pending === true);

  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

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
      if (!isOwner) {
        message.error("Only the project owner can create Plans.");

        return;
      }

      if (!projectId) {
        message.error("Unable to retrieve the current Trimble project ID.");

        return;
      }

      const values = await form.validateFields();

      const baseName = String(values.planName || "").trim();

      const startIndex = Number(values.startIndex);

      const quantity = Number(values.quantity);

      if (!baseName) {
        message.warning("Please enter the Plan name.");

        return;
      }

      if (!Number.isInteger(startIndex) || startIndex < 0) {
        message.warning(
          "Start index must be a whole number greater than or equal to 0.",
        );

        return;
      }

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
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

      const newPlans = Array.from(
        {
          length: quantity,
        },
        (_, index) => ({
          name: `${baseName} ${startIndex + index}`,

          color: values.color || null,
        }),
      );

      const duplicatePlans = newPlans.filter((plan) =>
        existingPlanNames.has(plan.name.trim().toLowerCase()),
      );

      if (duplicatePlans.length) {
        message.error(
          `The following Plan names already exist: ${duplicatePlans
            .map((plan) => plan.name)
            .join(", ")}`,
        );

        return;
      }

      /*
       * Chỉ dispatch một action.
       * Saga gửi toàn bộ mảng xuống Supabase trong một insert.
       */
      dispatch(
        CreateMultiplePlansRequest({
          projectId,

          plans: newPlans,
        }),
      );

      form.resetFields();

      form.setFieldsValue({
        planName: baseName,

        startIndex: startIndex + quantity,

        quantity: 1,
      });

      setIsModalOpen(false);
    } catch (error) {
      if (!error?.errorFields) {
        console.error("Failed to create Plans:", error);

        message.error(error?.message || "Unable to create the Plans.");
      }
    }
  }, [dispatch, form, isOwner, plans, projectId]);

  const handleCancel = useCallback(() => {
    form.resetFields();

    form.setFieldsValue({
      planName: "Phase",
      startIndex: plans.length + 1,
      quantity: 1,
    });

    setIsModalOpen(false);
  }, [form, plans.length]);

  const handleOpenCreateModal = useCallback(() => {
    form.resetFields();

    form.setFieldsValue({
      planName: "Phase",
      startIndex: plans.length + 1,
      quantity: 1,
    });

    setIsModalOpen(true);
  }, [form, plans.length]);

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
    });

    setExportModalOpen(true);
  }, [exportForm, plans, isFree]);

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

        const groups = buildGroups({
          plans,
          sequenceObjects,
          selectedPlanIds,
          startDateValue,
          endDateValue,
          formatting,
        });

        if (!groups.length) {
          message.warning("No data matches the selected conditions.");
          return;
        }

        const response = await fetch(
          `${process.env.PUBLIC_URL}/Erection_Template.xlsx`,
        );

        if (!response.ok) {
          throw new Error(
            `Unable to download Excel template: ${response.status}`,
          );
        }

        const workbook = new ExcelJS.Workbook();

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

        fillGroups(worksheet, groups);

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

      await exportWorkbook({
        fileNameInput: values.fileName?.trim() || DEFAULT_FILE_NAME,
        selectedPlanIds: values.planIds || [],
        startDateValue: values.startDate || null,
        endDateValue: values.endDate || null,
      });
    } catch (error) {
      if (!error?.errorFields) {
        console.error("Validate export form error:", error);
      }
    }
  }, [exportForm, exportWorkbook]);

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

  return (
    <>
      {isOwner && (
        <CreatePlanModal
          open={isModalOpen}
          form={form}
          loading={creatingPlans}
          onCreate={handleCreate}
          onCancel={handleCancel}
        />
      )}

      <ExportExcelModal
        open={exportModalOpen}
        exporting={exporting}
        form={exportForm}
        plans={plans}
        onCancel={handleCloseExportModal}
        onConfirm={handleConfirmExport}
      />

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
          <Space size={4}>
            <Tooltip title={refreshModelsError || "Refresh loaded models"}>
              <Button
                size="large"
                type="text"
                loading={refreshingModels}
                disabled={
                  refreshingModels || typeof onRefreshModels !== "function"
                }
                icon={
                  !refreshingModels ? (
                    <ReloadOutlined
                      style={{
                        fontSize: 22,
                      }}
                    />
                  ) : null
                }
                onClick={handleRefreshModels}
              />
            </Tooltip>

            <Tooltip title="Create multiple plans">
              <Button
                size="large"
                type="text"
                disabled={!isOwner}
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
        </Flex>
      </Flex>
    </>
  );
};

export default React.memo(TopMenu);
