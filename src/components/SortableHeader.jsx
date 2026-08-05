import React, { useCallback, useMemo, useState } from "react";

import { Badge, Button, Dropdown, Popconfirm } from "antd";

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

import { useSortable } from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

const MenuButton = ({ icon, children, danger = false, onClick }) => {
  const handleClick = (event) => {
    event.stopPropagation();

    onClick?.();
  };

  return (
    <Button
      size="small"
      type="text"
      danger={danger}
      icon={icon}
      onClick={handleClick}
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "flex-start",
        alignItems: "center",
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
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: String(plan?.id ?? ""),

    disabled: !isOwner,
  });

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
  }, []);

  const executeAction = useCallback(
    (callback) => {
      closeDropdown();

      callback?.(plan);
    },
    [closeDropdown, plan],
  );

  const createMenuItem = useCallback(
    ({ key, icon, label, callback, danger = false }) => ({
      key,

      label: (
        <MenuButton
          icon={icon}
          danger={danger}
          onClick={() => {
            executeAction(callback);
          }}
        >
          {label}
        </MenuButton>
      ),
    }),
    [executeAction],
  );

  const menuItems = useMemo(() => {
    const viewerItems = [];

    if (onSimulation) {
      viewerItems.push(
        createMenuItem({
          key: "runSimulation",

          icon: <PlayCircleOutlined />,

          label: "Run Simulation",

          callback: onSimulation,
        }),
      );
    }

    if (onHighlightObject) {
      viewerItems.push(
        createMenuItem({
          key: "highlightObjects",

          icon: <SelectOutlined />,

          label: "Highlight",

          callback: onHighlightObject,
        }),
      );
    }

    if (!isOwner) {
      return viewerItems;
    }

    const ownerItems = [];

    if (onAssignObject) {
      ownerItems.push(
        createMenuItem({
          key: "assignMultipleAssemblies",

          icon: <PlusOutlined />,

          label: "Assign Multiple Assemblies",

          callback: onAssignObject,
        }),
      );
    }

    if (onAutoAssign) {
      ownerItems.push(
        createMenuItem({
          key: "assignPickedAssemblies",

          icon: <PlusOutlined />,

          label: "Assign Picked Assemblies In Order",

          callback: onAutoAssign,
        }),
      );
    }

    if (onAddSubPlan) {
      ownerItems.push(
        createMenuItem({
          key: "createSubPlan",

          icon: <FolderAddOutlined />,

          label: "Create Sub Plan",

          callback: onAddSubPlan,
        }),
      );
    }

    if (onSortByDate) {
      ownerItems.push(
        createMenuItem({
          key: "sortByDate",

          icon: <SortAscendingOutlined />,

          label: "Sort By Date",

          callback: onSortByDate,
        }),
      );
    }

    if (onCopySubPlan) {
      ownerItems.push(
        createMenuItem({
          key: "copySubPlan",

          icon: <CopyOutlined />,

          label: "Copy Sub Plan",

          callback: onCopySubPlan,
        }),
      );
    }

    const editItems = [];

    if (onEdit) {
      editItems.push(
        createMenuItem({
          key: "edit",

          icon: <EditOutlined />,

          label: "Edit",

          callback: onEdit,
        }),
      );
    }

    if (onDelete) {
      editItems.push({
        key: "delete",

        label: (
          <Popconfirm
            title="Delete"
            description="Are you sure?"
            okText="Yes"
            cancelText="No"
            open={deleteConfirmOpen}
            onOpenChange={(open) => {
              setDeleteConfirmOpen(open);

              if (open) {
                setDropdownOpen(true);
              }
            }}
            onConfirm={(event) => {
              event?.stopPropagation?.();

              setDeleteConfirmOpen(false);

              closeDropdown();

              onDelete(plan);
            }}
            onCancel={(event) => {
              event?.stopPropagation?.();

              setDeleteConfirmOpen(false);

              closeDropdown();
            }}
          >
            <div>
              <MenuButton
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setDeleteConfirmOpen(true);
                }}
              >
                Delete
              </MenuButton>
            </div>
          </Popconfirm>
        ),
      });
    }

    const result = [...viewerItems];

    if (viewerItems.length && ownerItems.length) {
      result.push({
        type: "divider",
      });
    }

    result.push(...ownerItems);

    if (editItems.length && (viewerItems.length || ownerItems.length)) {
      result.push({
        type: "divider",
      });
    }

    result.push(...editItems);

    return result;
  }, [
    createMenuItem,
    isOwner,
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

  const handleDropdownChange = useCallback(
    (open) => {
      if (!open && deleteConfirmOpen) {
        return;
      }

      setDropdownOpen(open);
    },
    [deleteConfirmOpen],
  );

  const handleStopPropagation = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const containerStyle = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),

      transition,

      opacity: isDragging ? 0.5 : 1,

      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",

      width: "100%",
      minWidth: 0,
    }),
    [transform, transition, isDragging],
  );

  const safeObjectCount = Number.isFinite(Number(objectCount))
    ? Math.max(0, Number(objectCount))
    : 0;

  return (
    <div ref={setNodeRef} style={containerStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          flex: 1,
        }}
      >
        {isOwner && (
          <span
            {...attributes}
            {...listeners}
            onClick={handleStopPropagation}
            style={{
              cursor: isDragging ? "grabbing" : "grab",

              display: "inline-flex",

              alignItems: "center",

              flexShrink: 0,

              touchAction: "none",
            }}
          >
            <MenuOutlined />
          </span>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            title={plan?.name}
            style={{
              overflow: "hidden",

              textOverflow: "ellipsis",

              whiteSpace: "nowrap",

              minWidth: 0,
            }}
          >
            {plan?.name || "Unnamed Plan"}
          </span>

          <span>[{objectCount}]</span>
        </div>
      </div>

      {menuItems.length > 0 && (
        <div
          onClick={handleStopPropagation}
          style={{
            flexShrink: 0,
          }}
        >
          <Dropdown
            open={dropdownOpen}
            trigger={["click"]}
            placement="bottomRight"
            destroyOnHidden
            onOpenChange={handleDropdownChange}
            menu={{
              items: menuItems,

              onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
              },
            }}
          >
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              onClick={handleStopPropagation}
            />
          </Dropdown>
        </div>
      )}
    </div>
  );
};

export default React.memo(SortableHeader);
