import React from "react";
import { Button, Dropdown, Popconfirm } from "antd";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDispatch, useSelector } from "react-redux";

import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  MenuOutlined,
  MoreOutlined,
  PlusOutlined,
  CopyOutlined,
  SortAscendingOutlined,
  SelectOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";

const SortableHeader = ({
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
}) => {
  const phaseCommentId = useSelector((state) => state.sequence.phaseCommentId);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plan.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  };

  const closeDropdown = () => {
    setDropdownOpen(false);
  };

  const menuItems = [
    onAssignObject && {
      key: "addObject",
      label: (
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onAssignObject?.(plan);
          }}
        >
          Assign Multiple Assemblies
        </Button>
      ),
    },
    onAutoAssign && {
      key: "autoAddOff",
      label: (
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onAutoAssign?.(plan);
          }}
        >
          Assign Picked Assemblies In Order
        </Button>
      ),
    },
    onSimulation && {
      key: "simulation",
      label: (
        <Button
          size="small"
          type="text"
          icon={<PlayCircleOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onSimulation?.(plan);
          }}
        >
          Run Simulation
        </Button>
      ),
    },
    onHighlightObject && {
      key: "highlightObject",
      label: (
        <Button
          size="small"
          type="text"
          icon={<SelectOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onHighlightObject?.(plan);
          }}
        >
          Highlight
        </Button>
      ),
    },
    onAddSubPlan && {
      key: "addSubPlan",
      label: (
        <Button
          size="small"
          type="text"
          icon={<FolderAddOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onAddSubPlan(plan);
          }}
        >
          Create Sub Plan
        </Button>
      ),
    },
    onSortByDate && {
      key: "sortByDate",
      label: (
        <Button
          size="small"
          type="text"
          icon={<SortAscendingOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onSortByDate(plan);
          }}
        >
          Sort By Date
        </Button>
      ),
    },
    onCopySubPlan && {
      key: "copySubPlan",
      label: (
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onCopySubPlan(plan);
          }}
        >
          Copy Sub Plan
        </Button>
      ),
    },
    {
      key: "editName",
      label: (
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
            onEdit?.(plan);
          }}
        >
          Edit
        </Button>
      ),
    },
    {
      key: "deletePlan",
      label: (
        <Popconfirm
          title="Delete"
          description="Are you sure?"
          okText="Yes"
          cancelText="No"
          onConfirm={(e) => {
            e?.stopPropagation?.();
            closeDropdown();
            onDelete?.(plan);
          }}
          onCancel={(e) => {
            e?.stopPropagation?.();
            closeDropdown();
          }}
        >
          <Button
            size="small"
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={(e) => e.stopPropagation()}
          >
            Delete
          </Button>
        </Popconfirm>
      ),
    },
  ].filter(Boolean);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{
            cursor: "grab",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <MenuOutlined />
        </span>

        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {plan.name}
        </span>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown
          open={dropdownOpen}
          onOpenChange={setDropdownOpen}
          menu={{ items: menuItems }}
          trigger={["click"]}
        >
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </div>
    </div>
  );
};

export default SortableHeader;
