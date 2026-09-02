import React from "react";

import { Select, Tooltip } from "antd";

import {
  getSequenceVersion,
  SEQUENCE_VERSION,
  setSequenceVersion,
} from "../utils/sequenceVersion";

const SequenceVersionSelector = ({ pending = false }) => {
  const currentVersion = getSequenceVersion();

  console.log("[SequenceVersion] Selector rendered", {
    currentVersion,
    pending,
  });

  const handleChange = (nextVersion) => {
    console.log("[SequenceVersion] Selector changed", {
      currentVersion,
      nextVersion,
      pending,
    });

    if (nextVersion === currentVersion) {
      return;
    }

    // Do not use antd v5 Modal.confirm here. This application still runs
    // React 16, while antd v5 requires React 18 for its static modal root.
    const confirmed = window.confirm(
      `Switch to ${nextVersion}?\n\n` +
        "The application will reload. Any unsaved changes will be lost.",
    );

    console.log("[SequenceVersion] Switch confirmation result", {
      currentVersion,
      nextVersion,
      confirmed,
    });

    if (!confirmed) {
      return;
    }

    console.log("[SequenceVersion] Switch confirmed", {
      currentVersion,
      nextVersion,
    });

    setSequenceVersion(nextVersion);
  };

  return (
    <Tooltip title="Sequence version">
      <Select
        size="small"
        value={currentVersion}
        disabled={pending}
        onChange={handleChange}
        style={{
          width: 150,
        }}
        options={[
          {
            value: SEQUENCE_VERSION.V1,
            label: "Version 1",
          },
          {
            value: SEQUENCE_VERSION.V2,
            label: "Version 2",
          },
        ]}
      />
    </Tooltip>
  );
};

export default React.memo(SequenceVersionSelector);
