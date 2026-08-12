/*
 *
 * Simulation.jsx
 *   -> clear frames
 *   -> add snapshot
 *
 * TopMenu.jsx
 *   -> get frames
 *   -> export MP4
 */

let simulationFrames = [];

/*
 * Các component có thể subscribe để biết
 * số lượng frame hiện tại.
 *
 * Ví dụ TopMenu dùng để hiển thị:
 *
 * Export MP4 (25)
 */
const listeners = new Set();

/*
 * ============================================================
 * NOTIFY
 * ============================================================
 */
function notify() {
  const count = simulationFrames.length;

  for (const listener of listeners) {
    try {
      listener(count);
    } catch (error) {
      console.error(
        "Simulation frame listener failed:",
        error,
      );
    }
  }
}

/*
 * ============================================================
 * CLEAR FRAMES
 * ============================================================
 *
 * Gọi khi bắt đầu một simulation MỚI.
 *
 * Không gọi khi Pause/Resume.
 */
export function clearSimulationFrames() {
  simulationFrames = [];

  notify();
}

/*
 * ============================================================
 * ADD FRAME
 * ============================================================
 *
 * frame:
 *
 * {
 *   index,
 *   itemIndex,
 *   planId,
 *   subPlanId,
 *   modelId,
 *   runtimeId,
 *   duration,
 *   snapshot
 * }
 */
export function addSimulationFrame(frame) {
  if (!frame) {
    return;
  }

  if (!frame.snapshot) {
    console.warn(
      "Simulation frame does not contain snapshot.",
    );

    return;
  }

  simulationFrames.push(frame);

  notify();
}

/*
 * ============================================================
 * GET ALL FRAMES
 * ============================================================
 *
 * Trả về một array mới để component bên ngoài
 * không modify trực tiếp simulationFrames.
 */
export function getSimulationFrames() {
  return [...simulationFrames];
}

/*
 * ============================================================
 * GET FRAME COUNT
 * ============================================================
 */
export function getSimulationFrameCount() {
  return simulationFrames.length;
}

/*
 * ============================================================
 * SUBSCRIBE
 * ============================================================
 *
 * Dùng trong TopMenu:
 *
 * useEffect(() => {
 *   return subscribeSimulationFrames((count) => {
 *     setSimulationFrameCount(count);
 *   });
 * }, []);
 */
export function subscribeSimulationFrames(
  listener,
) {
  if (
    typeof listener !==
    "function"
  ) {
    return () => {};
  }

  listeners.add(listener);

  /*
   * Trả count hiện tại ngay khi subscribe.
   */
  listener(
    simulationFrames.length,
  );

  /*
   * Cleanup cho useEffect.
   */
  return () => {
    listeners.delete(
      listener,
    );
  };
}