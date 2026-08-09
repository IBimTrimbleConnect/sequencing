import React, {
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  Button,
  Dropdown,
  Popconfirm,
} from "antd";

import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  MenuOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SelectOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";

import {
  useSortable,
} from "@dnd-kit/sortable";

import {
  CSS,
} from "@dnd-kit/utilities";

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

const SortableHeader = ({
  plan,

  objectCount = 0,

  isOwner = false,

  isFree = false,

  onEdit,
  onDelete,
  onAddSubPlan,
  onAssignObject,
  onAutoAssign,
  onCopySubPlan,
  onSortByDate,
  onHighlightObject,
  onSimulation,
}) => {
  const [
    dropdownOpen,
    setDropdownOpen,
  ] = useState(false);

  const [
    deleteConfirmOpen,
    setDeleteConfirmOpen,
  ] = useState(false);

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

        callback?.(plan);
      },
      [
        closeDropdown,
        plan,
      ],
    );

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
            danger={danger}
            disabled={disabled}
            onClick={() => {
              if (disabled) {
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
       * RUN SIMULATION
       *
       * Free   -> visible + disabled
       * Viewer -> enabled
       * Owner  -> enabled
       */
      if (onSimulation) {
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
       * HIGHLIGHT
       *
       * Free / Viewer / Owner
       * are all allowed.
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
       * Divider before Owner-only actions.
       */
      if (
        items.length > 0
      ) {
        items.push({
          type: "divider",
        });
      }

      /*
       * OWNER-ONLY ACTIONS
       *
       * Viewer / Free:
       * visible but disabled.
       */

      if (onAssignObject) {
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
              !canEdit,
          }),
        );
      }

      if (onAutoAssign) {
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
              !canEdit,
          }),
        );
      }

      if (onAddSubPlan) {
        items.push(
          createMenuItem({
            key:
              "createSubPlan",

            icon: (
              <FolderAddOutlined />
            ),

            label:
              "Create Sub Plan",

            callback:
              onAddSubPlan,

            disabled:
              !canEdit,
          }),
        );
      }

      if (onSortByDate) {
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

      if (onCopySubPlan) {
        items.push(
          createMenuItem({
            key:
              "copySubPlan",

            icon: (
              <CopyOutlined />
            ),

            label:
              "Copy Sub Plan",

            callback:
              onCopySubPlan,

            disabled:
              !canEdit,
          }),
        );
      }

      const hasEditActions =
        Boolean(onEdit) ||
        Boolean(onDelete);

      if (
        hasEditActions
      ) {
        items.push({
          type: "divider",
        });
      }

      if (onEdit) {
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

      if (onDelete) {
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
                if (!canEdit) {
                  return;
                }

                setDeleteConfirmOpen(
                  open,
                );

                if (open) {
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

                if (!canEdit) {
                  return;
                }

                setDeleteConfirmOpen(
                  false,
                );

                closeDropdown();

                onDelete(
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
                    if (!canEdit) {
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
       * Remove accidental consecutive/trailing dividers.
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
            array[index - 1];

          const next =
            array[index + 1];

          return (
            index > 0 &&
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
      onAssignObject,
      onAutoAssign,
      onCopySubPlan,
      onSortByDate,
      onHighlightObject,
      onSimulation,
      deleteConfirmOpen,
      closeDropdown,
    ]);

  const handleDropdownChange =
    useCallback(
      (open) => {
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

  const handleStopPropagation =
    useCallback(
      (event) => {
        event.stopPropagation();
      },
      [],
    );

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

        minWidth:
          0,
      }),
      [
        transform,
        transition,
        isDragging,
      ],
    );

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

  return (
    <div
      ref={
        setNodeRef
      }
      style={
        containerStyle
      }
    >
      <div
        style={{
          display:
            "flex",

          alignItems:
            "center",

          gap: 8,

          minWidth:
            0,

          flex: 1,
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

            gap: 8,

            minWidth:
              0,

            flex: 1,
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
            [{safeObjectCount}]
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
          }}
        >
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
