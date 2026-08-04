import React, { useMemo, useState } from "react";
import { Button, Dropdown, Popconfirm,  Badge,} from "antd";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

const MenuButton = ({ icon, children, danger = false, onClick }) => (
  <Button
    size="small"
    type="text"
    danger={danger}
    icon={icon}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.();
    }}
    style={{
      width: "100%",
      justifyContent: "flex-start",
    }}
  >
    {children}
  </Button>
);

const SortableHeader = ({
  objectCount = 0,
  plan,
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
    id: String(plan.id),

    /*
     * Only Owner can reorder Plans.
     */
    disabled: !isOwner,
  });

  const closeDropdown = () => {
    setDropdownOpen(false);
  };

  const executeAction = (callback) => {
    closeDropdown();
    callback?.(plan);
  };

  const menuItems = useMemo(() => {
    const items = [];

    /*
     * Available to both Owner and Viewer.
     */
    if (onSimulation) {
      items.push({
        key: "runSimulation",
        label: (
          <MenuButton
            icon={<PlayCircleOutlined />}
            onClick={() => executeAction(onSimulation)}
          >
            Run Simulation
          </MenuButton>
        ),
      });
    }

    if (onHighlightObject) {
      items.push({
        key: "highlightObjects",
        label: (
          <MenuButton
            icon={<SelectOutlined />}
            onClick={() => executeAction(onHighlightObject)}
          >
            Highlight
          </MenuButton>
        ),
      });
    }

    /*
     * Editing and deleting features
     * are visible only to Owner.
     */
    if (!isOwner) {
      return items;
    }

    if (items.length > 0) {
      items.push({
        type: "divider",
      });
    }

    if (onAssignObject) {
      items.push({
        key: "assignMultipleAssemblies",
        label: (
          <MenuButton
            icon={<PlusOutlined />}
            onClick={() => executeAction(onAssignObject)}
          >
            Assign Multiple Assemblies
          </MenuButton>
        ),
      });
    }

    if (onAutoAssign) {
      items.push({
        key: "assignPickedAssemblies",
        label: (
          <MenuButton
            icon={<PlusOutlined />}
            onClick={() => executeAction(onAutoAssign)}
          >
            Assign Picked Assemblies In Order
          </MenuButton>
        ),
      });
    }

    if (onAddSubPlan) {
      items.push({
        key: "createSubPlan",
        label: (
          <MenuButton
            icon={<FolderAddOutlined />}
            onClick={() => executeAction(onAddSubPlan)}
          >
            Create Sub Plan
          </MenuButton>
        ),
      });
    }

    if (onSortByDate) {
      items.push({
        key: "sortByDate",
        label: (
          <MenuButton
            icon={<SortAscendingOutlined />}
            onClick={() => executeAction(onSortByDate)}
          >
            Sort By Date
          </MenuButton>
        ),
      });
    }

    if (onCopySubPlan) {
      items.push({
        key: "copySubPlan",
        label: (
          <MenuButton
            icon={<CopyOutlined />}
            onClick={() => executeAction(onCopySubPlan)}
          >
            Copy Sub Plan
          </MenuButton>
        ),
      });
    }

    const hasEditActions = Boolean(onEdit) || Boolean(onDelete);

    if (hasEditActions) {
      items.push({
        type: "divider",
      });
    }

    if (onEdit) {
      items.push({
        key: "edit",
        label: (
          <MenuButton
            icon={<EditOutlined />}
            onClick={() => executeAction(onEdit)}
          >
            Edit
          </MenuButton>
        ),
      });
    }

    if (onDelete) {
      items.push({
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

    return items;
  }, [
    plan,
    isOwner,
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
  ]);

  const style = {
    transform: CSS.Transform.toString(transform),

    transition,

    opacity: isDragging ? 0.5 : 1,

    display: "flex",

    alignItems: "center",

    justifyContent: "space-between",

    width: "100%",

    minWidth: 0,
  };

  return (
    <div ref={setNodeRef} style={style}>
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
            onClick={(event) => {
              event.stopPropagation();
            }}
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
            gap: 6,
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

          <span
            style={{
              flexShrink: 0,
              fontSize: 12,
              opacity: 0.65,
              fontWeight: 500,
            }}
          >
            ({objectCount})
          </span>
        </div>
      </div>

      {menuItems.length > 0 && (
        <div
          onClick={(event) => {
            event.stopPropagation();
          }}
          style={{
            flexShrink: 0,
          }}
        >
          <Dropdown
            open={dropdownOpen}
            trigger={["click"]}
            placement="bottomRight"
            destroyOnHidden
            onOpenChange={(open) => {
              if (!open && deleteConfirmOpen) {
                return;
              }

              setDropdownOpen(open);
            }}
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
              onClick={(event) => {
                event.stopPropagation();
              }}
            />
          </Dropdown>
        </div>
      )}
    </div>
  );
};

export default React.memo(SortableHeader);
