import logo from "./logo.svg";
import "./App.css";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import * as XLSX from "xlsx";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  MenuOutlined,
  DeleteFilled,
  PlusOutlined,
  MinusOutlined,
  PlayCircleOutlined,
  PlayCircleFilled,
  FileOutlined,
  CloseOutlined,
  DownOutlined,
  DownloadOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
} from "@ant-design/icons";

import { DndContext, closestCenter, rectIntersection } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dropdown,
  Layout,
  Typography,
  List,
  Card,
  Input,
  Button,
  Popconfirm,
  Splitter,
  Form,
  Modal,
  Collapse,
  Select,
  DatePicker,
  Checkbox,
} from "antd";
import dayjs from "dayjs";
import { Colorpicker, ColorPickerValue } from "antd-colorpicker";

import {
  GetSequenceRequest,
  CreateSequenceRequest,
  UpdateCommentRequest,
  DeleteFolderRequest,
  SetObjectsRequest,
  DeleteSequenceRequest,
  SelectObjectsSuccess,
  GetPlanRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeletePlanRequest,
  GetSourceSequenceRequest,
  CopySequenceRequest,
} from "./store/sequence/action";
import Simulation from "./components/Simulation";
const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { Panel } = Collapse;
const math = require("mathjs");

function App() {
  const dispatch = useDispatch();
  const sequenceState = useSelector((state) => state.sequence);
  const sequences = useSelector((state) => state.sequence.sequences);
  const sequencesToBeCopied = useSelector(
    (state) => state.sequence.sequencesToBeCopied,
  );
  const phases = useSelector((state) => state.sequence.phases);
  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects,
  );
  const selectedObjects = useSelector(
    (state) => state.sequence.selectedObjects,
  );
  const selectedGroup = useSelector((state) => state.sequence.selectedGroup);
  const rootFolderId = useSelector((state) => state.sequence.rootFolderId);
  const rootCommentId = useSelector((state) => state.sequence.rootCommentId);
  const phaseCommentId = useSelector((state) => state.sequence.phaseCommentId);
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [phaseName, setPhaseName] = useState("");
  const [phaseFolderId, setPhaseFolderId] = useState("");
  const [step, setStep] = useState("");
  const [timeStep, setTimeStep] = useState(100);
  const [colorDialog, setColorDialog] = useState(false);
  const [activeKey, setActiveKey] = useState(null);
  const [color, setColor] = useState({
    rgb: {
      r: 248,
      b: 234,
      g: 28,
    },
  });
  const [sourcePhase, setSourcePhase] = useState(null);
  const [reportDate, setReportDate] = useState();
  const [allSequenceChecked, setAllSequenceChecked] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  function exportToExcel(data, fileName = "Sequencing.xlsx") {
    const worksheet = XLSX.utils.json_to_sheet(data);

    //Date formatting for the "date" column
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    XLSX.writeFile(workbook, fileName);
  }
  const onDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const newArray = (prev) => {
        const oldIndex = prev.findIndex((x) => x.id === active.id);
        const newIndex = prev.findIndex((x) => x.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      };
      const newSequences = newArray(sequences);
      dispatch(
        UpdateCommentRequest({
          commentId: phaseCommentId,
          sequences: newSequences,
        }),
      );
    }
  };
  const onDragEndSubItem = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const newArray = (prev) => {
        const oldIndex = prev.findIndex((x) => x.id === active.id);
        const newIndex = prev.findIndex((x) => x.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      };
      const newObjects = newArray(selectedObjects);
      const newSequenceObjects = {
        folderId: selectedGroup,
        objects: newObjects,
      };
      dispatch(SetObjectsRequest(newSequenceObjects));
      dispatch(SelectObjectsSuccess(newSequenceObjects));
    }
  };
  function SortableItem({ item, icon, children, sequenceObjects }) {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: item.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      background: `rgba(${item.color.r}, ${item.color.g}, ${item.color.b}, 0.8)`,
      cursor: "context-menu",
    };

    const handleSelectItem = () => {
      const selectedObjects = sequenceObjects.filter(
        (x) => x && x.folderId === item.id,
      );

      const objects = selectedObjects?.[0]?.objects ?? [];

      setStep(item.name);
      setColor({ rgb: item.color });

      dispatch(
        SelectObjectsSuccess(
          selectedObjects[0] ?? {
            folderId: item.id,
            objects: [],
          },
        ),
      );
    };

    const contextMenuItems = [
      {
        key: "oprations",
        label: (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={async () => {
                const tcapi = await WorkspaceAPI.connect(window.parent);
                const selections = await tcapi.viewer.getSelection();

                tcapi.viewer.activateTool("pointMarkup");

                // handler stored so it can be removed later
                const onMessage = async (event) => {
                  if (event.data.event === "viewer.onMarkupChanged") {
                    window.removeEventListener("message", onMessage);
                    const start = event.data.data.data.markup.start;
                    const refPoint = [
                      Number(start.positionX),
                      Number(start.positionY),
                      Number(start.positionZ),
                    ];
                    var newAddedSequenceObjects = [];
                    tcapi.viewer.activateTool("selection");
                    for (const selection of selections) {
                      const objBoxes =
                        await tcapi.viewer.getObjectBoundingBoxes(
                          selection.modelId,
                          selection.objectRuntimeIds,
                        );
                      const items = await tcapi.viewer.getObjectProperties(
                        selection.modelId,
                        selection.objectRuntimeIds,
                      );
                      tcapi.markup.removeMarkups(undefined);

                      for (let i = 0; i < objBoxes.length; i++) {
                        const box = objBoxes[i];
                        const center = math.divide(
                          math.add(
                            [
                              1000 * box.boundingBox.min.x,
                              1000 * box.boundingBox.min.y,
                              1000 * box.boundingBox.min.z,
                            ],
                            [
                              1000 * box.boundingBox.max.x,
                              1000 * box.boundingBox.max.y,
                              1000 * box.boundingBox.max.z,
                            ],
                          ),
                          2,
                        );
                        const properties = items[i].properties;
                        let asm_pos = "";
                        let positionCode = "";
                        console.log(properties);
                        properties.every((property) => {
                          console.log(property.name);
                          if (property.name === "ASSEMBLY") {
                            const asm_properties = property.properties;
                            asm_properties.every((asm_property) => {
                              if (asm_pos !== "" && positionCode !== "")
                                return false;
                              if (asm_property.name.trim() === "ASSEMBLY_POS") {
                                asm_pos = asm_property.value.replace("(?)", "");
                              }

                              return true;
                            });
                            return false;
                          } else if (
                            property.name.trim() === "Tekla Assembly" ||
                            property.name.trim() === "PropertySet"
                          ) {
                            const asm_properties = property.properties;
                            asm_properties.every((asm_property) => {
                              if (asm_pos !== "" && positionCode !== "")
                                return false;
                              if (
                                asm_property.name.trim() ===
                                  "Assembly/Cast unit Mark" ||
                                asm_property.name.trim() === "ASSEMBLY_POS"
                              ) {
                                asm_pos = asm_property.value;
                              }
                              if (
                                asm_property.name.trim() ===
                                  "Assembly/Cast unit position code" ||
                                asm_property.name.trim() ===
                                  "ASSEMBLY_POSITION_CODE"
                              ) {
                                positionCode = asm_property.value;
                              }
                              return true;
                            });
                            return false;
                          }
                          return true;
                        });

                        const distance = math.distance(refPoint, center);

                        newAddedSequenceObjects.push({
                          modelId: selection.modelId,
                          id: box.id,
                          distance: math.round(distance),
                          center: center,
                          asmPos: asm_pos,
                          date: dayjs().format("DD-MM-YYYY"),
                          positionCode: positionCode,
                        });
                      }
                    }
                    newAddedSequenceObjects.sort((a, b) => {
                      return Number(a.distance) - Number(b.distance);
                    });
                    const existingObjects =
                      sequenceObjects.filter(
                        (x) => x && x.folderId === item.id,
                      )[0]?.objects ?? [];

                    var newObjects = [...existingObjects];
                    newObjects.push(...newAddedSequenceObjects);
                    const newSequenceObjects = {
                      folderId: item.id,
                      objects: newObjects,
                    };
                    console.log(newSequenceObjects);
                    dispatch(SetObjectsRequest(newSequenceObjects));
                    dispatch(SelectObjectsSuccess(newSequenceObjects));
                  }
                };

                window.addEventListener("message", onMessage);
              }}
            />
            {item.name !== "Grid" &&
              item.name !== "grid" &&
              item.name !== "GRID" && (
                <Button
                  type="text"
                  icon={<PlayCircleOutlined />}
                  onClick={async () => {
                    const tcapi = await WorkspaceAPI.connect(window.parent);
                    tcapi.markup.removeMarkups(undefined);
                    const delay = (ms) =>
                      new Promise((res) => setTimeout(res, ms));
                    var accumulatedObjects = [];
                    const sequences1 = sequences.filter(
                      (x) =>
                        x &&
                        (x.name === "Grid" ||
                          x.name === "GRID" ||
                          x.name === "grid" ||
                          x.name === item.name),
                    );
                    console.log(sequenceObjects);
                    for (const sequence of sequences1) {
                      const sequenceObjectsTobeShown = sequenceObjects.filter(
                        (x) => x && x.folderId === sequence.id,
                      );
                      const selectedSequence = sequences.filter(
                        (x) => x.id == sequence.id,
                      );
                      try {
                        const objects =
                          sequenceObjectsTobeShown?.[0]?.objects ?? [];
                        if (objects.length > 0) {
                          for (const object of objects) {
                            const index = accumulatedObjects.findIndex(
                              (x) => x.modelId === object.modelId,
                            );
                            if (index >= 0) {
                              accumulatedObjects[index].entityIds.push(
                                object.id,
                              );
                            } else {
                              accumulatedObjects.push({
                                modelId: object.modelId,
                                entityIds: [object.id],
                              });
                            }
                            await tcapi.viewer.isolateEntities(
                              accumulatedObjects,
                            );
                            await tcapi.viewer.setObjectState(
                              {
                                modelObjectIds: [
                                  {
                                    modelId: object.modelId,
                                    objectRuntimeIds: [object.id],
                                  },
                                ],
                              },
                              {
                                color: {
                                  r: selectedSequence[0].color.r,
                                  g: selectedSequence[0].color.g,
                                  b: selectedSequence[0].color.b,
                                },
                                visible: true,
                              },
                            );
                            if (
                              sequence.name !== "Grid" &&
                              sequence.name !== "grid" &&
                              sequence.name !== "GRID"
                            ) {
                              await tcapi.markup.addTextMarkup([
                                {
                                  text: object.asmPos,
                                  color: {
                                    r: 21,
                                    g: 101,
                                    b: 192,
                                  },
                                  start: {
                                    positionX: object.center[0],
                                    positionY: object.center[1],
                                    positionZ: object.center[2],
                                  },
                                  end: {
                                    positionX: object.center[0] + 10,
                                    positionY: object.center[1],
                                    positionZ: object.center[2],
                                  },
                                },
                              ]);
                            }
                            await delay(timeStep);
                          }
                        }
                      } catch (error) {
                        console.error(
                          "Error processing sequence",
                          sequence.id,
                          error,
                        );
                      }
                    }
                  }}
                />
              )}

            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={async () => {
                const tcapi = await WorkspaceAPI.connect(window.parent);
                const items = sequenceObjects.filter(
                  (x) => x && x.folderId === item.id,
                );
                const runtimeIds = items[0].objects.map((x) => {
                  return {
                    modelId: x.modelId,
                    objectRuntimeIds: [x.id],
                  };
                });
                console.log(runtimeIds);
                await tcapi.viewer.setSelection(
                  {
                    modelObjectIds: runtimeIds,
                  },
                  "set",
                );
              }}
            />
            <Popconfirm
              title="Delete the step"
              description="Are you sure to delete this step?"
              onConfirm={() => {
                const deleteSequenceBody = {
                  phaseCommentId: phaseCommentId,
                  sequences: sequences,
                  sequenceObjects: sequenceObjects,
                  folderId: item.id,
                };
                console.log("deleteSequenceBody", deleteSequenceBody);
                dispatch(DeleteSequenceRequest(deleteSequenceBody));
              }}
              okText="Yes"
              cancelText="No"
            >
              <Button
                type="text"
                icon={<DeleteFilled />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </div>
        ),
      },
    ];

    const handleContextMenuClick = ({ key, domEvent }) => {
      domEvent.stopPropagation();

      if (key === "rename") {
        console.log("rename", item);
      }

      if (key === "delete") {
        console.log("delete", item);
      }
    };

    return (
      <Dropdown
        trigger={["contextMenu"]}
        menu={{
          items: contextMenuItems,
          onClick: handleContextMenuClick,
        }}
      >
        <List.Item
          ref={setNodeRef}
          style={style}
          {...attributes}
          onClick={handleSelectItem}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {icon && (
              <span
                {...listeners}
                style={{ cursor: "grab", marginRight: 2 }}
                onClick={(e) => e.stopPropagation()}
              >
                {icon}
              </span>
            )}

            <div
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={item.check ?? false}
                onChange={(e) => {
                  const newSequences = sequences.map((x) =>
                    x.id !== item.id ? x : { ...x, check: e.target.checked },
                  );

                  dispatch(
                    UpdateCommentRequest({
                      commentId: phaseCommentId,
                      sequences: newSequences,
                    }),
                  );
                }}
              />

              <strong> {item.name}</strong>
            </div>
          </div>

          {children && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          )}
        </List.Item>
      </Dropdown>
    );
  }

  function SortableSubItem({
    item,
    icon,
    children,
    selectedIds,
    setSelectedIds,
  }) {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: item.id });
    const isSelected =
      selectedIds.findIndex(
        (x) => x.modelId === item.modelId && x.id === item.id,
      ) >= 0;

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      cursor: "context-menu",
      background: isSelected ? "#e6f4ff" : undefined,
    };

    const assignDateToSelectedItems = (date) => {
      if (!date) return;

      const currentSelectedObjects = selectedIds.map(
        (x) => `${x.modelId}${x.id}`,
      );
      const filteredObjects = selectedObjects.map((obj) => {
        if (currentSelectedObjects.includes(`${obj.modelId}${obj.id}`)) {
          return { ...obj, date: date.format("DD-MM-YYYY") };
        }
        return obj;
      });
      const newSequenceObjects = {
        folderId: selectedGroup,
        objects: filteredObjects,
      };
      dispatch(SetObjectsRequest(newSequenceObjects));
      dispatch(SelectObjectsSuccess(newSequenceObjects));
    };

    const contextMenuItems = [
      {
        key: "assignDate",
        label: (
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DatePicker
              size="small"
              placeholder="Assign date"
              onChange={assignDateToSelectedItems}
            />
          </div>
        ),
      },
      {
        type: "divider",
      },
      {
        key: "delete",
        label: (
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Button
              type="danger"
              icon={<DeleteFilled />}
              onClick={() => {
                const filteredObjects = selectedObjects.filter(
                  (obj) =>
                    !(obj.modelId === item.modelId && obj.id === item.id),
                );
                const newSequenceObjects = {
                  folderId: selectedGroup,
                  objects: filteredObjects,
                };
                dispatch(SetObjectsRequest(newSequenceObjects));
                dispatch(SelectObjectsSuccess(newSequenceObjects));
              }}
            >
              Delete
            </Button>
          </div>
        ),
        danger: true,
      },
    ];

    const handleClick = async (e) => {
      e.stopPropagation();
      const tcapi = await WorkspaceAPI.connect(window.parent);
      var modelObjectIds = [];
      if (e.ctrlKey || e.metaKey) {
        const existing = selectedIds.findIndex(
          (x) => x.modelId === item.modelId && x.id === item.id,
        );
        if (existing < 0) {
          const selectedTCObjects = selectedIds.map((x) => {
            return { modelId: x.modelId, objectRuntimeIds: [x.id] };
          });
          modelObjectIds.push(...selectedTCObjects);
          modelObjectIds.push({
            modelId: item.modelId,
            objectRuntimeIds: [item.id],
          });

          setSelectedIds([
            ...selectedIds,
            { modelId: item.modelId, id: item.id },
          ]);
        } else {
          const selectedTCObjects = selectedIds.filter(
            (x) => !(x.modelId === item.modelId && x.id === item.id),
          );
          modelObjectIds.push(...selectedTCObjects);
          setSelectedIds(
            selectedIds.filter(
              (x) => !(x.modelId === item.modelId && x.id === item.id),
            ),
          );
        }
      } else {
        modelObjectIds.push({
          modelId: item.modelId,
          objectRuntimeIds: [item.id],
        });
        setSelectedIds([{ modelId: item.modelId, id: item.id }]);
      }
      await tcapi.viewer.setSelection(
        {
          modelObjectIds: [...modelObjectIds],
        },
        "set",
      );
    };

    return (
      <Dropdown
        trigger={["contextMenu"]}
        menu={{
          items: contextMenuItems,
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
          },
        }}
      >
        <List.Item
          ref={setNodeRef}
          style={style}
          {...attributes}
          onClick={handleClick}
          onContextMenu={(e) => {
            e.stopPropagation();

            const existing = selectedIds.findIndex(
              (x) => x.modelId === item.modelId && x.id === item.id,
            );
            if (existing < 0) {
              setSelectedIds([
                ...selectedIds,
                { modelId: item.modelId, id: item.id },
              ]);
            }
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {icon && (
              <span
                {...listeners}
                style={{ cursor: "grab", marginRight: 12 }}
                onClick={(e) => e.stopPropagation()}
              >
                {icon}
              </span>
            )}

            <strong>
              {item.asmPos === "" ? item.id : `${item.asmPos}:  ${item.date}`}
            </strong>

            {item.assignDate && (
              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                {item.assignDate}
              </span>
            )}
          </div>

          {children}
        </List.Item>
      </Dropdown>
    );
  }

  const toggleSelect = (item, e) => {
    setSelectedIds((prev) => {
      if (e.ctrlKey || e.metaKey) {
        const existing = prev.findIndex(
          (x) => x.modelId === item.modelId && x.id === item.id,
        );
        if (existing >= 0) {
          return prev.filter(
            (x) => !(x.modelId === item.modelId && x.id === item.id),
          );
        }
        return [...prev, { modelId: item.modelId, id: item.id }];
      }

      return [{ modelId: item.modelId, id: item.id }];
    });
  };

  useEffect(() => {
    async function fetchStatus() {
      const tcapi = await WorkspaceAPI.connect(window.parent);
      const token = await tcapi.extension.requestPermission("accesstoken");
      window.localStorage.setItem("trimbleToken", token);
      const project = await tcapi.project.getProject();
      setProjectId(project.id);
      setProjectName(project.name);
      dispatch(
        GetPhaseRequest({
          projectId: project.id,
          projectName: project.name,
        }),
      );
    }
    fetchStatus();
  }, []);
  return (
    <Layout style={{ height: "100vh" }}>
      <Header style={{ background: "#fff", height: "auto" }}>
        <Title level={4} style={{ margin: 0, alignContent: "center" }}>
          Sequencing
        </Title>
      </Header>
      <Content>
        <Card>
          <Simulation/>
          <div style={{ display: "flex", maxWidth: "350px", gap: 5 }}>
            <Input
              style={{ flex: 1 }}
              placeholder="Time Step"
              value={timeStep}
              onChange={(e) => setTimeStep(Number(e.target.value))}
            />
            <Text style={{ margin: 0, alignContent: "center" }}>
              All Sequence
            </Text>
            <Checkbox
              checked={allSequenceChecked}
              onChange={(e) => setAllSequenceChecked(e.target.checked)}
            />
            <Button
              type="primary"
              style={{ width: 100 }}
              onClick={async () => {
                const tcapi = await WorkspaceAPI.connect(window.parent);
                tcapi.markup.removeMarkups(undefined);
                const delay = (ms) => new Promise((res) => setTimeout(res, ms));
                var accumulatedObjects = [];
                for (const sequence of sequences) {
                  if (sequence.check || allSequenceChecked) {
                    const sequenceObjectsTobeShown = sequenceObjects.filter(
                      (x) => x && x.folderId === sequence.id,
                    );
                    const selectedSequence = sequences.filter(
                      (x) => x && x.id == sequence.id,
                    );
                    try {
                      const objects =
                        sequenceObjectsTobeShown?.[0]?.objects ?? [];
                      if (objects.length > 0) {
                        //Get grid
                        const layers = await tcapi.viewer.getLayers(
                          objects[0].modelId,
                        );
                        const grids = layers.filter((x) =>
                          x.name.toLocaleLowerCase().includes("grid"),
                        );
                        console.log(grids);
                        await tcapi.viewer.setLayersVisibility(objects[0].modelId,grids)

                        for (const object of objects) {
                          const index = accumulatedObjects.findIndex(
                            (x) => x.modelId === object.modelId,
                          );
                          if (index >= 0) {
                            accumulatedObjects[index].entityIds.push(object.id);
                          } else {
                            accumulatedObjects.push({
                              modelId: object.modelId,
                              entityIds: [object.id],
                            });
                          }
                          await tcapi.viewer.isolateEntities(
                            accumulatedObjects,
                          );
                          await tcapi.viewer.setObjectState(
                            {
                              modelObjectIds: [
                                {
                                  modelId: object.modelId,
                                  objectRuntimeIds: [object.id],
                                },
                              ],
                            },
                            {
                              color: {
                                r: selectedSequence[0].color.r,
                                g: selectedSequence[0].color.g,
                                b: selectedSequence[0].color.b,
                              },
                              visible: true,
                            },
                          );
                          if (
                            sequence.name !== "Grid" &&
                            sequence.name !== "grid" &&
                            sequence.name !== "GRID"
                          ) {
                            await tcapi.markup.addTextMarkup([
                              {
                                text: object.asmPos,
                                start: {
                                  positionX: object.center[0],
                                  positionY: object.center[1],
                                  positionZ: object.center[2],
                                },
                                end: {
                                  positionX: object.center[0] + 10,
                                  positionY: object.center[1],
                                  positionZ: object.center[2],
                                },
                              },
                            ]);
                          }
                          await delay(timeStep);
                        }
                      }
                    } catch (error) {
                      console.error(
                        "Error processing sequence",
                        sequence.id,
                        error,
                      );
                    }
                  }
                }
              }}
            >
              Simulation
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => {
                const data = [];
                var index = 0;
                for (const key in sequenceObjects) {
                  const item = sequenceObjects[key];
                  if (!item) continue;

                  const sequence = sequences.filter(
                    (x) => x.id === item.folderId,
                  );
                  console.log(item);
                  for (const obj of item.objects) {
                    index = index + 1;
                    data.push({
                      group: sequence[0]?.name ?? "",
                      asmPos: obj.asmPos,
                      location: obj.positionCode,
                      sequenceNo: index,
                    });
                  }
                }
                exportToExcel(data, "Sequencing.xlsx");
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: "350px",
              marginTop: 2,
              gap: 5,
            }}
          >
            <Input
              style={{ flex: 1 }}
              placeholder="Phase Name"
              value={phaseName}
              onChange={(e) => setPhaseName(e.target.value)}
            />
            <Button
              type="primary"
              style={{ width: 66 }}
              onClick={() => {
                dispatch(
                  CreatePhaseRequest({
                    name: phaseName,
                    rootCommentId: rootCommentId,
                    rootFolderId: rootFolderId,
                    phases: phases,
                  }),
                );
              }}
            >
              Create
            </Button>
            <Button
              type="primary"
              style={{ width: 65 }}
              onClick={() => {
                const newPhases = phases.map((x) =>
                  x.id !== phaseFolderId ? x : { ...x, name: phaseName },
                );
                dispatch(
                  UpdatePhaseRequest({
                    commentId: rootCommentId,
                    phases: newPhases,
                  }),
                );
              }}
            >
              Modify
            </Button>
            <Popconfirm
              title="Delete the phase"
              description="Are you sure to delete this phase?"
              onConfirm={() => {
                const deleteSequenceBody = {
                  rootCommentId: rootCommentId,
                  folderId: phaseFolderId,
                  phases: phases,
                };
                dispatch(DeletePhaseRequest(deleteSequenceBody));
              }}
              okText="Yes"
              cancelText="No"
            >
              <Button danger type="text" icon={<DeleteFilled />} />
            </Popconfirm>
          </div>
          <Collapse
            style={{ marginTop: "5px" }}
            activeKey={activeKey}
            onChange={(activeKeys) => {
              setActiveKey(
                activeKeys.length > 0
                  ? activeKeys[activeKeys.length - 1]
                  : null,
              );
              try {
                const phase = phases.filter(
                  (x) => x.id === activeKeys[activeKeys.length - 1],
                )[0];
                setPhaseName(phase.name);
                setPhaseFolderId(phase.id);
                console.log(phase.id);
                dispatch(GetSequenceRequest({ folderId: phase.id }));
              } catch (error) {}
            }}
          >
            {phases.map((item) => (
              <Panel header={item.name} key={item.id}>
                <div
                  style={{
                    display: "flex",
                    maxWidth: "350px",
                    marginTop: 2,
                    gap: 5,
                  }}
                >
                  <Input
                    style={{ flex: 1 }}
                    placeholder="Group Name"
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexDirection: "row",
                      columnGap: "2px",
                    }}
                  >
                    <div
                      type="primary"
                      onClick={() => setColorDialog(!colorDialog)}
                      style={{
                        background: `rgb(${color.rgb.r ?? 0},${color.rgb.g ?? 0},${color.rgb.b ?? 0})`,
                      }}
                    >
                                
                    </div>
                    <Modal
                      width={270}
                      title="Color"
                      open={colorDialog}
                      footer={null}
                      onCancel={() => {
                        setColorDialog(!colorDialog);
                      }}
                    >
                      <Colorpicker
                        value={color}
                        onChange={(value) => {
                          setColor(value);
                        }}
                      />
                    </Modal>
                  </div>
                  <Button
                    type="primary"
                    style={{ width: 66 }}
                    onClick={() => {
                      dispatch(
                        CreateSequenceRequest({
                          name: step,
                          color: color.rgb,
                          check: false,
                          phaseFolderId: phaseFolderId,
                          phaseCommentId: phaseCommentId,
                          sequences: sequences,
                          sequenceObjects: sequenceObjects,
                        }),
                      );
                    }}
                  >
                    Create
                  </Button>
                  <Button
                    type="primary"
                    style={{ width: 65 }}
                    onClick={() => {
                      console.log(step);
                      console.log(selectedGroup);
                      const newSequences = sequences.map((x) =>
                        x.id !== selectedGroup
                          ? x
                          : { ...x, name: step, color: color.rgb },
                      );
                      console.log(newSequences);
                      dispatch(
                        UpdateCommentRequest({
                          commentId: phaseCommentId,
                          sequences: newSequences,
                        }),
                      );
                    }}
                  >
                    Modify
                  </Button>
                </div>
                <div
                  style={{
                    display: "flex",
                    maxWidth: "350px",
                    marginTop: 2,
                    gap: 5,
                  }}
                >
                  <Select
                    style={{ flex: 1 }}
                    placeholder="Select Phase"
                    value={sourcePhase}
                    onChange={(e) => {
                      setSourcePhase(e);
                      dispatch(GetSourceSequenceRequest({ folderId: e }));
                    }}
                  >
                    {phases
                      .filter((x) => x.name !== item.name)
                      .map((x) => (
                        <Select.Option key={x.id}>{x.name}</Select.Option>
                      ))}
                  </Select>
                  <Button
                    type="primary"
                    onClick={() => {
                      const newSequences = [
                        ...sequences,
                        ...sequencesToBeCopied,
                      ].reduce((acc, current) => {
                        if (!acc.some((x) => x.id === current.id)) {
                          acc.push(current);
                        }
                        return acc;
                      }, []);
                      console.log(newSequences);
                      dispatch(
                        CopySequenceRequest({
                          phaseFolderId: phaseFolderId,
                          commentId: phaseCommentId,
                          sequences: sequences,
                          sequencesToBeCopied: newSequences,
                        }),
                      );
                    }}
                  >
                    Copy Category
                  </Button>
                </div>
                <Splitter
                  style={{
                    height: "100%",
                    marginTop: "10px",
                    boxShadow: "0 0 10px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <Splitter.Panel defaultSize="50%" min="10%" max="60%">
                    <DndContext onDragEnd={onDragEnd}>
                      <SortableContext
                        items={sequences.map((x) => x.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <List
                          style={{ minWidth: "250px", marginLeft: "10px" }}
                          loading={sequenceState.pending}
                          dataSource={sequences}
                          renderItem={(item) => (
                            <SortableItem
                              key={item.id}
                              item={item}
                              icon={<MenuOutlined />}
                              sequenceObjects={sequenceObjects}
                            />
                          )}
                        />
                      </SortableContext>
                    </DndContext>
                  </Splitter.Panel>
                  <Splitter.Panel>
                    <DndContext onDragEnd={onDragEndSubItem}>
                      <SortableContext
                        items={selectedObjects.map((x) => x.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <List
                          style={{
                            marginLeft: "10px",
                            minWidth: "100px",
                            maxHeight: "600px",
                          }}
                          loading={sequenceState.pending}
                          dataSource={selectedObjects}
                          renderItem={(item) => (
                            <SortableSubItem
                              key={`${item.modelId}${item.id}`}
                              item={item}
                              selectedIds={selectedIds}
                              setSelectedIds={setSelectedIds}
                              icon={<FileOutlined />}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              ></div>
                            </SortableSubItem>
                          )}
                        />
                      </SortableContext>
                    </DndContext>
                  </Splitter.Panel>
                </Splitter>
              </Panel>
            ))}
          </Collapse>
        </Card>
      </Content>
    </Layout>
  );
}

export default App;
