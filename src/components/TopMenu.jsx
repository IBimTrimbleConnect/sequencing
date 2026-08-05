import React, { useCallback, useState } from "react";
import { Button, Flex, Form, message, Space, Tooltip } from "antd";
import {
  DownloadOutlined,
  FileSearchOutlined,
  FolderAddOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useDispatch, useSelector } from "react-redux";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

import {
  CreatePlanRequest,
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
import {
  findSequenceObjectByInternalId,
  getFirstSelectedInternalObject,
} from "./trimbleHelpers";

const DEFAULT_FILE_NAME = "Sequencing Report";

const TopMenu = ({
  projectId: projectIdProp = "",
  projectName: projectNameProp = "",
  userRole: userRoleProp = "",
  onRefreshModels,
  refreshingModels = false,
  refreshModelsError = "",
}) => {
  const dispatch = useDispatch();

  const [form] = Form.useForm();
  const [exportForm] = Form.useForm();

  const plans = useSelector((state) => state.sequence.plans || []);

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

  const planName = Form.useWatch("planName", form);

  const handleCreate = useCallback(async () => {
    try {
      if (!isOwner) {
        message.error("Only the project owner can create a plan.");
        return;
      }

      if (!projectId) {
        message.error("Unable to retrieve the current Trimble project ID.");
        return;
      }

      const values = await form.validateFields();

      dispatch(
        CreatePlanRequest({
          projectId,
          name: values.planName.trim(),
          color: values.color || null,
        }),
      );

      form.resetFields();
      setIsModalOpen(false);
    } catch (error) {
      if (!error?.errorFields) {
        console.error("Failed to create plan:", error);

        message.error(error?.message || "Unable to create the plan.");
      }
    }
  }, [dispatch, form, isOwner, projectId]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    setIsModalOpen(false);
  }, [form]);

  const handleHighlight = useCallback(async () => {
    try {
      const tcapi = await WorkspaceAPI.connect(window.parent);

      const selected = await getFirstSelectedInternalObject(tcapi);

      if (!selected) {
        message.warning("Please select a valid object in Trimble Connect.");
        return;
      }

      const found = findSequenceObjectByInternalId({
        sequenceObjects,
        modelId: selected.modelId,
        objectId: selected.objectId,
      });

      if (!found) {
        message.warning("The selected object was not found in sequencing.");
        return;
      }

      dispatch(
        SetActiveSimulationItem({
          planId: String(found.planId),
          subPlanId: String(found.subPlanId),
          modelId: found.modelId,
          id: String(found.objectId),
          objectId: found.objectId,
          runtimeId: selected.runtimeId,
        }),
      );
    } catch (error) {
      console.error("Highlight object error:", error);

      message.error("Unable to highlight the selected object.");
    }
  }, [dispatch, sequenceObjects]);

  const handleOpenExportModal = useCallback(() => {
    exportForm.resetFields();

    exportForm.setFieldsValue({
      fileName: DEFAULT_FILE_NAME,
      startDate: null,
      endDate: null,
      planIds: plans.map((plan) => String(plan.id)),
    });

    setExportModalOpen(true);
  }, [exportForm, plans]);

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
    [exportForm, plans, projectName, sequenceObjects],
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

  const handleRefreshModels = useCallback(async () => {
    if (
      typeof onRefreshModels !==
      "function"
    ) {
      return;
    }

    try {
      const loadedModelCount =
        await onRefreshModels();

      if (
        Number.isFinite(
          Number(
            loadedModelCount,
          ),
        )
      ) {
        message.success(
          `${loadedModelCount} loaded model(s) found. Runtime objects are refreshing.`,
        );
      }
    } catch (error) {
      console.error(
        "Refresh loaded models failed:",
        error,
      );

      message.error(
        error?.message ||
          "Unable to refresh loaded models.",
      );
    }
  }, [onRefreshModels]);


  return (
    <>
      {isOwner && (
        <CreatePlanModal
          open={isModalOpen}
          form={form}
          planName={planName}
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
            <Tooltip
              title={
                refreshModelsError ||
                "Refresh loaded models"
              }
            >
              <Button
                size="large"
                type="text"
                loading={
                  refreshingModels
                }
                disabled={
                  refreshingModels ||
                  typeof onRefreshModels !==
                    "function"
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
                onClick={
                  handleRefreshModels
                }
              />
            </Tooltip>

            <Tooltip title="Create new plan">
              <Button
                size="large"
                type="text"
                enabled={isOwner}
                disabled={!isOwner}
                icon={
                  <FolderAddOutlined
                    style={{
                      fontSize: 22,
                    }}
                  />
                }
                onClick={() => setIsModalOpen(true)}
              />
            </Tooltip>

            <Tooltip title="Export to Excel">
              <Button
                size="large"
                type="text"
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
