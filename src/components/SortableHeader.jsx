import React, {
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  Button,
  DatePicker,
  Dropdown,
  Input,
  Popconfirm,
  Checkbox,
  Tooltip,
} from "antd";

import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  MenuOutlined,
  MoreOutlined,
  CalendarOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  EyeOutlined,
  SelectOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";

import {
  useSortable,
} from "@dnd-kit/sortable";

import {
  CSS,
} from "@dnd-kit/utilities";

/* -------------------------------------------------------------------------- */
/* MENU BUTTON                                                                */
/* -------------------------------------------------------------------------- */

const MenuButton = ({
  icon,
  children,
  danger = false,
  disabled = false,
  onClick,
}) => {
  const handleClick = (
    event,
  ) => {
    event.stopPropagation();

    if (disabled) {
      return;
    }

    onClick?.();
  };

  return (
    <Button
      size="small"
      type="text"
      danger={danger}
      disabled={disabled}
      icon={icon}
      onClick={
        handleClick
      }
      style={{
        width: "100%",

        display: "flex",

        justifyContent:
          "flex-start",

        alignItems:
          "center",
      }}
    >
      {children}
    </Button>
  );
};

/* -------------------------------------------------------------------------- */
/* SORTABLE HEADER                                                            */
/* -------------------------------------------------------------------------- */

const SortableHeader = ({
  plan,

  objectCount = 0,

  dateRange = null,

  isOwner = false,

  isFree = false,

  selected = false,

  onSelect,

  onEdit,

  onDelete,

  onAddSubPlan,

  addSubPlanDisabled = false,

  onAssignObject,

  onAutoAssign,

  onAssignByLayer,

  assignItemsDisabled = false,

  onCopySubPlan,

  onCopyNodesFrom,

  copyNodesFromDisabled = false,

  onSortByDate,

  onHighlightObject,

  onShowOnlyObject,

  onSimulation,

  addChildLabel = "Create Sub Plan",
  copyLabel = "Copy Sub Plan",

  /*
   * Date assignment.
   *
   * Signature:
   *
   * onAssignDate(
   *   plan,
   *   date,
   *   dateStep,
   *   considerWeekend,
   * )
   */
  onAssignDate,
}) => {
  const [
    dropdownOpen,
    setDropdownOpen,
  ] = useState(false);

  const [
    deleteConfirmOpen,
    setDeleteConfirmOpen,
  ] = useState(false);

  /*
   * ============================================================
   * DATE
   * ============================================================
   *
   * Giữ giống Sequence Objects:
   *
   * [ DatePicker ] [ Step ] [ Edit ]
   */
  const [
    assignDate,
    setAssignDate,
  ] = useState(null);

  const [
    assignEndDate,
    setAssignEndDate,
  ] = useState(null);

  const [
    dateStep,
    setDateStep,
  ] = useState("");

  const [
    considerWeekend,
    setConsiderWeekend,
  ] = useState(false);

  /* ------------------------------------------------------------------------ */
  /* SORTABLE                                                                 */
  /* ------------------------------------------------------------------------ */

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: String(
      plan?.id ?? "",
    ),

    disabled:
      !isOwner,
  });

  /* ------------------------------------------------------------------------ */
  /* DROPDOWN                                                                 */
  /* ------------------------------------------------------------------------ */

  const closeDropdown =
    useCallback(() => {
      setDropdownOpen(
        false,
      );
    }, []);

  const executeAction =
    useCallback(
      (callback) => {
        closeDropdown();

        callback?.(
          plan,
        );
      },
      [
        closeDropdown,
        plan,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* MENU ITEM                                                                */
  /* ------------------------------------------------------------------------ */

  const createMenuItem =
    useCallback(
      ({
        key,
        icon,
        label,
        callback,
        danger = false,
        disabled = false,
      }) => ({
        key,

        label: (
          <MenuButton
            icon={icon}
            danger={
              danger
            }
            disabled={
              disabled
            }
            onClick={() => {
              if (
                disabled
              ) {
                return;
              }

              executeAction(
                callback,
              );
            }}
          >
            {label}
          </MenuButton>
        ),
      }),
      [
        executeAction,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* MENU                                                                     */
  /* ------------------------------------------------------------------------ */

  const menuItems =
    useMemo(() => {
      const items = [];

      const canSimulation =
        !isFree;

      const canHighlight =
        true;

      const canEdit =
        isOwner;

      /*
       * ============================================================
       * ASSIGN / MODIFY DATE
       * ============================================================
       *
       * ĐẨY LÊN ĐẦU MENU.
       *
       * Layout giống Sequence Objects:
       *
       * [ DatePicker ] [ Step ] [ Edit ]
       *
       * RULES:
       *
       * Date + Step 0
       * => tất cả object cùng ngày.
       *
       * Date + Step 1
       * => Object 1 = Date
       *    Object 2 = Date + 1
       *    Object 3 = Date + 2
       *
       * Date + Step 2
       * => Object 1 = Date
       *    Object 2 = Date + 2
       *    Object 3 = Date + 4
       *
       * Date empty + Step 1
       * => current date + 1 day.
       *
       * Date empty + Step -1
       * => current date - 1 day.
       */
      if (
        onAssignDate
      ) {
        items.push({
          key:
            "assignDate",

          label: (
            <div
              style={{
                display:
                  "flex",

                gap:
                  8,

                alignItems:
                  "center",
              }}
              onClick={(
                event,
              ) => {
                event.stopPropagation();
              }}
              onMouseDown={(
                event,
              ) => {
                event.stopPropagation();
              }}
              onPointerDown={(
                event,
              ) => {
                event.stopPropagation();
              }}
            >
              {/*
               * Giữ nguyên size
               * giống Sequence Objects.
               */}
              <DatePicker
                size="small"
                placeholder="Start date"
                value={
                  assignDate
                }
                onChange={(
                  date,
                ) => {
                  setAssignDate(
                    date,
                  );
                }}
              />

              <DatePicker
                size="small"
                placeholder="End date"
                value={assignEndDate}
                minDate={assignDate || undefined}
                onChange={setAssignEndDate}
              />

              {/*
               * Giữ width = 40
               * giống Sequence Objects.
               */}
              <Input
                size="small"
                style={{
                  width:
                    40,
                }}
                value={
                  dateStep
                }
                onChange={(
                  event,
                ) => {
                  setDateStep(
                    event
                      .target
                      .value,
                  );
                }}
              />

              <Checkbox
                checked={considerWeekend}
                onChange={(event) => {
                  setConsiderWeekend(event.target.checked);
                }}
              >
                Weekend
              </Checkbox>

              <Button
                size="small"
                type="text"
                disabled={
                  !canEdit ||
                  (
                    !assignDate &&
                    !assignEndDate &&
                    !Number(dateStep)
                  )
                }
                icon={
                  <EditOutlined />
                }
                onClick={(
                  event,
                ) => {
                  event.stopPropagation();

                  if (
                    !canEdit
                  ) {
                    return;
                  }

                  if (
                    !assignDate &&
                    !assignEndDate &&
                    !Number(dateStep)
                  ) {
                    return;
                  }

                  /*
                   * Date empty
                   * Step empty / 0
                   *
                   * => không làm gì.
                   */
                  onAssignDate?.(
                    plan,
                    assignDate,
                    dateStep,
                    considerWeekend,
                    assignEndDate,
                  );
                }}
              />
            </div>
          ),
        });

        /*
         * Divider ngay dưới Date.
         */
        items.push({
          type:
            "divider",
        });
      }

      /*
       * ============================================================
       * RUN SIMULATION
       * ============================================================
       *
       * Free   -> visible + disabled
       * Viewer -> enabled
       * Owner  -> enabled
       */
      if (
        onSimulation
      ) {
        items.push(
          createMenuItem({
            key:
              "runSimulation",

            icon: (
              <PlayCircleOutlined />
            ),

            label:
              "Run Simulation",

            callback:
              onSimulation,

            disabled:
              !canSimulation,
          }),
        );
      }

      /*
       * ============================================================
       * HIGHLIGHT
       * ============================================================
       */
      if (
        onHighlightObject
      ) {
        items.push(
          createMenuItem({
            key:
              "highlightObjects",

            icon: (
              <SelectOutlined />
            ),

            label:
              "Highlight",

            callback:
              onHighlightObject,

            disabled:
              !canHighlight,
          }),
        );
      }

      /*
       * Divider.
       */
      if (
        (
          onSimulation ||
          onHighlightObject
        ) &&
        (
          onAssignObject ||
          onAutoAssign ||
          onAssignByLayer ||
          onAddSubPlan ||
          onSortByDate ||
          onCopySubPlan
        )
      ) {
        items.push({
          type:
            "divider",
        });
      }

      /*
       * ============================================================
       * ASSIGN MULTIPLE ASSEMBLIES
       * ============================================================
       */
      if (
        onAssignObject
      ) {
        items.push(
          createMenuItem({
            key:
              "assignMultipleAssemblies",

            icon: (
              <PlusOutlined />
            ),

            label:
              "Assign Multiple Assemblies",

            callback:
              onAssignObject,

            disabled:
              !canEdit ||
              assignItemsDisabled,
          }),
        );
      }

      /*
       * ============================================================
       * ASSIGN PICKED ASSEMBLIES IN ORDER
       * ============================================================
       */
      if (
        onAutoAssign
      ) {
        items.push(
          createMenuItem({
            key:
              "assignPickedAssemblies",

            icon: (
              <PlusOutlined />
            ),

            label:
              "Assign Picked Assemblies In Order",

            callback:
              onAutoAssign,

            disabled:
              !canEdit ||
              assignItemsDisabled,
          }),
        );
      }

      /*
       * ============================================================
       * ASSIGN BY LAYER
       * ============================================================
       */
      if (
        onAssignByLayer
      ) {
        items.push(
          createMenuItem({
            key:
              "assignByLayer",

            icon: (
              <PlusOutlined />
            ),

            label:
              "Assign by Layer",

            callback:
              onAssignByLayer,

            disabled:
              !canEdit ||
              assignItemsDisabled,
          }),
        );
      }

      /*
       * ============================================================
       * CREATE SUB PLAN
       * ============================================================
       */
      if (
        onAddSubPlan
      ) {
        items.push(
          createMenuItem({
            key:
              "createSubPlan",

            icon: (
              <FolderAddOutlined />
            ),

            label:
              addChildLabel,

            callback:
              onAddSubPlan,

            disabled:
              !canEdit ||
              addSubPlanDisabled,
          }),
        );
      }

      /*
       * ============================================================
       * SORT BY DATE
       * ============================================================
       */
      if (
        onSortByDate
      ) {
        items.push(
          createMenuItem({
            key:
              "sortByDate",

            icon: (
              <SortAscendingOutlined />
            ),

            label:
              "Sort By Date",

            callback:
              onSortByDate,

            disabled:
              !canEdit,
          }),
        );
      }

      /*
       * ============================================================
       * COPY SUB PLAN
       * ============================================================
       */
      if (
        onCopySubPlan
      ) {
        items.push(
          createMenuItem({
            key:
              "copySubPlan",

            icon: (
              <CopyOutlined />
            ),

            label:
              copyLabel,

            callback:
              onCopySubPlan,

            disabled:
              !canEdit,
          }),
        );
      }

      if (onCopyNodesFrom) {
        items.push(
          createMenuItem({
            key: "copyNodesFrom",
            icon: <CopyOutlined />,
            label: "Copy Nodes From",
            callback: onCopyNodesFrom,
            disabled: !canEdit || copyNodesFromDisabled,
          }),
        );
      }

      /*
       * Divider before Edit/Delete.
       */
      const hasEditActions =
        Boolean(
          onEdit,
        ) ||
        Boolean(
          onDelete,
        );

      if (
        hasEditActions
      ) {
        items.push({
          type:
            "divider",
        });
      }

      /*
       * ============================================================
       * EDIT
       * ============================================================
       */
      if (
        onEdit
      ) {
        items.push(
          createMenuItem({
            key:
              "edit",

            icon: (
              <EditOutlined />
            ),

            label:
              "Edit",

            callback:
              onEdit,

            disabled:
              !canEdit,
          }),
        );
      }

      /*
       * ============================================================
       * DELETE
       * ============================================================
       */
      if (
        onDelete
      ) {
        items.push({
          key:
            "delete",

          label: (
            <Popconfirm
              title="Delete"
              description="Are you sure?"
              okText="Yes"
              cancelText="No"
              disabled={
                !canEdit
              }
              open={
                canEdit
                  ? deleteConfirmOpen
                  : false
              }
              onOpenChange={(
                open,
              ) => {
                if (
                  !canEdit
                ) {
                  return;
                }

                setDeleteConfirmOpen(
                  open,
                );

                if (
                  open
                ) {
                  setDropdownOpen(
                    true,
                  );
                }
              }}
              onConfirm={(
                event,
              ) => {
                event
                  ?.stopPropagation?.();

                if (
                  !canEdit
                ) {
                  return;
                }

                setDeleteConfirmOpen(
                  false,
                );

                closeDropdown();

                onDelete?.(
                  plan,
                );
              }}
              onCancel={(
                event,
              ) => {
                event
                  ?.stopPropagation?.();

                setDeleteConfirmOpen(
                  false,
                );

                closeDropdown();
              }}
            >
              <div>
                <MenuButton
                  danger
                  icon={
                    <DeleteOutlined />
                  }
                  disabled={
                    !canEdit
                  }
                  onClick={() => {
                    if (
                      !canEdit
                    ) {
                      return;
                    }

                    setDeleteConfirmOpen(
                      true,
                    );
                  }}
                >
                  Delete
                </MenuButton>
              </div>
            </Popconfirm>
          ),
        });
      }

      /*
       * ============================================================
       * CLEAN DIVIDERS
       * ============================================================
       *
       * Remove:
       *
       * - divider đầu tiên
       * - divider cuối cùng
       * - divider liền nhau
       */
      return items.filter(
        (
          item,
          index,
          array,
        ) => {
          if (
            item?.type !==
            "divider"
          ) {
            return true;
          }

          const previous =
            array[
              index - 1
            ];

          const next =
            array[
              index + 1
            ];

          return (
            index >
              0 &&
            index <
              array.length -
                1 &&
            previous?.type !==
              "divider" &&
            next?.type !==
              "divider"
          );
        },
      );
    }, [
      createMenuItem,

      isOwner,

      isFree,

      plan,

      onEdit,

      onDelete,

      onAddSubPlan,

      addSubPlanDisabled,

      onAssignObject,

      onAutoAssign,

      onAssignByLayer,

      assignItemsDisabled,

      onCopySubPlan,

      onCopyNodesFrom,

      copyNodesFromDisabled,

      onSortByDate,

      onHighlightObject,

      onSimulation,
      addChildLabel,
      copyLabel,

      onAssignDate,

      assignDate,

      assignEndDate,

      dateStep,

      considerWeekend,

      deleteConfirmOpen,

      closeDropdown,
    ]);

  /* ------------------------------------------------------------------------ */
  /* DROPDOWN OPEN                                                            */
  /* ------------------------------------------------------------------------ */

  const handleDropdownChange =
    useCallback(
      (open) => {
        /*
         * Popconfirm đang mở thì
         * không đóng Dropdown.
         */
        if (
          !open &&
          deleteConfirmOpen
        ) {
          return;
        }

        setDropdownOpen(
          open,
        );
      },
      [
        deleteConfirmOpen,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* EVENTS                                                                   */
  /* ------------------------------------------------------------------------ */

  const handleStopPropagation =
    useCallback(
      (event) => {
        event.stopPropagation();
      },
      [],
    );

  /* ------------------------------------------------------------------------ */
  /* STYLE                                                                    */
  /* ------------------------------------------------------------------------ */

  const containerStyle =
    useMemo(
      () => ({
        transform:
          CSS.Transform.toString(
            transform,
          ),

        transition,

        opacity:
          isDragging
            ? 0.5
            : 1,

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "space-between",

        width:
          "100%",

        maxWidth:
          "100%",

        minWidth:
          0,

        overflow:
          "hidden",

        boxSizing:
          "border-box",

        /*
         * Selection boundary is rendered by the outer
         * Collapse panel in SubPlanCollapse.
         */
      }),
      [
        transform,

        transition,

        isDragging,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* OBJECT COUNT                                                             */
  /* ------------------------------------------------------------------------ */

  const safeObjectCount =
    Number.isFinite(
      Number(
        objectCount,
      ),
    )
      ? Math.max(
          0,
          Number(
            objectCount,
          ),
        )
      : 0;

  /* ------------------------------------------------------------------------ */
  /* UI                                                                       */
  /* ------------------------------------------------------------------------ */

  return (
    <div
      ref={
        setNodeRef
      }
      style={
        containerStyle
      }
      onClick={(event) => {
        if (!onSelect) {
          return;
        }

        const target =
          event.target instanceof Element
            ? event.target
            : null;

        const interactiveElement =
          target?.closest(
            "button, input, .ant-dropdown-trigger, .ant-picker, .ant-input, [role='button']",
          );

        if (interactiveElement) {
          return;
        }

        if (
          event.ctrlKey ||
          event.metaKey
        ) {
          event.preventDefault();
          event.stopPropagation();

          onSelect(
            plan,
            "toggle",
          );

          return;
        }

        onSelect(
          plan,
          "reset",
        );
      }}
    >
      <div
        style={{
          display:
            "flex",

          alignItems:
            "center",

          gap:
            8,

          minWidth:
            0,

          flex:
            1,
        }}
      >
        {isOwner && (
          <span
            {...attributes}
            {...listeners}
            onClick={
              handleStopPropagation
            }
            style={{
              cursor:
                isDragging
                  ? "grabbing"
                  : "grab",

              display:
                "inline-flex",

              alignItems:
                "center",

              flexShrink:
                0,

              touchAction:
                "none",
            }}
          >
            <MenuOutlined />
          </span>
        )}

        <div
          style={{
            display:
              "flex",

            alignItems:
              "center",

            gap:
              8,

            minWidth:
              0,

            flex:
              1,

            cursor:
              onSelect
                ? "pointer"
                : undefined,
          }}
        >
          <span
            title={
              plan?.name
            }
            style={{
              overflow:
                "hidden",

              textOverflow:
                "ellipsis",

              whiteSpace:
                "nowrap",

              minWidth:
                0,
            }}
          >
            {plan?.name ||
              "Unnamed Plan"}
          </span>

          <span>
            [
            {
              safeObjectCount
            }
            ]
          </span>
        </div>
      </div>

      {menuItems.length >
        0 && (
        <div
          onClick={
            handleStopPropagation
          }
          style={{
            flexShrink:
              0,

            display:
              "inline-flex",

            alignItems:
              "center",

            gap:
              6,

            minWidth:
              0,

            maxWidth:
              dateRange
                ? "48%"
                : undefined,

            flex:
              dateRange
                ? "0 1 220px"
                : "0 0 auto",

            marginLeft:
              "auto",
          }}
        >
          {dateRange && (
            <span
              title={`Start: ${dateRange.start} | End: ${dateRange.end}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                minHeight: 20,
                padding: "0 5px",
                color: "rgba(0, 0, 0, 0.72)",
                background: "rgba(0, 0, 0, 0.035)",
                border: "1px solid rgba(0, 0, 0, 0.10)",
                borderRadius: 4,
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
                flex: "1 1 auto",
              }}
            >
              <CalendarOutlined
                style={{
                  color: "#1677ff",
                  fontSize: 11,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {dateRange.start} → {dateRange.end}
              </span>
            </span>
          )}

          {onShowOnlyObject && (
            <Tooltip
              title={
                safeObjectCount > 0
                  ? "Show only objects in this node"
                  : "This node has no objects"
              }
            >
              <Button
                type="text"
                size="small"
                aria-label="Show only node objects"
                icon={<EyeOutlined />}
                disabled={safeObjectCount < 1}
                onClick={(event) => {
                  event.stopPropagation();
                  if (safeObjectCount < 1) return;
                  onShowOnlyObject(plan);
                }}
                style={{
                  flexShrink: 0,
                  color: safeObjectCount > 0 ? "#1677ff" : undefined,
                }}
              />
            </Tooltip>
          )}

          <Dropdown
            open={
              dropdownOpen
            }
            trigger={[
              "click",
            ]}
            placement="bottomRight"
            destroyOnHidden
            onOpenChange={
              handleDropdownChange
            }
            menu={{
              items:
                menuItems,

              onClick: ({
                domEvent,
              }) => {
                domEvent.stopPropagation();
              },
            }}
          >
            <Button
              type="text"
              size="small"
              icon={
                <MoreOutlined />
              }
              onClick={
                handleStopPropagation
              }
            />
          </Dropdown>
        </div>
      )}
    </div>
  );
};

export default React.memo(
  SortableHeader,
);
